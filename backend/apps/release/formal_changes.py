"""正式发布累计变更：固定提交边界、完整提交与可核实的 MR。"""

import re
from dataclasses import asdict

from rest_framework import serializers

from apps.release.models import ReleaseRecord
from utils.commit_parser import extract_update_lines
from utils.provider.base import GitProvider


class FormalChanges:
    """共享预览与说明生成的正式发布区间，失败时不回退移动分支。"""

    @staticmethod
    def reset(release: ReleaseRecord) -> None:
        """身份改变后清空所有派生数据，由调用方同事务保存并删除关联。"""
        release.base_tag = ""
        release.base_git_hash = ""
        release.changes_initialized = False
        release.changes_warnings = []
        release.release_doc = ""
        release.updates = []
        release.related_changes = []

    @staticmethod
    def identity_rows(release: ReleaseRecord) -> list[tuple[str, str]]:
        """正式说明的系统身份字段，同时用于渲染与保存校验。"""
        scope = (
            "首次正式发布：截至来源提交的全部可达历史"
            if not release.base_git_hash
            else (
                "无新增代码：来源提交与上一正式版相同"
                if release.base_git_hash == release.git_hash
                else "上一正式版至来源 RC 的累计变更"
            )
        )
        return [
            ("当前发布版本号", release.version),
            ("Git提交hash", release.git_hash),
            ("来源 RC", release.source_rc_tag),
            ("正式基线", release.base_tag or "首次正式发布"),
            ("基线提交", release.base_git_hash or "无"),
            ("变更范围", scope),
        ]

    @classmethod
    def validate_doc_identity(cls, release: ReleaseRecord, content: str) -> None:
        if not release.changes_initialized:
            raise serializers.ValidationError({"release_doc": "请先生成正式发布说明，固定累计变更基线"})
        for label, value in cls.identity_rows(release):
            expected = value.replace("|", "\\|")
            rows = re.findall(rf"^\|\s*{re.escape(label)}\s*\| (.*) \|$", content, re.MULTILINE)
            if rows != [expected]:
                raise serializers.ValidationError({"release_doc": f"{label}由系统维护，请重新生成说明后编辑人工内容"})

    @staticmethod
    def baseline(release: ReleaseRecord, provider: GitProvider) -> tuple[str, str]:
        from apps.release.services import VersionCalculator

        if release.changes_initialized:
            return release.base_tag, release.base_git_hash
        pattern = VersionCalculator(release.repository.get_version_rule()).build_scan_regex()

        def version_key(name: str) -> tuple[int, int, int] | None:
            match = pattern.fullmatch(name)
            if match is None or match.group("suffix"):
                return None
            return tuple(int(match.group(part)) for part in ("major", "minor", "patch"))

        target = version_key(release.version)
        if target is None:
            raise serializers.ValidationError({"version": "正式版本号不符合仓库规则，无法确定累计变更基线"})
        tags = {tag.name: tag.commit_hash or "" for tag in provider.list_tags(release.repository.external_identity)}
        # 历史正式发布的提交快照优先于可能被改写的远端同名 Tag。
        for previous in ReleaseRecord.objects.filter(
            repository=release.repository, release_type="formal", status="released"
        ):
            if previous.git_hash:
                tags[previous.tag_name] = previous.git_hash
        candidates = [(version_key(name), name, sha) for name, sha in tags.items()]
        candidates = [item for item in candidates if item[0] is not None and item[0] < target]
        if not candidates:
            return "", ""
        highest = max(item[0] for item in candidates)
        latest = [item for item in candidates if item[0] == highest]
        if len({item[2] for item in latest}) > 1:
            raise serializers.ValidationError({"base_tag": "上一正式版本存在不同提交，请先核对发布历史"})
        _, name, sha = max(latest, key=lambda item: item[1])
        if not re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", sha):
            raise serializers.ValidationError({"base_tag": "上一正式版缺少完整提交，无法生成累计说明"})
        return name, sha

    @classmethod
    def collect(cls, release: ReleaseRecord, provider: GitProvider) -> dict:
        head = release.source_rc_git_hash
        if release.release_type != "formal" or not release.source_rc_id or not head or head != release.git_hash:
            raise serializers.ValidationError({"source_rc": "请先选择有效来源 RC，再生成正式发布说明"})
        base_tag, base = cls.baseline(release, provider)
        if (
            base
            and base != head
            and provider.get_merge_base(release.repository.external_identity, [base, head]) != base
        ):
            raise serializers.ValidationError(
                {"base_tag": "上一正式提交不在来源 RC 的祖先链上，请单独处理回滚或分叉发布"}
            )
        commits = (
            [] if base == head else provider.list_release_commits(release.repository.external_identity, base, head)
        )
        if base != head and not commits:
            raise serializers.ValidationError({"commits": "无法获取完整正式变更区间，请核对来源提交"})
        hashes = {commit.hash for commit in commits}
        included_mrs, warnings = [], []
        for mr in provider.list_release_merge_requests(release.repository.external_identity):
            evidence = {getattr(mr, "merge_commit_sha", ""), getattr(mr, "squash_commit_sha", "")} - {"", None}
            if evidence & hashes:
                included_mrs.append(mr)
            elif not evidence:
                warnings.append(f"MR !{mr.number} 缺少可核实的合并提交，未自动纳入")
        updates, seen = [], set()
        for source, items in (("commit", commits), ("mr", included_mrs)):
            for item in items:
                content = item.message if source == "commit" else item.description
                reference = item.hash if source == "commit" else item.number
                for update in extract_update_lines(content):
                    key = (update["type"], update["content"])
                    if key not in seen:
                        updates.append({**update, "source": source, "source_ref": reference})
                        seen.add(key)
        return {
            "base_tag": base_tag,
            "base_git_hash": base,
            "head_hash": head,
            "commits": commits,
            "merge_requests": included_mrs,
            "parsed_updates": updates,
            "warnings": warnings,
            "first_release": not base,
            "no_changes": base == head,
        }

    @staticmethod
    def preview(data: dict) -> dict:
        return {
            **data,
            "commits": [asdict(c) for c in data["commits"]],
            "merge_requests": [asdict(mr) for mr in data["merge_requests"]],
        }
