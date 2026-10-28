"""AI 审查采纳、修复和人工复核的原单闭环。"""
import copy

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.project.models import ProjectMember
from apps.workflow.models import AIReviewRemediation, AIReviewRun, WorkflowInstance
from apps.workflow.services import WorkflowEngine, resolve_release
from utils.permissions import ProjectRolePermission

OPEN_STATUSES = ("pending_fix", "pending_review")


def assert_no_pending(release):
    """持有发布锁的调用方使用；所有发布入口不得绕过人工复核。"""
    if AIReviewRemediation.objects.filter(release=release, status__in=OPEN_STATUSES).exists():
        raise serializers.ValidationError({"remediation": "已采纳的审查意见尚未完成人工复核"})


def _role(user, project):
    if not user.is_active:
        return None
    if user.is_superuser:
        return "superuser"
    if not ProjectMember.objects.filter(project=project, user=user).exists():
        return None
    return ProjectRolePermission._effective_role(project, user)


def _active_approver(user, release):
    if not user.is_active or release.status != "pending" or not release.workflow_instance_id:
        return False
    instance = release.workflow_instance
    if instance.status != "running" or instance.source_project_id != release.project_id or instance.source_biz_id != instance.biz_id or instance.biz_id != str(release.pk):
        return False
    role = _role(user, release.project)
    if role in ("maintainer", "viewer"):
        return False
    tasks = instance.tasks.filter(status="pending", node_id=instance.current_node_id)
    return tasks.exists() if user.is_superuser else tasks.filter(approver=user).exists()


def _can_fix(user, release):
    return release.status in ("draft", "pending") and _role(user, release.project) in (
        "superuser", "manager", "software_admin", "developer",
    )


def _can_read(user, release):
    return _role(user, release.project) in ("superuser", "manager", "software_admin", "developer", "tester", "auditor") or _active_approver(user, release)


def _release(instance):
    release = resolve_release(instance)
    if (instance.biz_type != "release" or not release or instance.source_project_id != release.project_id
            or not instance.source_biz_id or instance.source_biz_id != instance.biz_id or instance.biz_id != str(release.pk)):
        raise serializers.ValidationError({"workflow": "无法核验原审查轮次与发布项目"})
    return release


def _snapshot(run, finding_id):
    current = [(item, str(run.token)) for item in (run.findings or [])]
    historical = []
    for attempt in run.history or []:
        if isinstance(attempt, dict):
            historical.extend((item, str(attempt.get("token") or "")) for item in (attempt.get("findings") or []))
    # 已完成批次可在重试中复用；来源应是首次产生该发现的执行，而非当前聚合 token。
    candidates = historical + current
    matches = [(item, token) for item, token in candidates
               if isinstance(item, dict) and str(item.get("id", "")) == finding_id]
    if not matches or any(item != matches[0][0] for item, _ in matches[1:]) or not matches[0][1]:
        raise serializers.ValidationError({"finding_id": "审查意见不存在或证据不一致"})
    return copy.deepcopy(matches[0][0]), matches[0][1]


def _event(action, user, comment, release):
    instance = release.workflow_instance if release.workflow_instance_id else None
    task = instance.tasks.filter(status="pending", node_id=instance.current_node_id, approver=user).first() if instance else None
    return {"action": action, "actor_name": user.nickname or user.username, "actor_id": str(user.pk),
            "at": timezone.now().isoformat(), "comment": comment, "git_hash": release.git_hash,
            "instance_id": str(instance.pk) if instance else None,
            "node_id": instance.current_node_id if instance else "", "task_id": str(task.pk) if task else None}


def _after_original_round(item, release):
    return item.instance.status in ("returned", "revoked") and release.workflow_instance_id != item.instance_id


def present(item, user, release, *, can_fix=None, can_review=None):
    if can_fix is None:
        can_fix = _can_fix(user, release)
    if can_review is None:
        can_review = _active_approver(user, release)
    return {"id": str(item.id), "instance_id": str(item.instance_id), "node_id": item.run.node_id,
            "finding_id": item.finding_id, "finding": item.finding, "source_token": item.source_token,
            "source_git_hash": item.source_git_hash, "status": item.status,
            "fix_note": item.fix_note, "history": item.history,
            "can_fix": can_fix and _after_original_round(item, release) and item.status in OPEN_STATUSES,
            "can_review": can_review and item.status in OPEN_STATUSES}


