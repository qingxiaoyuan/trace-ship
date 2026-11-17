"""盘点旧仓库发布，按负责人提交的证据确认软件归属。"""

import hashlib
import re
from collections import defaultdict
from uuid import UUID

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from apps.package.models import PackageConfig, PackageTask
from apps.release.models import OaArchiveApplication, ReleaseRecord, ReleaseTagCleanupAttempt, ReleaseVersionClaim
from apps.release.references import ReleaseReferences
from apps.release.services import ReleaseService
from apps.release.versions import historical_version_keys, software_version_candidates
from apps.repository.models import Repository, RepositoryTag
from apps.software.models import Software
from apps.software.services import can_manage_software
from utils.provider.exceptions import ProviderError


def inventory(repository_id: UUID | None = None) -> dict:
    """只读导出可比较的关系和保护引用，不导出凭证、构建参数及归档材料。"""
    scope = {"repository_id": repository_id} if repository_id else {}
    releases = ReleaseRecord.objects.filter(**scope).order_by("id")
    claims = ReleaseVersionClaim.objects.filter(**scope).order_by("id")
    tasks = PackageTask.objects.filter(**scope).order_by("id")
    tags = RepositoryTag.objects.filter(**scope).order_by("repository_id", "name")
    configs = PackageConfig.objects.order_by("id")
    if repository_id:
        config_scope = Q(project_component__repository_id=repository_id)
        if hasattr(PackageConfig, "software"):
            config_scope |= Q(software__repository_id=repository_id)
        configs = configs.filter(config_scope)
    oa = OaArchiveApplication.objects.order_by("id")
    if repository_id:
        oa = oa.filter(
            Q(release__repository_id=repository_id) | Q(task__repository_id=repository_id)
            | Q(protected_release__repository_id=repository_id) | Q(protected_task__repository_id=repository_id)
        )

    task_rows = []
    task_software = defaultdict(set)
    for task in tasks:
        snapshot = task.config_snapshot or {}
        identities = (getattr(task, "software_id", None), snapshot.get("software_id"))
        task_software[task.release_id].update(str(value) for value in identities if value)
        task_rows.append({
            "id": task.id, "release_id": task.release_id, "project_id": task.project_id,
            "repository_id": task.repository_id, "config_id": task.config_id,
            "snapshot_config_id": snapshot.get("config_id"), "snapshot_config_name": snapshot.get("config_name"),
            "software_id": getattr(task, "software_id", None) or snapshot.get("software_id"),
            "tag_name": task.tag_name, "source_ref": task.source_ref, "commit_hash": task.commit_hash,
            "status": task.status, "artifact_count": len(task.artifact_info or []),
        })
    config_rows = []
    groups = defaultdict(list)
    for config in configs.select_related("project_component"):
        component = config.project_component
        repository = component.repository_id if component else (
            config.software.repository_id if getattr(config, "software_id", None) else None
        )
        config_rows.append({
            "id": config.id, "name": config.name, "project_id": component.project_id if component else None,
            "repository_id": repository, "software_id": getattr(config, "software_id", None),
        })
        groups[repository, config.name].append(config.id)
    release_rows = []
    released_versions = defaultdict(list)
    issues = defaultdict(list)
    for release in releases.prefetch_related("version_claims"):
        versions = sorted(historical_version_keys(release)) if release.status == "released" else []
        if release.status == "released":
            if len(versions) != 1:
                issues["unknown_or_ambiguous_base_versions"].append(release.id)
            else:
                scope_id = release.software_id or release.repository_id
                released_versions[(scope_id, release.release_type, versions[0])].append(release.id)
            if not release.tag_name or not re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", release.git_hash):
                issues["missing_source_evidence"].append(release.id)
        if len(task_software[release.id]) > 1:
            issues["multiple_software_in_task_evidence"].append({
                "release": release.id, "software_ids": sorted(task_software[release.id]),
            })
        release_rows.append({
            "id": release.id, "project_id": release.project_id, "repository_id": release.repository_id,
            "software_id": release.software_id, "version": release.version, "tag_name": release.tag_name,
            "release_type": release.release_type, "status": release.status, "git_hash": release.git_hash,
            "version_keys": versions,
            "source_rc_id": release.source_rc_id, "source_rc_tag": release.source_rc_tag, "base_tag": release.base_tag,
            "base_git_hash": release.base_git_hash, "workflow_instance_id": release.workflow_instance_id,
            "tag_cleanup_status": release.tag_cleanup_status, "tag_cleanup_reference": release.tag_cleanup_reference,
            "release_doc_sha256": hashlib.sha256(release.release_doc.encode()).hexdigest(),
            "selected_config_ids": release.package_config_ids,
            "confirmed_by": release.software_confirmed_by_id, "confirmed_at": release.software_confirmed_at,
            "confirmation_basis": release.software_confirmation_basis,
        })
    issues["duplicate_release_versions"] = [
        {"scope_id": scope_id, "release_type": kind, "base_version": number, "release_ids": ids}
        for (scope_id, kind, number), ids in released_versions.items() if len(ids) > 1
    ]
    report = {
        "releases": release_rows,
        "claims": list(claims.values(
            "id", "repository_id", "software_id", "release_id", "release_type", "tag_name",
            "base_version", "consumed", "reused",
        )),
        "tasks": task_rows,
        "configs": config_rows,
        "cached_tags": list(tags.values("repository_id", "name", "commit_hash", "updated_at")),
        "oa_records": list(oa.values("id", "release_id", "task_id", "protected_release_id", "protected_task_id", "status")),
        "cleanup_attempts": list(
            ReleaseTagCleanupAttempt.objects.filter(release_id__in=releases.values("id")).order_by("id")
            .values("id", "release_id", "status", "protected_by")
        ),
    }
    issues["orphan_claims"] = [row["id"] for row in report["claims"] if row["release_id"] is None]
    counts = {key: len(rows) for key, rows in report.items()}
    counts["unassigned_releases"] = sum(row["software_id"] is None for row in release_rows)
    counts["oa_protections"] = sum(
        row["protected_release_id"] is not None or row["protected_task_id"] is not None for row in report["oa_records"]
    )
    return {
        **report,
        "counts": counts,
        "issues": dict(issues),
        "same_name_configs": [
            {"repository_id": repository, "name": name, "config_ids": ids}
            for (repository, name), ids in groups.items() if len(ids) > 1
        ],
        "unassigned_release_ids": [row["id"] for row in release_rows if row["software_id"] is None],
    }


