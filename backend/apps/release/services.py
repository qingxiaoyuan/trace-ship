"""
发布业务服务

封装版本号计算、发布校验、发布说明生成、推 tag 等发布核心流程。
"""
import logging
import re
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from django.conf import settings
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from apps.notification.services import NotificationService
from apps.project.models import Project
from apps.release.models import ReleaseCommit, ReleaseMergeRequest, ReleaseRecord
from apps.repository.models import CommitRecord, Repository
from apps.system.services import OperationLogService
from apps.workflow.models import WorkflowDefinition, WorkflowInstance
from apps.workflow.services import WorkflowEngine
from utils.commit_parser import extract_update_lines
from utils.provider.base import CommitInfo, GitProvider, MergeRequestInfo, TagInfo
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider

logger = logging.getLogger(__name__)


class ReleaseTagExistsError(serializers.ValidationError):
    """远端已存在同名 tag。"""


_TAG_LIST_CACHE_TTL = 60  # tag 列表短缓存（秒），供发布预览、版本号计算等只读场景复用


def tags_cache_key(repo_identity: str, server_url: str = "") -> str:
    """tag 列表缓存键（含服务端地址，避免同一仓库更换 GitLab 地址后读到旧缓存）"""
    return f"trace-ship:repo-tags:{server_url}:{repo_identity}"


def list_tags_cached(provider: GitProvider, repo_identity: str) -> list[TagInfo]:
    """
    带短 TTL 缓存的 list_tags

    发布预览、版本号计算等只读场景使用，60s 内的重复请求直接命中缓存；
    tag 查重等强一致场景仍应直接调用 provider.list_tags。

    Args:
        provider: GitProvider 实例
        repo_identity: 仓库标识

    Returns:
        TagInfo 列表
    """
    key = tags_cache_key(repo_identity, getattr(provider, "server_url", ""))
    try:
        cached = cache.get(key)
    except Exception:
        # 缓存后端不可用时降级为实时拉取
        cached = None
    if cached is not None:
        return cached
    tags = provider.list_tags(repo_identity)
    try:
        cache.set(key, tags, timeout=_TAG_LIST_CACHE_TTL)
    except Exception:
        pass
    return tags


