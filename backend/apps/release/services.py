"""
发布业务服务

封装版本号计算、发布校验、发布说明生成、推 tag 等发布核心流程。
"""
import re
from datetime import timedelta
from typing import Any, Dict, List, Optional, Tuple

from django.utils import timezone
from rest_framework import serializers

from apps.jenkins.models import JenkinsBuild
from apps.notification.services import NotificationService
from apps.project.models import Project
from apps.release.models import ReleaseCommit, ReleaseRecord
from apps.repository.models import CommitRecord, Repository
from apps.system.services import OperationLogService
from apps.workflow.models import WorkflowDefinition, WorkflowInstance
from apps.workflow.services import WorkflowEngine
from utils.provider.base import CommitInfo, GitProvider, TagInfo
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider


class VersionCalculator:
    """
    版本号计算器

    根据项目配置的 version_rule 解析最新 tag 并递增版本号。
    本阶段默认递增最后一个数字段（通常为 patch）。
    """

    def __init__(self, version_rule: dict):
        """
        Args:
            version_rule: 版本号规则，包含 format 和 initial
        """
        self.format: str = version_rule.get("format", "{major}.{minor}.{patch}")
        self.initial: str = version_rule.get("initial", "1.0.0")

    def _format_to_regex(self) -> Tuple[str, List[str]]:
        """
        将 format 模板转换为可匹配 tag 的正则表达式

        Returns:
            (正则表达式字符串, 占位符名称列表)
        """
        fields = re.findall(r"\{(\w+)\}", self.format)
        pattern = self.format
        markers: Dict[str, str] = {}
        for index, field in enumerate(fields):
            marker = f"__PLACEHOLDER_{index}__"
            markers[marker] = f"(?P<{field}>\\d+)"
            pattern = pattern.replace(f"{{{field}}}", marker)

        # 对非占位符字符进行转义
        pattern = re.escape(pattern)
        for marker, repl in markers.items():
            pattern = pattern.replace(re.escape(marker), repl)
        return pattern, fields

    def find_latest_matching_tag(self, tags: List[TagInfo]) -> Optional[Tuple[TagInfo, Dict[str, int]]]:
        """
        从 tag 列表中找到匹配 version_rule 的最新版本

        Args:
            tags: TagInfo 列表

        Returns:
            最新匹配 tag 及其字段值字典，无匹配时返回 None
        """
        pattern, fields = self._format_to_regex()
        regex = re.compile(f"^{pattern}$")

        candidates: List[Tuple[TagInfo, Dict[str, int], Tuple[int, ...]]] = []
        for tag in tags:
            match = regex.match(tag.name)
            if not match:
                continue
            values = {field: int(match.group(field)) for field in fields}
            numeric_key = tuple(values[field] for field in fields)
            candidates.append((tag, values, numeric_key))

        if not candidates:
            return None
        # 按数字段元组降序，取最新
        candidates.sort(key=lambda item: item[2], reverse=True)
        return candidates[0][0], candidates[0][1]

    def calculate(
        self,
        tags: List[TagInfo],
        release_type: str = "formal",
        prefixes: Optional[Dict[str, str]] = None,
    ) -> Tuple[str, str]:
        """
        计算下一个版本号和 tag 名称

        从所有 tag 中匹配 version_rule 并找到最大版本号递增，
        无匹配时使用 initial。最后根据 release_type 拼接前缀。

        Args:
            tags: 当前仓库的 tag 列表
            release_type: 发布类型 formal/rc/beta
            prefixes: 各发布类型对应的前缀配置，如 {"rc": "rc", "beta": "beta"}

        Returns:
            (version, tag_name) 元组
        """
        prefixes = prefixes or {}
        prefix = (prefixes.get(release_type, "") or "").strip("-")

        # 统一去掉已知前缀后再匹配版本号，确保正式/rc/beta 都基于同一版本序列递增
        normalized_tags: List[TagInfo] = []
        all_prefixes = set((p or "").strip("-") for p in prefixes.values())
        for t in tags:
            name = t.name
            for p in all_prefixes:
                if p and name.startswith(f"{p}-"):
                    name = name[len(p) + 1 :]
                    break
            normalized_tags.append(TagInfo(name=name, commit_hash=t.commit_hash, created_at=t.created_at))

        latest = self.find_latest_matching_tag(normalized_tags)
        if latest is None:
            version = self.initial
        else:
            tag, values = latest
            fields = list(values.keys())
            # 默认递增最后一个字段
            increment_field = fields[-1]
            values[increment_field] = values[increment_field] + 1
            version = self.format.format(**values)

        if prefix:
            tag_name = f"{prefix}-{version}"
        else:
            tag_name = version
        return version, tag_name