def _assignment_error(release: ReleaseRecord, software: Software, user, key: str | None) -> str:
    if release.repository_id != software.repository_id:
        return "软件主仓库与原发布仓库不一致"
    if not can_manage_software(software, user):
        return "确认人必须是此软件的维护负责人或超管"
    if release.status != "released":
        return "仅确认已发布历史，未发布申请保持原流程"
    if not key:
        return "缺少唯一基础版本证据，需核对原始 Tag 或占用"
    if not release.tag_name or not re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", release.git_hash):
        return "缺少原始 Tag 或完整提交快照"
    linked_software = {
        str(value) for task in release.package_tasks.all()
        for value in (getattr(task, "software_id", None), (task.config_snapshot or {}).get("software_id")) if value
    }
    if linked_software - {str(software.pk)}:
        return "任务快照指向不同软件，不能把同一发布复制或合并为单一软件"
    if _related_releases(release).filter(software__isnull=False).exclude(software=software).exists():
        return "已有归属的来源 RC 或关联正式版属于另一软件，请核对历史来源链"
    if ReleaseVersionClaim.objects.filter(
        software=software, release_type=release.release_type, base_version=key,
    ).exists():
        return "此软件已有同一基础版本占用"
    previous = ReleaseRecord.objects.filter(software=software, release_type=release.release_type).exclude(pk=release.pk)
    for other in previous.exclude(status="draft").prefetch_related("version_claims"):
        if key in historical_version_keys(other) or other.tag_name == release.tag_name:
            return "此软件已有同一基础版本或相同 Tag 的历史"
    return ""



