"""发布源码引用解析与删除保护，均以固定提交和来源关系为依据。"""

import re

from django.db.models import Q
from rest_framework import serializers

from apps.package.models import PackageTask
from apps.release.models import ReleaseRecord


class ReleaseReferences:
    @staticmethod
    def resolve(release: ReleaseRecord, tags: list, excluded: str = "") -> str:
        """返回可拉取的等价引用；绝不回退到分支或接受被改写的原 Tag。"""
        sha = release.git_hash
        if not re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", sha or ""):
            raise serializers.ValidationError({"source": "发布记录缺少完整提交快照"})
        current = next((tag for tag in tags if tag.name == release.tag_name and tag.name != excluded), None)
        if current:
            if current.commit_hash != sha:
                raise serializers.ValidationError({"source": "原 Tag 提交与发布快照不一致"})
            return current.name
        source_id = release.id if release.release_type == "rc" else release.source_rc_id
        if source_id:
            alternatives = (
                ReleaseRecord.objects.filter(
                    repository=release.repository,
                    source_rc_id=source_id,
                    release_type="formal",
                    status="released",
                    git_hash=sha,
                )
                .exclude(tag_name=excluded)
                .order_by("-released_at")
            )
            by_name = {tag.name: tag for tag in tags}
            for formal in alternatives:
                tag = by_name.get(formal.tag_name)
                if tag and tag.commit_hash == sha:
                    return tag.name
        raise serializers.ValidationError({"source": "Tag 已不存在，且没有有效的关联正式引用"})

    @staticmethod
    def guard_delete(repository, tag_name: str, tags: list, *, allow_rc_cleanup: bool = False) -> None:
        """保护跨项目任务和最后源码引用；不在错误中泄露其他项目详情。"""
        if (
            PackageTask.objects.filter(repository=repository, status__in=["queued", "running"])
            .filter(Q(tag_name=tag_name) | Q(source_ref=tag_name))
            .exists()
        ):
            raise serializers.ValidationError({"tag": "该引用仍被排队或运行中的打包任务使用"})
        records = ReleaseRecord.objects.filter(repository=repository, tag_name=tag_name)
        for record in records:
            if record.release_type == "rc" and record.formal_promotions.exists():
                if not allow_rc_cleanup:
                    raise serializers.ValidationError({"tag": "该 RC 已关联正式发布，请使用 RC Tag 清理入口保留审计"})
                ReleaseReferences.resolve(record, tags, excluded=tag_name)
            if record.release_type == "formal" and record.source_rc_id:
                ReleaseReferences.resolve(record.source_rc, tags, excluded=tag_name)
                ReleaseReferences.resolve(record, tags, excluded=tag_name)