class ReleaseValidator:
    """
    发布校验器

    校验项目状态、分支规则、测试前缀、发布周期等业务规则。
    """

    @staticmethod
    def get_release_rule(project: Project) -> dict:
        """
        获取项目的发布规则，提供默认值

        Args:
            project: 项目实例

        Returns:
            发布规则字典
        """
        rule = project.release_rule or {}
        return {
            "formal_branch": rule.get("formal_branch", "main"),
            "tag_prefixes": rule.get("tag_prefixes", ReleaseValidator.get_default_tag_prefixes()),
            "release_cycle_days": int(rule.get("release_cycle_days", 3)),
        }

    @staticmethod
    def get_default_tag_prefixes() -> Dict[str, str]:
        """
        获取默认 tag 前缀配置

        Returns:
            发布类型到前缀的映射
        """
        return {
            "rc": "rc",
            "beta": "beta",
        }

    @staticmethod
    def validate_project_status(project: Project) -> None:
        """
        校验项目是否启用

        Args:
            project: 项目实例

        Raises:
            serializers.ValidationError: 项目已停用
        """
        if project.status != 1:
            raise serializers.ValidationError({"project": "项目已停用，禁止创建发布"})

    @staticmethod
    def validate_branch_and_prefix(
        release_type: str,
        target_branch: str,
        tag_name: str,
        release_rule: dict,
    ) -> None:
        """
        校验分支规则与 tag 前缀

        Args:
            release_type: 发布类型
            target_branch: 目标分支
            tag_name: tag 名称
            release_rule: 发布规则

        Raises:
            serializers.ValidationError: 校验失败
        """
        formal_branch = release_rule.get("formal_branch", "main")
        prefixes = release_rule.get("tag_prefixes", ReleaseValidator.get_default_tag_prefixes())

        if release_type == "formal" and target_branch != formal_branch:
            raise serializers.ValidationError(
                {"target_branch": f"正式版本只能从 {formal_branch} 分支发布"}
            )
        if release_type in ("rc", "beta"):
            prefix = (prefixes.get(release_type, "") or "").strip("-")
            if prefix and not tag_name.startswith(prefix):
                raise serializers.ValidationError(
                    {"tag_name": f"{release_type} 版本 tag 必须以 {prefix} 开头"}
                )

    @staticmethod
    def validate_release_cycle(project: Project, release_type: str, release_rule: dict) -> None:
        """
        校验正式发布周期

        Args:
            project: 项目实例
            release_type: 发布类型
            release_rule: 发布规则

        Raises:
            serializers.ValidationError: 未达到发布周期
        """
        if release_type != "formal":
            return
        days = release_rule.get("release_cycle_days", 3)
        cutoff = timezone.now() - timedelta(days=days)
        recent = (
            ReleaseRecord.objects.filter(
                project=project,
                release_type="formal",
                status__in=["released", "pending"],
                created_at__gte=cutoff,
            )
            .exclude(status="rejected")
            .first()
        )
        if recent:
            raise serializers.ValidationError(
                {"release_type": f"正式版本每 {days} 天发布一次，最近一次为 {recent.version}"}
            )