class VersionCalculator:
    """
    版本号计算器

    基于结构化 version_rule（prefix / major / minor / patch / suffixes）解析最新 tag 并递增修订号。
    tag 格式：{prefix}.{major}.{minor}.{patch}(-{suffix})?(_{YYYYMMDD})?，
    前缀仅在配置时出现，rc/beta 在修订号后追加 -{suffix}；
    日期段在匹配时可选（兼容系统接入前的无日期历史 tag），新生成的 tag 仍强制拼接日期段。
    """

    # 默认后缀映射：beta → beta，rc → rc
    DEFAULT_SUFFIXES: dict[str, str] = {"rc": "rc", "beta": "beta"}

    # tag 末尾日期段（年月日 8 位数字）
    DATE_PATTERN = r"(?P<date>\d{8})"

    def __init__(self, version_rule: dict):
        """
        Args:
            version_rule: 结构化版本规则，含 prefix/major/minor/patch/suffixes
        """
        rule = version_rule or {}
        self.prefix: str = rule.get("prefix", "")
        self.major: int = int(rule.get("major", 1))
        self.minor: int = int(rule.get("minor", 0))
        self.patch: int = int(rule.get("patch", 0))
        self.suffixes: dict[str, str] = rule.get("suffixes") or dict(self.DEFAULT_SUFFIXES)
        # 是否在生成的 tag 末尾拼接 _YYYYMMDD 日期段，默认开启（兼容历史数据）
        self.with_date: bool = bool(rule.get("with_date", True))

    @staticmethod
    def today_str() -> str:
        """当天日期串（年月日），用于生成 tag 日期段"""
        return timezone.now().strftime("%Y%m%d")

    @property
    def initial_version(self) -> str:
        """初始版本号（不含后缀与日期）"""
        return self._format_version(self.major, self.minor, self.patch)

    def _format_version(self, major: int, minor: int, patch: int) -> str:
        """格式化纯版本号（不含日期段）"""
        base = f"{major}.{minor}.{patch}"
        return f"{self.prefix}.{base}" if self.prefix else base

    def _prefix_pattern(self) -> str:
        """前缀正则片段：配置了前缀则强制匹配"""
        if not self.prefix:
            return ""
        return f"{re.escape(self.prefix)}\\."

    def build_scan_regex(self) -> re.Pattern:
        """
        构建 tag 扫描正则（匹配全部发布类型）

        规则：{prefix}.主版本.次版本.修订版本(-后缀)?(_日期)?，
        后缀限定为版本规则中配置的后缀值，未配置时使用默认 rc/beta；
        日期段可选，以兼容系统接入前仓库已有的无日期历史 tag。
        只有匹配该正则的 tag 才允许入库。
        """
        suffix_values = [re.escape(s.strip("-")) for s in self.suffixes.values() if s and s.strip("-")]
        suffix_part = f"(?:-(?P<suffix>{'|'.join(suffix_values)}))?" if suffix_values else r"(?:-(?P<suffix>[A-Za-z0-9]+))?"
        pattern = (
            f"^{self._prefix_pattern()}"
            r"(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
            f"{suffix_part}(?:_{self.DATE_PATTERN})?$"
        )
        return re.compile(pattern)

    def _build_regex(self, release_type: str = "formal") -> re.Pattern:
        """
        构建匹配指定发布类型 tag 的正则

        formal：{prefix}.主.次.修(_日期)?
        rc/beta：{prefix}.主.次.修-{suffix}(_日期)?
        日期段可选，兼容系统接入前的无日期历史 tag。
        """
        version_core = r"(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
        date_part = f"(?:_{self.DATE_PATTERN})?"
        if release_type in ("rc", "beta"):
            suffix = (self.suffixes.get(release_type, "") or "").strip("-")
            if not suffix:
                # 后缀配置为空时永不匹配，避免退化为 formal 同款正则误匹配无后缀 tag
                return re.compile(r"(?!)")
            suffix_part = f"-{re.escape(suffix)}"
            pattern = f"^{self._prefix_pattern()}{version_core}{suffix_part}{date_part}$"
        else:
            pattern = f"^{self._prefix_pattern()}{version_core}{date_part}$"
        return re.compile(pattern)

    def sort_tags_by_recency(self, tags: list[TagInfo]) -> list[TagInfo]:
        """
        按"最新程度"排序 tag 列表（新→旧），不区分发布类型

        无创建时间的 tag 按版本号降序排到最前（历史遗留 tag 的兜底语义），
        有创建时间的 tag 按 created_at 倒序排列。
        供 Tag 区间审查（review-range）等场景使用。

        Args:
            tags: TagInfo 列表

        Returns:
            排序后的 TagInfo 列表
        """
        timed = sorted(
            (t for t in tags if t.created_at),
            key=lambda t: t.created_at,
            reverse=True,
        )
        untimed = sorted(
            (t for t in tags if not t.created_at),
            key=lambda t: self._tag_version_key(t.name),
            reverse=True,
        )
        return untimed + timed

    @staticmethod
    def _tag_version_key(name: str) -> tuple[int, int, int]:
        """从 tag 名提取 (major, minor, patch) 版本号排序键，无版本号退化为 (0, 0, 0)"""
        match = re.search(r"(\d+)\.(\d+)\.(\d+)", name)
        if match:
            return tuple(int(x) for x in match.groups())
        return (0, 0, 0)

    def find_latest_tag_info_by_type(
        self,
        tags: list[TagInfo],
        release_type: str,
    ) -> TagInfo | None:
        """
        按发布类型查找最新匹配的 tag 完整信息

        formal 取无后缀的 tag；rc/beta 取带对应后缀的 tag；
        先按版本号倒序取最大版本，同版本号时取日期段更新的 tag
        （无日期段视为最旧），规则与 find_latest_tag_by_type 一致。

        Args:
            tags: TagInfo 列表
            release_type: 发布类型 formal/rc/beta

        Returns:
            最新匹配 tag 的 TagInfo（含名称/commit/创建时间），无匹配时返回 None
        """
        regex = self._build_regex(release_type)
        candidates: list[tuple[TagInfo, tuple[int, ...], str]] = []
        for tag in tags:
            match = regex.match(tag.name)
            if not match:
                continue
            values = (int(match.group("major")), int(match.group("minor")), int(match.group("patch")))
            date = match.group("date") or ""
            candidates.append((tag, values, date))
        if not candidates:
            return None
        candidates.sort(key=lambda item: (item[1], item[2]), reverse=True)
        return candidates[0][0]

    def find_latest_tag_by_type(
        self,
        tags: list[TagInfo],
        release_type: str,
    ) -> str | None:
        """
        按发布类型查找最新匹配的 tag 原始名

        formal 取无后缀的 tag；rc/beta 取带对应后缀的 tag。

        Args:
            tags: TagInfo 列表
            release_type: 发布类型 formal/rc/beta

        Returns:
            最新匹配 tag 的原始名，无匹配时返回 None
        """
        latest = self.find_latest_tag_info_by_type(tags, release_type)
        return latest.name if latest else None

    def find_latest_matching_tag(
        self,
        tags: list[TagInfo],
    ) -> tuple[TagInfo, dict[str, int]] | None:
        """
        从 tag 列表中找到最新正式版 tag（无类型后缀，含日期段）

        Args:
            tags: TagInfo 列表

        Returns:
            (TagInfo, 版本字段字典) 元组，无匹配时返回 None
        """
        regex = self._build_regex("formal")
        candidates: list[tuple[TagInfo, tuple[int, int, int]]] = []
        for tag in tags:
            match = regex.match(tag.name)
            if not match:
                continue
            values = (int(match.group("major")), int(match.group("minor")), int(match.group("patch")))
            candidates.append((tag, values))
        if not candidates:
            return None
        candidates.sort(key=lambda item: item[1], reverse=True)
        tag, values = candidates[0]
        return tag, {"major": values[0], "minor": values[1], "patch": values[2]}

    def calculate(
        self,
        tags: list[TagInfo],
        release_type: str = "formal",
    ) -> tuple[str, str]:
        """
        计算下一个版本号和 tag 名称

        按发布类型独立过滤 tag：匹配该类型的 tag
        （formal 无后缀 / rc 带 -rc / beta 带 -beta，日期段可选），
        找到最大版本号后修订号 +1，无匹配时使用初始版本。
        生成的 tag 名称自动拼接当天日期段 _YYYYMMDD。

        Args:
            tags: 当前仓库的 tag 列表
            release_type: 发布类型 formal/rc/beta

        Returns:
            (version, tag_name) 元组，version 为纯版本号，tag_name 含后缀与日期段
        """
        type_regex = self._build_regex(release_type)
        best: tuple[int, int, int] | None = None
        for t in tags:
            match = type_regex.match(t.name)
            if not match:
                continue
            values = (int(match.group("major")), int(match.group("minor")), int(match.group("patch")))
            if best is None or values > best:
                best = values

        if best is None:
            version = self.initial_version
        else:
            version = self._format_version(best[0], best[1], best[2] + 1)

        # 按发布类型追加后缀，并按规则决定是否拼接当天日期段
        if release_type in ("rc", "beta"):
            suffix = (self.suffixes.get(release_type, "") or "").strip("-")
            tag_name = f"{version}-{suffix}" if suffix else version
        else:
            tag_name = version
        if self.with_date:
            tag_name = f"{tag_name}_{self.today_str()}"
        return version, tag_name


