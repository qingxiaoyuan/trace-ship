"""
仓库业务服务

封装仓库连通性测试、分支/commit 查询、提交同步等业务逻辑。
"""
from datetime import datetime, timedelta
from urllib.parse import urlparse

from django.utils import timezone

from apps.release.services import VersionCalculator
from apps.repository.models import CommitRecord, Repository, RepositoryBranch, RepositoryTag
from utils.commit_reviewer import CommitReviewer
from utils.provider.base import CommitInfo
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider

# GitLab UI 判定 stale（不活跃）分支的口径：最近 3 个月无提交
STALE_BRANCH_DAYS = 90


class RepositoryService:
    """
    仓库相关业务逻辑封装
    """

    @staticmethod
    def _resolve_server_url(repo: Repository) -> str:
        """
        解析仓库服务端地址

        支持两种录入方式：
        - 服务器根地址，如 http://gitlab.example.com
        - 仓库克隆地址，如 http://gitlab.example.com/owner/repo.git

        Args:
            repo: Repository 实例

        Returns:
            服务端根地址字符串
        """
        url = repo.url.rstrip("/")
        parsed = urlparse(url)
        # 如果路径看起来像仓库克隆地址（包含 /owner/repo.git），只取 scheme + netloc
        path = parsed.path.strip("/")
        if path and ".git" in path:
            return f"{parsed.scheme}://{parsed.netloc}"
        return url

    @staticmethod
    def test_connection(repo: Repository, request_user=None) -> dict:
        """
        测试仓库连通性

        根据凭证模式解析凭证，调用对应 Provider 测试连接，并更新仓库健康状态。
        无论成功失败均写入操作日志，便于在「操作日志」页面审计排查。

        Args:
            repo: Repository 实例
            request_user: 当前请求用户

        Returns:
            {"connected": bool, "detail": str}
        """
        from apps.system.services import OperationLogService

        def _log_result(result: str, error: str = "", diagnostic: dict | None = None) -> None:
            """记录连接测试操作日志，失败时写入错误原因与诊断信息，日志写入异常静默不影响主流程"""
            detail: dict = {}
            if error:
                detail["error"] = error
                detail["repo"] = repo.name
            if diagnostic:
                detail["diagnostic"] = diagnostic
            try:
                OperationLogService.log(
                    user=request_user,
                    module="代码仓库",
                    action="连接测试",
                    resource_type="repository",
                    resource_id=str(repo.id),
                    description=f"测试仓库连接 {repo.name}" + (" 失败" if result == "failure" else ""),
                    result=result,
                    detail=detail,
                )
            except Exception:
                pass

        try:
            cred_data = resolve_credential(repo, request_user)
            provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
            connected = provider.test_connection()
            repo.health_status = "healthy"
            repo.save(update_fields=["health_status", "updated_at"])
            _log_result("success")
            return {"connected": connected, "detail": "连接成功"}
        except ProviderError as exc:
            repo.health_status = "unhealthy"
            repo.save(update_fields=["health_status", "updated_at"])
            _log_result("failure", str(exc), getattr(exc, "diagnostic", None))
            return {"connected": False, "detail": str(exc)}
        except Exception as exc:
            repo.health_status = "unhealthy"
            repo.save(update_fields=["health_status", "updated_at"])
            _log_result("failure", str(exc))
            return {"connected": False, "detail": f"连接异常: {exc}"}

    @staticmethod
    def list_branches(repo: Repository, request_user=None) -> list[dict]:
        """
        获取仓库分支列表（本地优先，为空时自动从远端同步）

        分支数据正常由 ``sync_branches`` 同步落库；若本地无数据
        （如仓库新建后尚未手动同步），自动从远端拉取一次并落库，
        避免新建发布等场景分支下拉为空。

        Args:
            repo: Repository 实例
            request_user: 当前请求用户（自动同步时用于解析凭证）

        Returns:
            分支信息字典列表
        """
        branches = repo.branches.order_by("-is_default", "-last_commit_at", "name")
        if not branches.exists() and repo.repo_type == "git":
            # 本地无分支数据，自动从远端同步一次；同步失败时异常向上抛出，
            # 由视图层返回可读错误，而不是静默返回空列表
            RepositoryService.sync_branches(repo, request_user)
            branches = repo.branches.order_by("-is_default", "-last_commit_at", "name")
        return [
            {
                "name": b.name,
                "is_default": b.is_default,
                "last_commit_hash": b.last_commit_hash,
                "last_commit_author": b.last_commit_author,
                "last_commit_message": b.last_commit_message,
                "last_commit_at": b.last_commit_at.isoformat() if b.last_commit_at else None,
            }
            for b in branches
        ]

    @staticmethod
    def sync_branches(repo: Repository, request_user=None) -> dict:
        """
        同步仓库所有分支到 RepositoryBranch 表

        从远端拉取全部分支及其最新提交信息（作者、时间、信息、哈希）并落库，
        远端已不存在的分支会从本地删除以保持一致。

        只同步活跃分支：最近 3 个月无提交的 stale 分支（GitLab UI 口径）
        会被跳过并从本地清除；默认分支不受此限制，始终保留。

        仅 Git 类仓库支持；SVN 仓库直接返回提示。

        Args:
            repo: Repository 实例
            request_user: 当前请求用户

        Returns:
            {"synced_count": int, "total": int}
        """
        if repo.repo_type != "git":
            return {"synced_count": 0, "total": 0, "detail": "非 Git 仓库不支持分支同步"}

        cred_data = resolve_credential(repo, request_user)
        provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
        branches = provider.list_branches(repo.external_identity)

        stale_before = timezone.now() - timedelta(days=STALE_BRANCH_DAYS)
        remote_names: set = set()
        synced_count = 0
        for b in branches:
            # 跳过 stale 分支（默认分支始终保留），与 GitLab「活跃分支」口径一致；
            # 被跳过的分支不进入 remote_names，会随下方清理逻辑从本地删除
            if not b.is_default and b.last_commit_at and b.last_commit_at < stale_before:
                continue
            remote_names.add(b.name)
            synced_count += 1
            author = b.last_commit_author
            committed_at = b.last_commit_at
            message = b.last_commit_message
            # 部分平台分支接口不返回作者/时间，按 hash 调 get_commit 补全
            if (not author or not committed_at) and b.last_commit_hash:
                try:
                    ci = provider.get_commit(repo.external_identity, b.last_commit_hash)
                    author = author or ci.author
                    committed_at = committed_at or ci.committed_at
                    message = message or ci.message
                except Exception:
                    pass
            RepositoryBranch.objects.update_or_create(
                repository=repo,
                name=b.name,
                defaults={
                    "is_default": b.is_default,
                    "last_commit_hash": b.last_commit_hash or "",
                    "last_commit_author": author or "",
                    "last_commit_message": message or "",
                    "last_commit_at": committed_at,
                },
            )

        # 删除远端已不存在的分支，保持与远端一致
        if remote_names:
            RepositoryBranch.objects.filter(repository=repo).exclude(name__in=remote_names).delete()
        else:
            RepositoryBranch.objects.filter(repository=repo).delete()

        # 同步扫描 tag：仅版本规则正则匹配上的入库
        tag_result = RepositoryService.sync_tags(repo, provider=provider)

        return {
            "synced_count": synced_count,
            "total": len(branches),
            "tag_synced_count": tag_result["synced_count"],
            "tag_total": tag_result["total"],
        }

    @staticmethod
    def sync_tags(repo: Repository, request_user=None, provider=None) -> dict:
        """
        扫描远端 tag 并按版本规则正则过滤入库

        只有匹配「{prefix}.主.次.修(-后缀)?_YYYYMMDD」规则的 tag 才解析入库，
        解析出主/次/修订版本号、类型后缀与日期段；远端已不存在或不再匹配
        规则的本地 tag 会被清除。

        Args:
            repo: Repository 实例
            request_user: 当前请求用户（provider 为空时用于解析凭证）
            provider: 可选的已构造 provider，为空时按仓库凭证创建

        Returns:
            {"synced_count": int, "total": int}，total 为远端 tag 总数
        """
        # 延迟导入避免 apps.release 与 apps.repository 之间的模块级耦合
        from apps.release.services import VersionCalculator

        if repo.repo_type != "git":
            return {"synced_count": 0, "total": 0, "detail": "非 Git 仓库不支持 Tag 同步"}

        if provider is None:
            cred_data = resolve_credential(repo, request_user)
            provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
        tags = provider.list_tags(repo.external_identity)

        scan_regex = VersionCalculator(repo.get_version_rule()).build_scan_regex()
        remote_names: set = set()
        synced_count = 0
        for t in tags:
            match = scan_regex.match(t.name)
            if not match:
                continue
            # 日期段可选（兼容历史无日期 tag）；存在时必须是合法年月日，否则视为不匹配
            date_str = match.groupdict().get("date")
            tag_date = None
            if date_str:
                try:
                    tag_date = datetime.strptime(date_str, "%Y%m%d").date()
                except ValueError:
                    continue
            remote_names.add(t.name)
            synced_count += 1
            RepositoryTag.objects.update_or_create(
                repository=repo,
                name=t.name,
                defaults={
                    "commit_hash": t.commit_hash or "",
                    "major": int(match.group("major")),
                    "minor": int(match.group("minor")),
                    "patch": int(match.group("patch")),
                    "suffix": match.groupdict().get("suffix") or "",
                    "tag_date": tag_date,
                    "remote_created_at": t.created_at,
                },
            )

        # 清除远端已不存在或不再匹配规则的本地 tag
        if remote_names:
            RepositoryTag.objects.filter(repository=repo).exclude(name__in=remote_names).delete()
        else:
            RepositoryTag.objects.filter(repository=repo).delete()

        return {"synced_count": synced_count, "total": len(tags)}

    @staticmethod
    def list_tags(repo: Repository, request_user=None) -> list[dict]:
        """
        获取仓库标签列表

        仅 Git 类仓库支持；SVN 仓库返回空列表。

        Args:
            repo: Repository 实例
            request_user: 当前请求用户

        Returns:
            标签信息字典列表
        """
        if repo.repo_type != "git":
            return []
        cred_data = resolve_credential(repo, request_user)
        provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
        tags = provider.list_tags(repo.external_identity)
        return [
            {
                "name": t.name,
                "commit_hash": t.commit_hash,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in tags
        ]

    @staticmethod
    def list_commits(
        repo: Repository,
        branch: str | None = None,
        request_user=None,
    ) -> list[CommitInfo]:
        """
        获取指定分支的 commit 列表

        Args:
            repo: Repository 实例
            branch: 分支名称，默认使用仓库默认分支
            request_user: 当前请求用户

        Returns:
            CommitInfo 对象列表
        """
        cred_data = resolve_credential(repo, request_user)
        provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
        branch = branch or repo.default_branch
        return provider.list_commits(repo.external_identity, branch)

    @staticmethod
    def sync_commits(
        repo: Repository,
        branch: str | None = None,
        request_user=None,
    ) -> dict:
        """
        同步指定仓库的 commits

        使用规则引擎审查提交信息，将结果保存到 CommitRecord。

        Args:
            repo: Repository 实例
            branch: 分支名称，默认使用仓库默认分支
            request_user: 当前请求用户

        Returns:
            {"synced_count": int, "illegal_count": int}
        """
        branch = branch or repo.default_branch
        commits = RepositoryService.list_commits(repo, branch, request_user)

        synced_count = 0
        illegal_count = 0

        for commit in commits:
            status, reason, parsed = CommitReviewer.review(commit.message)
            if status == "illegal":
                illegal_count += 1

            _, created = CommitRecord.objects.update_or_create(
                repository=repo,
                commit_hash=commit.hash,
                defaults={
                    "project": repo.project,
                    "author": commit.author,
                    "author_email": commit.author_email or "",
                    "message": commit.message,
                    "committed_at": commit.committed_at or timezone.now(),
                    "branch": branch,
                    "parsed_message": parsed,
                    "review_status": status,
                    "review_reason": reason,
                },
            )
            if created:
                synced_count += 1

        repo.last_sync_at = timezone.now()
        repo.save(update_fields=["last_sync_at", "updated_at"])

        return {"synced_count": synced_count, "illegal_count": illegal_count}

    @staticmethod
    def review_range(
        repo: Repository,
        base_tag: str | None = None,
        head_tag: str | None = None,
        request_user=None,
    ) -> dict:
        """
        按 Tag 区间拉取 commits 与 MRs 并做合规审查（不落库）

        - 同时指定 base_tag 与 head_tag：审查 base_tag -> head_tag 之间的提交
        - 仅指定 head_tag：审查 head_tag 的上一个 tag -> head_tag 之间的提交
        - 仅指定 base_tag：审查 base_tag -> 分支 HEAD 之间的提交
        - 均未指定：审查最新 tag -> 分支 HEAD 之间的提交

        Args:
            repo: Repository 实例
            base_tag: 起始 Tag 名称，None 表示自动取最新/上一个
            head_tag: 结束 Tag 名称，None 表示分支 HEAD
            request_user: 当前请求用户

        Returns:
            审查结果字典，含 commits / merge_requests / stats
        """
        cred_data = resolve_credential(repo, request_user)
        provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
        repo_identity = repo.external_identity
        branch = repo.default_branch

        # 统一通过 VersionCalculator.sort_tags_by_recency 排序 tag（新→旧）：
        # 无创建时间的 tag 按版本号降序排最前兜底，有时间的按 created_at 倒序
        try:
            tags = provider.list_tags(repo_identity)
        except ProviderError:
            tags = []
        calculator = VersionCalculator(repo.get_version_rule())
        sorted_tags = calculator.sort_tags_by_recency(tags)
        tag_names = [t.name for t in sorted_tags]

        # 确定区间：base = 起点，head = 终点
        # head 优先用显式 head_tag，否则取分支 HEAD
        if head_tag and head_tag != "HEAD":
            head_ref = head_tag
        else:
            head_ref = branch
        # base 优先用显式 base_tag；否则按 head 自动推断
        if base_tag:
            base_ref = base_tag
        elif head_tag and head_tag != "HEAD":
            # head 是某个 tag，base 取该 tag 的上一个 tag
            if head_tag in tag_names:
                idx = tag_names.index(head_tag)
                base_ref = tag_names[idx + 1] if idx + 1 < len(tag_names) else None
            else:
                base_ref = None
        else:
            # head 是分支 HEAD，base 取最新 tag
            base_ref = tag_names[0] if tag_names else None

        # 拉取区间 commits
        commits: list[CommitInfo] = []
        try:
            if base_ref and head_ref:
                commits = provider.compare_commits(repo_identity, base=base_ref, head=head_ref)
            elif head_ref:
                commits = provider.list_commits(repo_identity, head_ref)
        except ProviderError:
            commits = []

        # 审查每个 commit
        commit_results = []
        for c in commits:
            status, reason, parsed = CommitReviewer.review(c.message)
            commit_results.append({
                "hash": c.hash,
                "author": c.author,
                "author_email": c.author_email,
                "message": c.message,
                "committed_at": c.committed_at.isoformat() if c.committed_at else None,
                "review_status": status,
                "review_reason": reason,
                "parsed_result": parsed,
            })

        # 拉取 MRs 并按 merged_at 过滤在区间内
        merge_results = []
        base_tag_time = None
        if base_ref:
            for t in sorted_tags:
                if t.name == base_ref:
                    base_tag_time = t.created_at
                    break
        # 注意：base_tag_time 为 tag 指向 commit 的提交时间近似（GitLab REST
        # API 不返回 tag 创建时间）。tag 打在历史 commit 上时，该时间可能早于
        # tag 实际创建时间，导致「tag 创建后、commit 日期前」合并的 MR 被误过滤。
        try:
            mrs = provider.list_merge_requests(repo_identity, target_branch=branch, since=base_tag_time)
            for mr in mrs:
                if not mr.merged_at:
                    continue
                if base_tag_time and mr.merged_at < base_tag_time:
                    continue
                status, reason, parsed = CommitReviewer.review(mr.description or mr.title or "")
                merge_results.append({
                    "number": mr.number,
                    "title": mr.title,
                    "description": mr.description,
                    "author": mr.author,
                    "source_branch": mr.source_branch,
                    "target_branch": mr.target_branch,
                    "web_url": mr.web_url,
                    "merged_at": mr.merged_at.isoformat() if mr.merged_at else None,
                    "review_status": status,
                    "review_reason": reason,
                    "parsed_result": parsed,
                })
        except ProviderError:
            merge_results = []

        # 统计：illegal 归入 warning（前端只需正常/警告两种）
        c_pass = sum(1 for c in commit_results if c["review_status"] == "pass")
        c_warn = sum(1 for c in commit_results if c["review_status"] in ("warning", "illegal"))

        return {
            "base": base_ref or "(初始提交)",
            "head": head_ref,
            "tags": [
                {"name": t.name, "created_at": t.created_at.isoformat() if t.created_at else None}
                for t in sorted_tags
            ],
            "commits": commit_results,
            "merge_requests": merge_results,
            "stats": {
                "total": len(commit_results),
                "pass": c_pass,
                "warning": c_warn,
                "mr_total": len(merge_results),
            },
        }