def list_items(instance, user):
    release = _release(instance)
    if not _can_read(user, release):
        raise PermissionDenied("无权查看审查整改")
    can_fix = _can_fix(user, release)
    can_review = _active_approver(user, release)
    items = AIReviewRemediation.objects.filter(release=release).select_related("run", "instance").order_by("created_at", "id")
    return {"items": [present(item, user, release, can_fix=can_fix, can_review=can_review) for item in items],
            "can_adopt": release.workflow_instance_id == instance.pk and can_review}


@transaction.atomic
def mutate(instance_id, user, data):
    source = WorkflowInstance.objects.filter(pk=instance_id).first()
    if not source:
        raise serializers.ValidationError({"workflow": "审批实例不存在"})
    if not source.source_project_id or not source.source_biz_id or source.source_biz_id != source.biz_id:
        raise serializers.ValidationError({"workflow": "无法核验原审查轮次与发布项目"})
    before = (source.biz_type, source.biz_id, source.source_biz_id, source.source_project_id, source.definition_id)
    instance = WorkflowEngine._lock_instance(source)
    if before != (instance.biz_type, instance.biz_id, instance.source_biz_id, instance.source_project_id, instance.definition_id):
        raise serializers.ValidationError({"workflow": "审批身份已变化，请刷新"})
    release = _release(instance)
    if release.pk != getattr(instance, "_locked_release_id", None) or release.repository_id != getattr(instance, "_locked_repository_id", None):
        raise serializers.ValidationError({"workflow": "无法核验已锁定的发布"})
    if not _can_read(user, release):
        raise PermissionDenied("无权处理审查整改")
    action = data["action"]
    comment = data.get("comment", "")
    if action == "adopt":
        if release.workflow_instance_id != instance.pk or not _active_approver(user, release):
            raise PermissionDenied("只有本轮当前审批人可以采纳意见")
        run = AIReviewRun.objects.select_for_update().filter(instance=instance, node_id=data.get("node_id")).first()
        if not run:
            raise serializers.ValidationError({"node_id": "审查节点不存在"})
        finding_id = data.get("finding_id", "")
        finding, source_token = _snapshot(run, finding_id)
        if AIReviewRemediation.objects.filter(run=run, finding_id=finding_id).exists():
            raise serializers.ValidationError({"finding_id": "该意见已采纳"})
        import re
        if not re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", release.git_hash or ""):
            raise serializers.ValidationError({"git_hash": "原审查缺少完整提交"})
        scope = getattr(instance, "review_scope", None)
        if not scope or scope.head_git_hash.lower() != release.git_hash.lower():
            raise serializers.ValidationError({"git_hash": "本轮缺少匹配的固定审查范围"})
        item = AIReviewRemediation.objects.create(release=release, instance=instance, run=run,
            finding_id=finding_id, finding=finding, source_git_hash=release.git_hash, source_token=source_token,
            history=[_event(action, user, "", release)])
    else:
        item = AIReviewRemediation.objects.select_for_update().select_related("run").filter(pk=data.get("id"), release=release).first()
        if not item:
            raise serializers.ValidationError({"id": "整改项不存在"})
        if item.status not in OPEN_STATUSES:
            raise serializers.ValidationError({"status": "整改项已经结束"})
        if action == "fix":
            if not _can_fix(user, release):
                raise PermissionDenied("无权提交修复说明")
            if not _after_original_round(item, release):
                raise serializers.ValidationError({"status": "请先退回修改或终止原审批轮次"})
            if not comment.strip():
                raise serializers.ValidationError({"comment": "请填写修复说明"})
            item.fix_note, item.status = comment, "pending_review"
        elif action in ("resolve", "dismiss"):
            if not _active_approver(user, release):
                raise PermissionDenied("只有当前审批人可以复核整改")
            if action == "resolve" and item.status != "pending_review":
                raise serializers.ValidationError({"status": "请先提交修复说明"})
            if action == "resolve" and (not _after_original_round(item, release)
                    or not release.git_hash or release.git_hash.lower() == item.source_git_hash.lower()):
                raise serializers.ValidationError({"status": "请更新到新提交并重新提审后复核"})
            if action == "dismiss" and not comment.strip():
                raise serializers.ValidationError({"comment": "不采纳时请填写理由"})
            item.status = "resolved" if action == "resolve" else "dismissed"
        else:
            raise serializers.ValidationError({"action": "不支持的整改操作"})
        item.history = [*(item.history or []), _event(action, user, comment, release)]
        item.save(update_fields=["status", "fix_note", "history", "updated_at"])
    return present(item, user, release)