class ReleaseValidator:
    """
    发布校验器

    校验项目状态、分支规则、后缀规则、发布周期等业务规则。
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
            "release_cycle_days": int(rule.get("release_cycle_days", 3)),
        }

    @staticmethod
    def get_default_suffixes() -> dict[str, str]:
        """
        获取默认后缀配置

        Returns:
            发布类型到后缀的映射
        """
        return {"rc": "rc", "beta": "beta"}

    @staticmethod
    def strip_suffix(tag_name: str, version_rule: dict) -> str:
        """
        从 tag 名去除日期段与类型后缀，反推出纯版本号

        Args:
            tag_name: tag 名称，如 VA.1.0.3-rc_20260816
            version_rule: 版本规则

        Returns:
            去除后缀与日期段后的版本号，如 VA.1.0.3
        """
        suffixes = (version_rule or {}).get("suffixes") or ReleaseValidator.get_default_suffixes()
        all_suffixes = set((s or "").strip("-") for s in suffixes.values() if (s or "").strip("-"))
        # 先去掉末尾 _YYYYMMDD 日期段
        version = re.sub(r"_\d{8}$", "", tag_name)
        for s in all_suffixes:
            if s and version.endswith(f"-{s}"):
                version = version[: -(len(s) + 1)]
                break
        return version

    @staticmethod
    def ensure_tag_date(tag_name: str, version_rule: dict = None) -> str:
        """
        确保 tag 名称带 _YYYYMMDD 日期段，缺失时拼接当天日期

        当 version_rule 的 with_date 为 False 时不拼接日期段，直接返回原值。

        Args:
            tag_name: tag 名称
            version_rule: 版本规则（含 with_date 开关）

        Returns:
            带日期段的 tag 名称
        """
        with_date = bool((version_rule or {}).get("with_date", True))
        if not with_date:
            return tag_name
        if re.search(r"_\d{8}$", tag_name):
            return tag_name
        return f"{tag_name}_{VersionCalculator.today_str()}"

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
    def validate_tag_suffix(
        release_type: str,
        tag_name: str,
        version_rule: dict,
    ) -> None:
        """
        校验 tag 后缀

        Args:
            release_type: 发布类型
            tag_name: tag 名称
            version_rule: 版本规则

        Raises:
            serializers.ValidationError: 校验失败
        """
        if release_type in ("rc", "beta"):
            suffixes = (version_rule or {}).get("suffixes") or ReleaseValidator.get_default_suffixes()
            suffix = (suffixes.get(release_type, "") or "").strip("-")
            # 兼容带不带 _日期 段两种形态，后缀需位于日期段之前
            if suffix and not re.search(f"-{re.escape(suffix)}(?:_\\d{{8}})?$", tag_name):
                raise serializers.ValidationError(
                    {"tag_name": f"{release_type} 版本 tag 必须以 -{suffix} 结尾（日期段之前）"}
                )

    @staticmethod
    def validate_release_cycle(project: Project, release_type: str, release_rule: dict) -> None:
        """
        校验正式发布周期

        当前不再限制发布频率，保留方法以兼容历史调用点。

        Args:
            project: 项目实例
            release_type: 发布类型
            release_rule: 发布规则
        """
        return


class ReleaseDocGenerator:
    """
    发布说明生成器

    聚合发布分支到上一个 tag 之间的 commits 与 MRs，由 release 已保存的表单字段
    组装 2 列 Markdown 表格发布说明文档。
    """

    def __init__(self, release: ReleaseRecord, provider: GitProvider):
        """
        Args:
            release: 发布记录实例
            provider: GitProvider 实例
        """
        self.release = release
        self.provider = provider

    def _get_last_tag(self) -> str | None:
        """
        获取仓库中匹配 version_rule 的最新 tag 名称

        按发布类型（formal/rc/beta）分别取对应类型的最新 tag，
        与 changes-preview 预览基线保持一致。

        Returns:
            tag 名称或 None
        """
        try:
            tags = self.provider.list_tags(self.release.repository.external_identity)
        except ProviderError:
            return None
        calculator = VersionCalculator(self.release.repository.get_version_rule())
        return calculator.find_latest_tag_by_type(tags, self.release.release_type or "formal")

    def _fetch_commits(self) -> list[CommitInfo]:
        """
        拉取用于生成发布说明的 commits

        优先比较上一个 tag 到发布分支；无 tag 时拉取发布分支全部 commits。

        Returns:
            CommitInfo 列表
        """
        repo_identity = self.release.repository.external_identity
        last_tag = self._get_last_tag()
        if last_tag:
            try:
                return self.provider.compare_commits(repo_identity, base=last_tag, head=self.release.branch)
            except Exception as exc:
                logger.warning("比较发布提交失败，将回退到分支提交列表: %s", exc)
        try:
            return self.provider.list_commits(repo_identity, self.release.branch)
        except Exception as exc:
            logger.warning("拉取发布提交失败，将继续生成基础发布说明: %s", exc)
            return []

    def _fetch_merge_requests(self) -> list[MergeRequestInfo]:
        """
        拉取合并到发布分支的 MR 列表

        Returns:
            MergeRequestInfo 列表
        """
        try:
            return self.provider.list_merge_requests(
                self.release.repository.external_identity,
                target_branch=self.release.branch,
            )
        except Exception as exc:
            logger.warning("拉取发布 MR/PR 失败，将继续生成基础发布说明: %s", exc)
            return []

    @staticmethod
    def _filter_commits(commits: list[CommitInfo], commit_ids: list[str] | None = None) -> list[CommitInfo]:
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
    def _build_markdown_doc(release: ReleaseRecord) -> str:
        """
        由 release 已保存的表单字段组装 2 列 Markdown 表格发布说明文档

        按需求顺序包含：当前发布版本号、Git提交hash、变更类型、变更内容、
        配置项改动、关联项改动、是否影响其他功能、测试验证、发布人

        Args:
            release: 发布记录实例

        Returns:
            Markdown 字符串
        """
        rows: list[tuple[str, str]] = []

        # 当前发布版本号
        rows.append(("当前发布版本号", release.version or "-"))

        # Git提交hash
        rows.append(("Git提交hash", release.git_hash or "-"))

        # 变更类型
        change_type = "有配置项改动" if release.has_config_changes else "无配置项改动"
        rows.append(("变更类型", change_type))

        # 变更内容（多行合并在一个单元格内，用换行分隔，不使用 <br>）
        updates = release.updates or []
        if updates:
            lines: list[str] = []
            for item in updates:
                if not isinstance(item, dict):
                    continue
                utype = item.get("type", "")
                content = item.get("content", "")
                lines.append(f"{utype} {content}".strip())
            rows.append(("变更内容", "\n".join(lines)))
        else:
            rows.append(("变更内容", "无"))

        # 配置项改动
        if release.has_config_changes:
            cfg_doc = release.config_change_doc or "无"
            rows.append(("配置项改动", cfg_doc))
        else:
            rows.append(("配置项改动", "无"))

        # 关联项改动（多行合并在一个单元格内，用换行分隔，不使用 <br>）
        related = release.related_changes or []
        if related:
            related_lines: list[str] = []
            for item in related:
                if isinstance(item, dict):
                    key = item.get("key", "")
                    val = item.get("value", "")
                    related_lines.append(f"{key}: {val}".strip(": ").strip())
            rows.append(("关联项改动", "\n".join(related_lines) if related_lines else "无"))
        else:
            rows.append(("关联项改动", "无"))

        # 是否影响其他功能
        if release.impact_other:
            rows.append(("是否影响其他功能", release.impact_desc or "是"))
        else:
            rows.append(("是否影响其他功能", "否"))

        # 测试验证
        checks = []
        if release.self_test_passed:
            checks.append("自测试通过")
        if release.retest_passed:
            checks.append("研发测试复验通过")
        rows.append(("测试验证", "、".join(checks) if checks else "未完成"))

        # 发布人
        publisher_name = ""
        if release.publisher:
            publisher_name = getattr(release.publisher, "nickname", "") or release.publisher.username
        rows.append(("发布人", publisher_name or "-"))

        # 构建 Markdown 表格（保留最小表头以兼容 MD 语法）
        lines = ["| 项目 | 内容 |", "|------|------|"]
        for label, content in rows:
            # 转义管道符避免破坏表格结构
            safe = content.replace("|", "\\|")
            lines.append(f"| {label} | {safe} |")
        return "\n".join(lines)

    def generate(self, commit_ids: list[str] | None = None, merge_similar: bool = True) -> str:
        """
        生成发布说明 Markdown 文档并持久化关联 commits / MRs

        Args:
            commit_ids: 指定纳入的 commit ID 列表，为空时包含所有非非法提交
            merge_similar: 是否合并相似更新项（保留参数兼容旧调用，当前由前端去重）

        Returns:
            Markdown 字符串
        """
        commits = self._fetch_commits()
        commits = self._filter_commits(commits, commit_ids)
        merge_requests = self._fetch_merge_requests()

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
                    "branch": self.release.branch,
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

        # 持久化 ReleaseMergeRequest 关联
        new_mr_numbers = set()
        for mr in merge_requests:
            number = mr.number
            new_mr_numbers.add(number)
            ReleaseMergeRequest.objects.update_or_create(
                release=self.release,
                mr_number=number,
                defaults={
                    "title": mr.title,
                    "description": mr.description,
                    "author": mr.author,
                    "source_branch": mr.source_branch,
                    "target_branch": mr.target_branch,
                    "web_url": mr.web_url,
                    "merged_at": mr.merged_at,
                },
            )

        # 删除不再包含的 MR
        self.release.release_mrs.exclude(mr_number__in=new_mr_numbers).delete()

        # 由 release 表单字段生成 Markdown 文档
        return self._build_markdown_doc(self.release)


class ReleaseService:
    """
    发布流程服务

    封装创建发布、生成发布说明、提交审批、推 tag 等核心业务逻辑。
    """

    @staticmethod
    def empty_draft_filter() -> Q:
        """返回可安全清理的空草稿条件。"""
        return (
            Q(release_doc="")
            & Q(related_changes=[])
            & Q(updates=[])
            & Q(has_config_changes=False)
            & Q(config_change_doc="")
            & Q(impact_other=False)
            & Q(impact_desc="")
            & Q(self_test_passed=False)
            & Q(retest_passed=False)
        )

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

    @staticmethod
    def _validate_tag_not_exists(
        provider: GitProvider,
        repository: Repository,
        tag_name: str,
        exists_message: str = "Tag 已存在，不能创建发布草稿",
    ) -> None:
        """
        校验远端仓库不存在同名 tag。

        Args:
            provider: 仓库 Provider
            repository: 目标仓库
            tag_name: 最终要创建的 tag 名称

        Raises:
            serializers.ValidationError: tag 已存在或查询失败
        """
        try:
            tags = provider.list_tags(repository.external_identity)
        except ProviderError as exc:
            raise serializers.ValidationError({"tag_name": f"校验 tag 是否存在失败: {exc}"})
        if any(tag.name == tag_name for tag in tags):
            raise ReleaseTagExistsError({"tag_name": exists_message})

    @classmethod
    def validate_tag_not_exists(
        cls,
        repository: Repository,
        tag_name: str,
        request_user=None,
    ) -> None:
        """
        对外提供草稿编辑等场景使用的 tag 查重校验。

        Args:
            repository: 目标仓库
            tag_name: 最终要创建的 tag 名称
            request_user: 当前请求用户
        """
        provider = cls._get_provider(repository, request_user)
        cls._validate_tag_not_exists(provider, repository, tag_name)

    @classmethod
    def create_release(
        cls,
        project: Project,
        repository: Repository,
        release_type: str,
        branch: str,
        publisher,
        version: str | None = None,
        tag_name: str | None = None,
        related_changes: list | None = None,
        updates: list | None = None,
        has_config_changes: bool = False,
        config_change_doc: str = "",
        impact_other: bool = False,
        impact_desc: str = "",
        self_test_passed: bool = False,
        retest_passed: bool = False,
    ) -> ReleaseRecord:
        """
        创建发布申请

        Args:
            project: 项目实例
            repository: 目标仓库实例
            release_type: 发布类型
            branch: 发布分支
            publisher: 发布人
            version: 可选的版本号，为空时自动计算
            tag_name: 可选的 tag 名称，为空时根据版本号与发布类型自动计算
            related_changes: 关联变更清单（硬件/软件版本条目列表）
            updates: 变更条目（A/F 类变更内容）
            has_config_changes: 是否有配置项改动
            config_change_doc: 配置项变更文档
            impact_other: 是否影响其他功能
            impact_desc: 影响范围说明
            self_test_passed: 自测试通过
            retest_passed: 研发测试复验通过

        Returns:
            新创建的 ReleaseRecord
        """
        ReleaseValidator.validate_project_status(project)
        release_rule = ReleaseValidator.get_release_rule(project)
        version_rule = repository.get_version_rule()

        provider = cls._get_provider(repository, publisher)
        tags: list[TagInfo] | None = None

        # 若未传 version 但传了 tag_name，从 tag_name 去后缀反推 version
        if not version and tag_name:
            version = ReleaseValidator.strip_suffix(tag_name, version_rule)

        if not version:
            try:
                tags = provider.list_tags(repository.external_identity)
            except ProviderError as exc:
                raise serializers.ValidationError({"repository": f"获取 tag 列表失败: {exc}"})
            calculator = VersionCalculator(version_rule)
            version, auto_tag_name = calculator.calculate(
                tags,
                release_type=release_type,
            )
        else:
            # 手动传 version 时按 release_type 追加后缀，并拼接日期段
            if release_type in ("rc", "beta"):
                suffixes = version_rule.get("suffixes") or ReleaseValidator.get_default_suffixes()
                suffix = (suffixes.get(release_type, "") or "").strip("-")
                auto_tag_name = version
                if suffix and not auto_tag_name.endswith(f"-{suffix}"):
                    auto_tag_name = f"{auto_tag_name}-{suffix}"
            else:
                auto_tag_name = version
            auto_tag_name = ReleaseValidator.ensure_tag_date(auto_tag_name, version_rule)

        # tag_name 优先使用传入值，rc/beta 类型自动补后缀，统一补齐日期段
        if tag_name:
            if release_type in ("rc", "beta"):
                suffixes = version_rule.get("suffixes") or ReleaseValidator.get_default_suffixes()
                suffix = (suffixes.get(release_type, "") or "").strip("-")
                if suffix and not re.search(f"-{re.escape(suffix)}(?:_\\d{{8}})?$", tag_name):
                    if re.search(r"_\d{8}$", tag_name):
                        # 已带日期段但缺后缀：在日期段前插入后缀
                        tag_name = f"{tag_name[:-9]}-{suffix}{tag_name[-9:]}"
                    else:
                        tag_name = f"{tag_name}-{suffix}"
            tag_name = ReleaseValidator.ensure_tag_date(tag_name, version_rule)
        else:
            tag_name = auto_tag_name

        ReleaseValidator.validate_tag_suffix(release_type, tag_name, version_rule)
        ReleaseValidator.validate_release_cycle(project, release_type, release_rule)
        if tags is None:
            cls._validate_tag_not_exists(provider, repository, tag_name)
        elif any(tag.name == tag_name for tag in tags):
            raise serializers.ValidationError({"tag_name": "Tag 已存在，不能创建发布草稿"})

        git_hash = cls._resolve_branch_head_hash(repository, branch, publisher)

        # 同一发布人反复创建同版本空草稿时清理旧草稿，避免临时草稿堆积。
        ReleaseRecord.objects.filter(
            project=project,
            repository=repository,
            version=version,
            status="draft",
            publisher=publisher,
        ).filter(cls.empty_draft_filter()).delete()

        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version=version,
            tag_name=tag_name,
            branch=branch,
            git_hash=git_hash,
            release_type=release_type,
            status="draft",
            publisher=publisher,
            related_changes=related_changes or [],
            updates=updates or [],
            has_config_changes=has_config_changes,
            config_change_doc=config_change_doc or "",
            impact_other=impact_other,
            impact_desc=impact_desc or "",
            self_test_passed=self_test_passed,
            retest_passed=retest_passed,
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
        commit_ids: list[str] | None = None,
        merge_similar: bool = True,
        request_user=None,
    ) -> str:
        """
        生成并保存发布说明 Markdown 文档

        Args:
            release: ReleaseRecord 实例
            commit_ids: 可选的 commit ID 列表
            merge_similar: 是否合并相似更新项
            request_user: 当前请求用户

        Returns:
            Markdown 字符串
        """
        provider = cls._get_provider(release.repository, request_user)
        generator = ReleaseDocGenerator(release, provider)
        md_doc = generator.generate(commit_ids=commit_ids, merge_similar=merge_similar)
        release.release_doc = md_doc
        release.save(update_fields=["release_doc", "updated_at"])
        return md_doc

    @staticmethod
    def update_doc(release: ReleaseRecord, md_content: str) -> ReleaseRecord:
        """
        手动更新发布说明 Markdown 文档

        Args:
            release: ReleaseRecord 实例
            md_content: 用户编辑后的 Markdown 文档

        Returns:
            更新后的 ReleaseRecord
        """
        release.release_doc = md_content
        release.save(update_fields=["release_doc", "updated_at"])
        return release

    @staticmethod
    def preview_changes(
        repository: Repository,
        branch: str,
        request_user=None,
        release_type: str = "formal",
    ) -> dict:
        """
        预览上个 Tag 到本次基线之间的 commits 与 MRs，并自动解析更新内容

        先并发拉取 tag 列表（短 TTL 缓存）与当前分支最新 N 条提交记录
        （settings.RELEASE_PREVIEW_MAX_COMMITS，默认 100），再按上一个 tag 的
        commit hash 截断取 tag 之后的提交；若 N 条内未找到 tag commit，
        先通过 merge_base 校验 tag 是否为分支祖先，是则回退 compare_commits
        接口取区间差异，否则说明 tag 不在该分支历史上（如跨分支打 tag），
        保守取本分支最新 N 条提交。无匹配 tag 时同样取最新 N 条提交。
        上一个 tag 按发布类型分别查找：formal 取最新正式 tag，
        rc/beta 取各自类型（-rc / -beta）的最新 tag。

        Args:
            repository: 仓库实例
            branch: 发布分支
            release_type: 发布类型 formal/rc/beta
            request_user: 当前请求用户

        Returns:
            预览数据字典
        """
        provider = ReleaseService._get_provider(repository, request_user)
        repo_identity = repository.external_identity
        max_commits = int(getattr(settings, "RELEASE_PREVIEW_MAX_COMMITS", 100))

        # 并发拉取 tag 列表与本分支提交记录（两者无依赖），缩短预览等待
        with ThreadPoolExecutor(max_workers=2) as executor:
            tags_future = executor.submit(list_tags_cached, provider, repo_identity)
            commits_future = executor.submit(
                provider.list_commits, repo_identity, branch, per_page=max_commits
            )
            try:
                tags = tags_future.result()
            except Exception:
                tags = []
            try:
                all_commits = commits_future.result()
            except Exception:
                all_commits = []

        # 分支 HEAD 即提交列表首条（新→旧），获取失败时为空
        head_commit: CommitInfo | None = all_commits[0] if all_commits else None

        # 获取本分支最新匹配 tag（按发布类型区分 formal/rc/beta）
        last_tag: str | None = None
        tag_commit_hash: str | None = None
        tag_created_at: datetime | None = None
        calculator = VersionCalculator(repository.get_version_rule())
        latest = calculator.find_latest_tag_info_by_type(tags, release_type)
        if latest:
            last_tag = latest.name
            tag_commit_hash = latest.commit_hash
            tag_created_at = latest.created_at

        # 与上一个 tag 对比：在提交列表中找到 tag 对应的 commit，取其后的所有提交
        commits: list[CommitInfo] = []
        if last_tag and tag_commit_hash:
            tag_found = False
            for c in all_commits:
                if c.hash == tag_commit_hash:
                    tag_found = True
                    break
                commits.append(c)
            # 若未在最新 N 条内找到 tag commit：先校验 tag 是否为分支祖先，
            # 是祖先才回退 compare_commits 取区间差异，避免跨分支 tag 被误当基线
            if not tag_found and all_commits:
                merge_base: str | None = None
                try:
                    merge_base = provider.get_merge_base(repo_identity, [last_tag, branch])
                except Exception:
                    merge_base = None
                if merge_base and merge_base == tag_commit_hash:
                    try:
                        commits = provider.compare_commits(repo_identity, base=last_tag, head=branch)
                    except ProviderError:
                        commits = all_commits
                else:
                    # 无法确认祖先关系或 tag 不在该分支历史上：保守取本分支最新 N 条
                    commits = all_commits
        else:
            commits = all_commits

        # 过滤非法提交：预览接口不落库，按 commit message 是否包含有效 A/F 行实时判断
        commits = [c for c in commits if extract_update_lines(c.message)]

        # 拉取 MRs，并按 tag 时间过滤：只保留 tag 之后合并到本分支的 MR
        merge_requests: list[MergeRequestInfo] = []
        try:
            merge_requests = provider.list_merge_requests(
                repo_identity, target_branch=branch, since=tag_created_at
            )
            # 兜底过滤：merged_at 早于 tag 创建时间的 MR 不纳入本次发布
            if tag_created_at:
                merge_requests = [
                    mr for mr in merge_requests
                    if mr.merged_at and mr.merged_at >= tag_created_at
                ]
        except ProviderError:
            merge_requests = []

        # 获取分支 HEAD
        head_hash = head_commit.hash if head_commit else ""

        # 解析更新内容
        parsed_updates: list[dict[str, str]] = []
        seen: set = set()
        for commit in commits:
            for item in extract_update_lines(commit.message):
                key = (item["type"], item["content"])
                if key in seen:
                    continue
                seen.add(key)
                parsed_updates.append({
                    "type": item["type"],
                    "content": item["content"],
                    "source": "commit",
                    "source_ref": commit.hash[:8],
                })
        for mr in merge_requests:
            for item in extract_update_lines(mr.description):
                key = (item["type"], item["content"])
                if key in seen:
                    continue
                seen.add(key)
                parsed_updates.append({
                    "type": item["type"],
                    "content": item["content"],
                    "source": "mr",
                    "source_ref": mr.number,
                })

        return {
            "last_tag": last_tag,
            "head_hash": head_hash,
            "commits": [
                {
                    "hash": c.hash,
                    "author": c.author,
                    "message": c.message,
                    "committed_at": c.committed_at.isoformat() if c.committed_at else None,
                    "has_af": bool(extract_update_lines(c.message)),
                }
                for c in commits
            ],
            "merge_requests": [
                {
                    "number": mr.number,
                    "title": mr.title,
                    "description": mr.description,
                    "author": mr.author,
                    "source_branch": mr.source_branch,
                    "target_branch": mr.target_branch,
                    "web_url": mr.web_url,
                    "merged_at": mr.merged_at.isoformat() if mr.merged_at else None,
                    "has_af": bool(extract_update_lines(mr.description)),
                }
                for mr in merge_requests
            ],
            "parsed_updates": parsed_updates,
        }

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

        # 按发布类型查找项目生效的发布审批流程定义
        definition = WorkflowDefinition.objects.filter(
            project=release.project,
            biz_type="release",
            release_type=release.release_type,
            is_active=True,
        ).first()
        if not definition:
            raise serializers.ValidationError(
                {"workflow": f"项目未配置 {release.release_type} 发布审批流程"}
            )

        # 若流程定义没有中间审批节点，直接推 tag 发布
        if not definition.node_config:
            release.status = "pending"
            release.save(update_fields=["status", "updated_at"])
            return ReleaseService.push_tag(release, request_user=user)

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
            logger.warning(
                "审批完成回调未找到关联发布单: instance=%s biz_id=%s",
                instance.id, instance.biz_id,
            )
            return

        if release.status == "pending":
            try:
                ReleaseService.push_tag(release)
            except Exception:
                # push_tag 内部已设置 rejected 状态；此处记录堆栈便于排查
                logger.exception(
                    "审批通过后推 tag 失败: release=%s version=%s tag=%s",
                    release.id, release.version, release.tag_name,
                )
        else:
            logger.warning(
                "审批完成时发布单状态非 pending，跳过推 tag: release=%s status=%s",
                release.id, release.status,
            )

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
    def handle_workflow_rollback_to_start(
        instance: WorkflowInstance,
        comment: str = "",
    ) -> None:
        """
        工作流驳回至初始节点时驱动发布状态

        与 handle_workflow_rejected 的区别：驳回至初始节点视为流程作废，
        不改变发布为"已驳回"，而是将其恢复为草稿态并解除与流程实例的关联，
        由视图层在调用此方法后删除该流程实例。

        Args:
            instance: WorkflowInstance 实例
            comment: 驳回意见
        """
        release = ReleaseRecord.objects.filter(workflow_instance=instance).first()
        if not release:
            return
        release.status = "draft"
        release.workflow_instance = None
        release.rejected_reason = comment or ""
        release.save(update_fields=[
            "status", "workflow_instance", "rejected_reason", "updated_at",
        ])

    @classmethod
    def push_tag(cls, release: ReleaseRecord, request_user=None) -> TagInfo:
        """
        推送 tag

        审批流程完成后才能推 tag：若存在关联工作流实例，必须处于 completed 状态。

        Args:
            release: ReleaseRecord 实例
            request_user: 当前请求用户

        Returns:
            创建的 TagInfo
        """
        if release.status != "pending":
            raise serializers.ValidationError({"status": "只有待审批状态才能推 tag"})

        # 校验审批流程已结束，避免工作流仍 running 时提前推 tag
        if release.workflow_instance_id and release.workflow_instance.status != "completed":
            raise serializers.ValidationError(
                {"workflow": "审批流程尚未结束，无法推 tag"}
            )

        logger.info(
            "开始推 tag: release=%s version=%s tag=%s repo=%s commit=%s",
            release.id, release.version, release.tag_name,
            release.repository.external_identity, release.git_hash,
        )
        provider = cls._get_provider(release.repository, request_user)
        user = request_user or release.publisher
        try:
            cls._validate_tag_not_exists(
                provider,
                release.repository,
                release.tag_name,
                exists_message="Tag 已存在，无法推送发布",
            )
            tag_info = provider.create_tag(
                repo_identity=release.repository.external_identity,
                tag_name=release.tag_name,
                commit_hash=release.git_hash,
                message="",
            )
        except ReleaseTagExistsError as exc:
            release.status = "rejected"
            release.rejected_reason = f"推 tag 失败: {exc}"
            release.save(update_fields=["status", "rejected_reason", "updated_at"])
            logger.warning("推 tag 失败(tag 已存在): release=%s tag=%s err=%s", release.id, release.tag_name, exc)
            OperationLogService.log_release(
                user=user,
                release=release,
                action="push_tag",
                result="failure",
                detail={"error": str(exc), "traceback": traceback.format_exc()},
            )
            raise
        except ProviderError as exc:
            release.status = "rejected"
            release.rejected_reason = f"推 tag 失败: {exc}"
            release.save(update_fields=["status", "rejected_reason", "updated_at"])
            logger.warning("推 tag 失败(Provider 错误): release=%s tag=%s err=%s", release.id, release.tag_name, exc)
            OperationLogService.log_release(
                user=user,
                release=release,
                action="push_tag",
                result="failure",
                detail={"error": str(exc), "traceback": traceback.format_exc()},
            )
            raise serializers.ValidationError({"tag": f"推 tag 失败: {exc}"})
        except Exception:
            # 非 Provider 异常（凭证解密、网络等）不会进入上面两个分支，必须留痕
            OperationLogService.log_release(
                user=user,
                release=release,
                action="push_tag",
                result="failure",
                detail={"error": "推 tag 出现未预期异常", "traceback": traceback.format_exc()},
            )
            logger.exception(
                "推 tag 出现未预期异常: release=%s version=%s tag=%s",
                release.id, release.version, release.tag_name,
            )
            raise

        release.status = "released"
        release.released_at = timezone.now()
        release.save(update_fields=["status", "released_at", "updated_at"])
        # 推 tag 成功后失效 tag 列表缓存，保证预览/版本号计算立即看到新 tag
        try:
            from apps.repository.services import RepositoryService

            cache.delete(
                tags_cache_key(
                    release.repository.external_identity,
                    RepositoryService._resolve_server_url(release.repository),
                )
            )
        except Exception:
            pass
        logger.info("推 tag 成功，发布完成: release=%s tag=%s", release.id, release.tag_name)
        NotificationService.notify_release_released(release)
        try:
            from apps.package.services import PackageService

            PackageService.trigger_auto_packages_for_release(release, request_user=request_user or release.publisher)
        except Exception as exc:
            OperationLogService.log_release(
                user=user,
                release=release,
                action="auto_package_trigger",
                result="failure",
                detail={"error": str(exc), "traceback": traceback.format_exc()},
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
