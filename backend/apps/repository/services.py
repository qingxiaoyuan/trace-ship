"""
仓库业务服务

封装仓库连通性测试、分支/commit 查询、提交同步等业务逻辑。
"""
from typing import List, Optional
from urllib.parse import urlparse

from django.utils import timezone

from apps.repository.models import CommitRecord, Repository, RepositoryBranch
from utils.commit_reviewer import CommitReviewer
from utils.provider.base import CommitInfo
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider


class RepositoryService:
    """
    仓库相关业务逻辑封装
    """

    @staticmethod
    def _resolve_server_url(repo: Repository) -> str:
        """
        解析仓库服务端地址

        支持两种录入方式：
        - 服务器根地址，如 http://gitea.example.com
        - 仓库克隆地址，如 http://gitea.example.com/owner/repo.git

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

        Args:
            repo: Repository 实例
            request_user: 当前请求用户

        Returns:
            {"connected": bool, "detail": str}
        """
        try:
            cred_data = resolve_credential(repo, request_user)
            provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
            connected = provider.test_connection()
            repo.health_status = "healthy"
            repo.save(update_fields=["health_status", "updated_at"])
            return {"connected": connected, "detail": "连接成功"}
        except ProviderError as exc:
            repo.health_status = "unhealthy"
            repo.save(update_fields=["health_status", "updated_at"])
            return {"connected": False, "detail": str(exc)}
        except Exception as exc:
            repo.health_status = "unhealthy"
            repo.save(update_fields=["health_status", "updated_at"])
            return {"connected": False, "detail": f"连接异常: {exc}"}

    @staticmethod
    def list_branches(repo: Repository, request_user=None) -> List[dict]:
        """
        获取仓库分支列表（从本地数据库读取）

        分支数据需先调用 ``sync_branches`` 同步后才有。

        Args:
            repo: Repository 实例
            request_user: 当前请求用户（保留兼容，读取本地无需使用）

        Returns:
            分支信息字典列表
        """
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

        remote_names: set = set()
        for b in branches:
            remote_names.add(b.name)
            author = b.last_commit_author
            committed_at = b.last_commit_at
            message = b.last_commit_message
            # 部分平台（如低版本 Gitea）分支接口不返回作者/时间，按 hash 调 get_commit 补全
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

        return {"synced_count": len(branches), "total": len(branches)}

    @staticmethod
    def list_tags(repo: Repository, request_user=None) -> List[dict]:
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
        branch: Optional[str] = None,
        request_user=None,
    ) -> List[CommitInfo]:
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
        branch: Optional[str] = None,
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
        tag: Optional[str] = None,
        request_user=None,
    ) -> dict:
        """
        按 Tag 区间拉取 commits 与 MRs 并做合规审查（不落库）

        - 指定 tag：审查该 tag 与上一个 tag 之间的提交
        - tag 为空或 "latest"：审查最新 tag 到分支 HEAD 之间的提交

        Args:
            repo: Repository 实例
            tag: Tag 名称，None 或 "latest" 表示最新区间
            request_user: 当前请求用户

        Returns:
            审查结果字典，含 commits / merge_requests / stats
        """
        cred_data = resolve_credential(repo, request_user)
        provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
        repo_identity = repo.external_identity
        branch = repo.default_branch

        # 获取 tags 并按 created_at 倒序（无时间的按 commit_hash 兜底去重后放前面）
        try:
            tags = provider.list_tags(repo_identity)
        except ProviderError:
            tags = []
        sortable = [t for t in tags if t.created_at]
        sortable.sort(key=lambda t: t.created_at, reverse=True)
        # 无 created_at 的 tag（如 Gitea 默认不返回时间）按名称中版本号降序补充到前面
        seen = {t.name for t in sortable}
        def _tag_version_key(name: str) -> tuple:
            import re
            m = re.search(r"(\d+)\.(\d+)\.(\d+)", name)
            if m:
                return tuple(int(x) for x in m.groups())
            return (0, 0, 0)
        for t in sorted(
            [t for t in tags if t.name not in seen],
            key=lambda t: _tag_version_key(t.name),
            reverse=True,
        ):
            sortable.insert(0, t)
            seen.add(t.name)
        tag_names = [t.name for t in sortable]

        # 确定区间：base = 起点，head = 终点
        base_ref: Optional[str] = None
        head_ref = branch
        if tag and tag != "latest":
            if tag in tag_names:
                idx = tag_names.index(tag)
                head_ref = tag
                base_ref = tag_names[idx + 1] if idx + 1 < len(tag_names) else None
        else:
            base_ref = tag_names[0] if tag_names else None
            head_ref = branch

        # 拉取区间 commits
        commits: List[CommitInfo] = []
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
            for t in sortable:
                if t.name == base_ref:
                    base_tag_time = t.created_at
                    break
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
                for t in sortable
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

