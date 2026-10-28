"""固定每轮发布代码审查范围和补充上下文。"""
from __future__ import annotations

from typing import TYPE_CHECKING

from django.db import transaction
from rest_framework import serializers

if TYPE_CHECKING:
    from apps.account.models import User
    from apps.release.models import ReleaseRecord, ReleaseReviewScope
    from apps.workflow.models import WorkflowInstance
    from utils.provider.base import GitProvider


def validate_document_paths(paths: list[str]) -> list[str]:
    """只接受仓库内相对文件路径；不把跳转路径交给远端解析。"""
    result = []
    for path in paths:
        if (
            not path or path != path.strip() or path.startswith("/")
            or "\\" in path or "\x00" in path or ":" in path
            or any(part in ("", ".", "..") for part in path.split("/"))
        ):
            raise serializers.ValidationError("审查文档路径必须是仓库内的相对路径")
        if path in result:
            raise serializers.ValidationError("审查文档路径不能重复")
        result.append(path)
    return result


def _version_key(calculator, release_type: str, tag: str) -> tuple[int, int, int] | None:
    match = calculator._build_regex(release_type).fullmatch(tag)
    if not match:
        return None
    return tuple(int(match.group(part)) for part in ("major", "minor", "patch"))


def _baseline(release, provider) -> tuple[str, str]:
    """正式版使用说明固定基线；其他类型按物理仓库版本序列选择。"""
    import re

    from apps.release.models import ReleaseRecord
    from apps.release.services import VersionCalculator

    full_sha = r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}"
    if release.release_type == "formal":
        if not release.changes_initialized:
            raise serializers.ValidationError({"base_tag": "请先生成正式发布说明以固定基线"})
        if bool(release.base_tag) != bool(release.base_git_hash) or (
            release.base_git_hash and not re.fullmatch(full_sha, release.base_git_hash)
        ):
            raise serializers.ValidationError({"base_tag": "正式基线缺少完整提交"})
        return release.base_tag, release.base_git_hash
    calculator = VersionCalculator(release.repository.get_version_rule())
    target = _version_key(calculator, release.release_type, release.tag_name)
    if target is None:
        raise serializers.ValidationError({"version": "版本号不符合仓库规则，无法确定审查基线"})
    tags = {tag.name: tag.commit_hash or "" for tag in provider.list_tags(release.repository.external_identity)}
    history = {}
    for previous in ReleaseRecord.objects.filter(
        repository=release.repository, release_type=release.release_type, status="released",
    ).exclude(pk=release.pk):
        key = _version_key(calculator, release.release_type, previous.tag_name)
        if key is None or key >= target:
            continue
        if previous.git_hash:
            history.setdefault(previous.tag_name, set()).add(previous.git_hash)
        else:
            tags.setdefault(previous.tag_name, "")
    for tag in history:
        tags.pop(tag, None)
    pairs = list(tags.items()) + [(tag, sha) for tag, hashes in history.items() for sha in hashes]
    candidates = [(_version_key(calculator, release.release_type, name), name, sha) for name, sha in pairs]
    candidates = [item for item in candidates if item[0] is not None and item[0] < target]
    if not candidates:
        return "", ""
    highest = max(item[0] for item in candidates)
    latest = [item for item in candidates if item[0] == highest]
    if len({item[2] for item in latest}) > 1:
        raise serializers.ValidationError({"base_tag": "上一同类型版本存在不同提交，请先核对发布历史"})
    _, tag, sha = max(latest, key=lambda item: item[1])
    if not re.fullmatch(full_sha, sha):
        raise serializers.ValidationError({"base_tag": "上一同类型版本缺少完整提交"})
    return tag, sha


@transaction.atomic
def capture_review_scope(
    release: ReleaseRecord, instance: WorkflowInstance, user: User, *, provider: GitProvider | None = None,
) -> ReleaseReviewScope:
    """供提审事务调用；同一实例只保存一次，失败由调用方回滚提审。"""
    import re

    from apps.release.models import ReleaseRecord, ReleaseReviewScope
    from apps.release.services import ReleaseService
    from apps.repository.models import Repository
    from apps.workflow.models import WorkflowInstance
    from utils.permissions import IsProjectDeveloper

    Repository.objects.select_for_update(no_key=True).get(pk=release.repository_id)
    release = ReleaseRecord.objects.select_for_update().get(pk=release.pk)
    instance = WorkflowInstance.objects.select_for_update().get(pk=instance.pk)

    if instance.biz_type != "release" or str(instance.biz_id) != str(release.pk):
        raise serializers.ValidationError({"workflow": "审查轮次不属于当前发布"})
    if instance.source_project_id != release.project_id:
        raise serializers.ValidationError({"workflow": "审查轮次所属项目不一致"})
    if not IsProjectDeveloper()._check(release.project, user):
        raise serializers.ValidationError({"project": "没有在目标项目提交审查的权限"})
    existing = ReleaseReviewScope.objects.filter(instance=instance).first()
    if existing:
        return existing
    head = release.git_hash or ""
    if not re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", head):
        raise serializers.ValidationError({"git_hash": "审查目标缺少完整提交"})
    ReleaseService.validate_source_context(release.project, release.repository)
    if provider is None:
        provider = ReleaseService._get_provider(release.repository, user, project=release.project)
    base_tag, base = _baseline(release, provider)
    identity = release.repository.external_identity
    if base and base != head and provider.get_merge_base(identity, [base, head]) != base:
        raise serializers.ValidationError({"base_tag": "上一同类型提交不在目标提交的祖先链上，请处理回滚或分叉"})
    documents = {}
    for path in validate_document_paths(release.review_document_paths or []):
        content = provider.get_file_raw(identity, path, ref=head)
        if content is None:
            raise serializers.ValidationError({"review_document_paths": f"审查文档不存在、不可读或超过限制：{path}"})
        documents[path] = content
    diffs, warnings = [], []
    if not base:
        status = "first_release"
    elif base == head:
        status = "no_changes"
    else:
        result = provider.review_diff(identity, base, head)
        diffs, warnings = result["diffs"], result["warnings"]
        status = "incomplete" if not result["complete"] else ("ready" if diffs else "no_changes")
    return ReleaseReviewScope.objects.create(
        instance=instance, base_tag=base_tag, base_git_hash=base, head_git_hash=head,
        context=release.review_context, context_is_requirement=release.review_context_is_requirement,
        documents=documents, diffs=diffs, warnings=warnings, status=status,
    )