class ReleaseDocGenerator:
    """
    发布说明生成器

    聚合 source_branch 到上一个 tag 之间的 commits，生成统一格式的发布说明文档。
    """

    def __init__(self, release: ReleaseRecord, provider: GitProvider):
        """
        Args:
            release: 发布记录实例
            provider: GitProvider 实例
        """
        self.release = release
        self.provider = provider

    def _get_last_tag(self) -> Optional[str]:
        """
        获取仓库中匹配 version_rule 的最新 tag 名称

        Returns:
            tag 名称或 None
        """
        try:
            tags = self.provider.list_tags(self.release.repository.external_identity)
        except ProviderError:
            return None
        calculator = VersionCalculator(self.release.project.version_rule or {})
        latest = calculator.find_latest_matching_tag(tags)
        if latest is None:
            return None
        return latest[0].name

    def _fetch_commits(self) -> List[CommitInfo]:
        """
        拉取用于生成发布说明的 commits

        优先比较上一个 tag 到 source_branch；无 tag 时拉取 source_branch 全部 commits。

        Returns:
            CommitInfo 列表
        """
        repo_identity = self.release.repository.external_identity
        last_tag = self._get_last_tag()
        if last_tag:
            try:
                return self.provider.compare_commits(repo_identity, base=last_tag, head=self.release.source_branch)
            except ProviderError:
                pass
        return self.provider.list_commits(repo_identity, self.release.source_branch)

    @staticmethod
    def _filter_commits(commits: List[CommitInfo], commit_ids: Optional[List[str]] = None) -> List[CommitInfo]:
        """
        按 commit_id 筛选并过滤非法提交

        Args:
            commits: CommitInfo 列表
            commit_ids: 可选的 commit 主键列表

        Returns:
            筛选后的 CommitInfo 列表
        """
        if commit_ids is not None:
            qs = CommitRecord.objects.filter(id__in=commit_ids)
            allowed_hashes = set(qs.values_list("commit_hash", flat=True))
            commits = [c for c in commits if c.hash in allowed_hashes]
        # 过滤非法提交
        hashes = [c.hash for c in commits]
        illegal_hashes = set(
            CommitRecord.objects.filter(
                repository__project__isnull=False,
                commit_hash__in=hashes,
                review_status="illegal",
            ).values_list("commit_hash", flat=True)
        )
        return [c for c in commits if c.hash not in illegal_hashes]

    @staticmethod
    def _aggregate_doc(commits: List[CommitInfo], merge_similar: bool) -> Dict[str, Any]:
        """
        聚合 commits 的解析结果为发布说明文档

        Args:
            commits: CommitInfo 列表
            merge_similar: 是否合并相同 type+content 的更新项

        Returns:
            发布说明文档字典
        """
        from utils.commit_parser import CommitParser

        change_types: set = set()
        updates: List[Dict[str, str]] = []
        config_changes: Dict[str, Dict[str, str]] = {}
        related_changes: Dict[str, str] = {}
        impact_other = False

        seen: set = set()
        for commit in commits:
            parsed = CommitParser.parse(commit.message)
            if parsed.change_type:
                change_types.add(parsed.change_type)
            for update in parsed.updates:
                item = (update.get("type"), update.get("content"))
                if merge_similar and item in seen:
                    continue
                seen.add(item)
                updates.append(update)
            for section, kv in parsed.config_changes.items():
                config_changes.setdefault(section, {}).update(kv)
            related_changes.update(parsed.related_changes)

        # 只要存在配置项改动即视为有配置项改动
        overall_change_type = "有配置项改动" if "有配置项改动" in change_types else "无配置项改动"

        return {
            "change_type": overall_change_type,
            "updates": updates,
            "config_changes": config_changes,
            "related_changes": related_changes,
            "impact_other": impact_other,
            "test_status": "自测试通过",
            "publisher": "",
        }

    def generate(self, commit_ids: Optional[List[str]] = None, merge_similar: bool = True) -> Dict[str, Any]:
        """
        生成发布说明文档

        Args:
            commit_ids: 指定纳入的 commit ID 列表，为空时包含所有非非法提交
            merge_similar: 是否合并相似更新项

        Returns:
            发布说明文档字典
        """
        commits = self._fetch_commits()
        commits = self._filter_commits(commits, commit_ids)
        doc = self._aggregate_doc(commits, merge_similar)

        # 持久化 ReleaseCommit 关联
        repo = self.release.repository
        project = self.release.project
        included_hashes = {c.hash for c in commits}
        existing_records = {
            rc.commit_id: rc
            for rc in self.release.release_commits.select_related("commit").all()
        }

        for commit in commits:
            commit_record, _ = CommitRecord.objects.update_or_create(
                repository=repo,
                commit_hash=commit.hash,
                defaults={
                    "project": project,
                    "author": commit.author,
                    "author_email": commit.author_email or "",
                    "message": commit.message,
                    "committed_at": commit.committed_at or timezone.now(),
                    "branch": self.release.source_branch,
                },
            )
            if commit_record.id in existing_records:
                rc = existing_records[commit_record.id]
                rc.is_included = True
                rc.save(update_fields=["is_included"])
            else:
                ReleaseCommit.objects.create(
                    release=self.release,
                    commit=commit_record,
                    is_included=True,
                )

        # 标记不再包含的 commit
        for commit_id, rc in existing_records.items():
            if rc.commit.commit_hash not in included_hashes:
                rc.is_included = False
                rc.save(update_fields=["is_included"])

        return doc