def _related_releases(release: ReleaseRecord):
    """直接来源 RC 与以该 RC 为来源的正式发布。"""
    return ReleaseRecord.objects.filter(Q(pk=release.source_rc_id) | Q(source_rc=release))


@transaction.atomic
def assign_history(proposals: list[dict], user, *, apply: bool = False, repository_id: UUID | None = None) -> list[dict]:
    """批次先检查全部证据；写入时共同持有仓库锁，并复核远端引用。"""
    releases = ReleaseRecord.objects.filter(pk__in=[item["release"] for item in proposals])
    if repository_id:
        releases = releases.filter(repository_id=repository_id)
    if apply:
        repository_ids = releases.values_list("repository_id", flat=True)
        list(Repository.objects.filter(pk__in=repository_ids).order_by("pk").select_for_update(no_key=True))
        releases = releases.select_for_update()
    release_map = {release.pk: release for release in releases}
    software_map = Software.objects.in_bulk([item["software"] for item in proposals])
    same_release = defaultdict(list)
    same_version = defaultdict(list)
    remote_tags = {}
    ready = []
    results = []

    for item in proposals:
        release, software = release_map.get(item["release"]), software_map.get(item["software"])
        result = {"release": item["release"], "software": item["software"], "status": "blocked"}
        results.append(result)
        same_release[item["release"]].append(result)
        if not release or not software:
            result["reason"] = "找不到指定历史发布或软件"
            continue
        if not can_manage_software(software, user):
            result["reason"] = "确认人必须是此软件的维护负责人或超管"
            continue
        if release.software_id:
            if release.software_id == software.pk and release.software_confirmed_at:
                result["status"] = "unchanged"
            else:
                result["reason"] = "已有软件身份，不能重新归属"
            continue
        versions = historical_version_keys(release)
        key = next(iter(versions)) if len(versions) == 1 else None
        reason = _assignment_error(release, software, user, key)
        if reason:
            result["reason"] = reason
            continue
        result.update(status="ready", base_version=key, tag_name=release.tag_name)
        same_version[software.pk, release.release_type, key].append(result)
        ready.append((release, software, item["basis"], key, result))

    for group in [*same_release.values(), *same_version.values()]:
        if len(group) > 1:
            for result in group:
                result.update(status="blocked", reason="确认表重复指定发布或同软件同类型的基础版本")

    by_release = {record.pk: (software.pk, result) for record, software, _, _, result in ready}
    for release, software, _, _, result in ready:
        for related_id in _related_releases(release).values_list("pk", flat=True):
            other = by_release.get(related_id)
            if other and other[0] != software.pk:
                reason = "同一来源 RC 与正式版在确认表中指定了不同软件"
                result.update(status="blocked", reason=reason)
                other[1].update(status="blocked", reason=reason)

    if not apply or any(item["status"] == "blocked" for item in results):
        return results
    for release, software, _, key, result in ready:
        try:
            if release.repository_id not in remote_tags:
                provider = ReleaseService._get_provider(release.repository, user)
                remote_tags[release.repository_id] = provider.list_tags(release.repository.external_identity)
            tags = remote_tags[release.repository_id]
            result["verified_ref"] = ReleaseReferences.resolve(release, tags)
            version = tuple(map(int, key.split(".")))
            if any(num == version for num, _, _ in software_version_candidates(software, release.release_type, tags)):
                result.update(status="blocked", reason="远端存在同软件同类型的基础版本")
        except (ProviderError, serializers.ValidationError):
            result.update(status="blocked", reason="无法核验原 Tag 或保存提交对应的有效远端引用")
    if any(item["status"] == "blocked" for item in results):
        transaction.set_rollback(True)
        return results
    for release, software, basis, key, result in ready:
        release.software = software
        release.software_confirmed_by = user
        release.software_confirmed_at = timezone.now()
        release.software_confirmation_basis = basis
        release.historical_base_version = key
        release.save(update_fields=[
            "software", "software_confirmed_by", "software_confirmed_at",
            "software_confirmation_basis", "historical_base_version",
        ])
        result["status"] = "confirmed"
    return results