class ReleaseService:
    """
    发布流程服务

    封装创建发布、生成发布说明、提交审批、推 tag 等核心业务逻辑。
    """

    @staticmethod
    def _get_provider(repo: Repository, request_user=None) -> GitProvider:
        """
        根据仓库获取 GitProvider

        Args:
            repo: Repository 实例
            request_user: 当前请求用户

        Returns:
            GitProvider 实例
        """
        from apps.repository.services import RepositoryService

        server_url = RepositoryService._resolve_server_url(repo)
        cred_data = resolve_credential(repo, request_user)
        return get_provider(repo.vendor, server_url, cred_data)

    @staticmethod
    def _resolve_branch_head_hash(repo: Repository, branch: str, request_user=None) -> str:
        """
        获取指定分支当前最新 commit hash

        Args:
            repo: Repository 实例
            branch: 分支名称
            request_user: 当前请求用户

        Returns:
            commit hash 字符串

        Raises:
            serializers.ValidationError: 获取失败
        """
        provider = ReleaseService._get_provider(repo, request_user)
        try:
            commits = provider.list_commits(repo.external_identity, branch, per_page=1)
        except ProviderError as exc:
            raise serializers.ValidationError({"branch": f"获取分支 {branch} 失败: {exc}"})
        if not commits:
            raise serializers.ValidationError({"branch": f"分支 {branch} 无提交记录"})
        return commits[0].hash

    @classmethod
    def create_release(
        cls,
        project: Project,
        repository: Repository,
        release_type: str,
        source_branch: str,
        target_branch: str,
        publisher,
        version: Optional[str] = None,
        tag_name: Optional[str] = None,
        related_changes: Optional[list] = None,
        updates: Optional[list] = None,
    ) -> ReleaseRecord:
        """
        创建发布申请

        Args:
            project: 项目实例
            repository: 目标仓库实例
            release_type: 发布类型
            source_branch: 来源分支
            target_branch: 目标分支
            publisher: 发布人
            version: 可选的版本号，为空时自动计算
            tag_name: 可选的 tag 名称，为空时根据版本号与发布类型自动计算
            related_changes: 关联变更清单（硬件/软件版本条目列表）
            updates: 变更条目（A/F 类变更内容）

        Returns:
            新创建的 ReleaseRecord
        """
        ReleaseValidator.validate_project_status(project)
        release_rule = ReleaseValidator.get_release_rule(project)

        provider = cls._get_provider(repository, publisher)

        if not version:
            try:
                tags = provider.list_tags(repository.external_identity)
            except ProviderError as exc:
                raise serializers.ValidationError({"repository": f"获取 tag 列表失败: {exc}"})
            version_rule = project.version_rule or {}
            calculator = VersionCalculator(version_rule)
            prefixes = release_rule.get("tag_prefixes", {}) or ReleaseValidator.get_default_tag_prefixes()
            version, auto_tag_name = calculator.calculate(
                tags,
                release_type=release_type,
                prefixes=prefixes,
            )
        else:
            if release_type in ("rc", "beta"):
                prefixes = release_rule.get("tag_prefixes", {}) or ReleaseValidator.get_default_tag_prefixes()
                prefix = (prefixes.get(release_type, "") or "").strip("-")
                auto_tag_name = version
                if prefix and not auto_tag_name.startswith(prefix):
                    auto_tag_name = f"{prefix}-{auto_tag_name}"
            else:
                auto_tag_name = version

        tag_name = tag_name or auto_tag_name

        ReleaseValidator.validate_branch_and_prefix(
            release_type, target_branch, tag_name, release_rule
        )
        ReleaseValidator.validate_release_cycle(project, release_type, release_rule)

        git_hash = cls._resolve_branch_head_hash(repository, target_branch, publisher)

        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version=version,
            tag_name=tag_name,
            source_branch=source_branch,
            target_branch=target_branch,
            git_hash=git_hash,
            release_type=release_type,
            status="draft",
            publisher=publisher,
            related_changes=related_changes or [],
            updates=updates or [],
        )
        OperationLogService.log_release(
            user=publisher,
            release=release,
            action="create",
        )
        return release

    @classmethod
    def generate_doc(
        cls,
        release: ReleaseRecord,
        commit_ids: Optional[List[str]] = None,
        merge_similar: bool = True,
        request_user=None,
    ) -> Dict[str, Any]:
        """
        生成并保存发布说明

        Args:
            release: ReleaseRecord 实例
            commit_ids: 可选的 commit ID 列表
            merge_similar: 是否合并相似更新项
            request_user: 当前请求用户

        Returns:
            发布说明文档字典
        """
        provider = cls._get_provider(release.repository, request_user)
        generator = ReleaseDocGenerator(release, provider)
        doc = generator.generate(commit_ids=commit_ids, merge_similar=merge_similar)
        doc["publisher"] = getattr(release.publisher, "nickname", "") or release.publisher.username
        release.release_doc = doc
        release.save(update_fields=["release_doc", "updated_at"])
        return doc

    @staticmethod
    def submit_audit(release: ReleaseRecord, user) -> ReleaseRecord:
        """
        提交审批

        仅允许草稿状态提交，校验发布说明非空且无非法提交；
        为项目创建发布审批工作流实例并将 release 置为 pending。

        Args:
            release: ReleaseRecord 实例
            user: 提交人

        Returns:
            更新后的 ReleaseRecord
        """
        if release.status != "draft":
            raise serializers.ValidationError({"status": "只有草稿状态才能提交审批"})
        if not release.release_doc:
            raise serializers.ValidationError({"release_doc": "发布说明为空，请先生成发布说明"})

        illegal_exists = release.release_commits.filter(
            is_included=True,
            commit__review_status="illegal",
        ).exists()
        if illegal_exists:
            raise serializers.ValidationError({"commits": "包含非法提交，无法提交审批"})

        # 查找项目生效的发布审批流程定义
        definition = WorkflowDefinition.objects.filter(
            project=release.project,
            biz_type="release",
            is_active=True,
        ).first()
        if not definition:
            raise serializers.ValidationError({"workflow": "项目未配置发布审批流程"})

        instance = WorkflowEngine.create_instance(
            definition=definition,
            biz_type="release",
            biz_id=str(release.id),
            user=user,
        )
        release.workflow_instance = instance
        release.status = "pending"
        release.save(update_fields=["workflow_instance", "status", "updated_at"])
        OperationLogService.log_release(
            user=user,
            release=release,
            action="submit_audit",
        )
        return release

    @staticmethod
    def handle_workflow_completed(instance: WorkflowInstance) -> None:
        """
        工作流完成时驱动发布状态

        新 Tag 流程：审批通过后直接推 tag，成功后标记为 released。

        Args:
            instance: WorkflowInstance 实例
        """
        release = ReleaseRecord.objects.filter(workflow_instance=instance).first()
        if not release:
            return

        if release.status == "pending":
            try:
                ReleaseService.push_tag(release)
            except Exception:
                # push_tag 内部已设置 rejected 状态
                pass

    @staticmethod
    def handle_workflow_rejected(instance: WorkflowInstance, comment: str = "") -> None:
        """
        工作流驳回时驱动发布状态

        Args:
            instance: WorkflowInstance 实例
            comment: 驳回意见
        """
        release = ReleaseRecord.objects.filter(workflow_instance=instance).first()
        if not release:
            return
        release.status = "rejected"
        release.rejected_reason = comment or "审批已驳回"
        release.save(update_fields=["status", "rejected_reason", "updated_at"])

    @staticmethod
    def trigger_build_for_release(release: ReleaseRecord) -> None:
        """
        为发布触发 Jenkins 构建（当前流程已替换为 Tag 流程，此方法不再使用）。

        Args:
            release: ReleaseRecord 实例
        """
        # Tag 流程不再触发 Jenkins 构建，保留函数签名避免外部引用报错。
        pass

    @staticmethod
    def handle_build_completed(build, success: bool, error_msg: str = "") -> None:
        """
        Jenkins 构建完成时驱动发布状态（保留兼容，若被调用则直接结束）。

        Args:
            build: JenkinsBuild 实例
            success: 是否成功
            error_msg: 失败原因
        """
        from apps.release.models import ReleaseRecord

        release = ReleaseRecord.objects.filter(jenkins_build=build).first()
        if not release:
            return

        if not success:
            release.status = "rejected"
            release.rejected_reason = error_msg or "构建失败"
            release.save(update_fields=["status", "rejected_reason", "updated_at"])
            NotificationService.notify_build_result(build, release)
            OperationLogService.log_release(
                user=release.publisher,
                release=release,
                action="build_failure",
                result="failure",
                detail={"error": error_msg},
            )
            return

        # 当前流程审批后已直接推 tag，若仍有构建回调则直接标记为 released
        release.status = "released"
        release.released_at = release.released_at or timezone.now()
        release.save(update_fields=["status", "released_at", "updated_at"])
        NotificationService.notify_build_result(build, release)
        OperationLogService.log_release(
            user=release.publisher,
            release=release,
            action="build_success",
        )

    @classmethod
    def push_tag(cls, release: ReleaseRecord, request_user=None) -> TagInfo:
        """
        推送 tag

        新 Tag 流程允许在 pending（审批完成）状态直接推 tag。

        Args:
            release: ReleaseRecord 实例
            request_user: 当前请求用户

        Returns:
            创建的 TagInfo
        """
        if release.status not in ("pending", "auditing"):
            raise serializers.ValidationError({"status": "只有待审批状态才能推 tag"})

        provider = cls._get_provider(release.repository, request_user)
        try:
            tag_info = provider.create_tag(
                repo_identity=release.repository.external_identity,
                tag_name=release.tag_name,
                commit_hash=release.git_hash,
                message=f"Release {release.version}",
            )
        except ProviderError as exc:
            release.status = "rejected"
            release.rejected_reason = f"推 tag 失败: {exc}"
            release.save(update_fields=["status", "rejected_reason", "updated_at"])
            raise serializers.ValidationError({"tag": f"推 tag 失败: {exc}"})

        release.status = "released"
        release.released_at = timezone.now()
        release.save(update_fields=["status", "released_at", "updated_at"])
        NotificationService.notify_release_released(release)
        OperationLogService.log_release(
            user=request_user or release.publisher,
            release=release,
            action="push_tag",
        )
        return tag_info

    @classmethod
    def push_tag_for_release(cls, release_id: str, request_user=None) -> TagInfo:
        """
        为指定发布记录推 tag（供审批完成或外部调用）

        Args:
            release_id: ReleaseRecord ID
            request_user: 当前请求用户

        Returns:
            创建的 TagInfo
        """
        release = ReleaseRecord.objects.get(id=release_id)
        return cls.push_tag(release, request_user)
