"""发布审批中的 AI 节点调度与固定轮次保护。"""
from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import TYPE_CHECKING

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.workflow.models import AIReviewRun, WorkflowInstance
from apps.workflow.services import WorkflowEngine, resolve_release

if TYPE_CHECKING:
    from apps.account.models import User

logger = logging.getLogger(__name__)


def queue_review(instance_id: str | uuid.UUID, node_id: str, expected_token: str | uuid.UUID | None = None) -> None:
    """仅在提交后投递；投递失败停在节点并显示失败。"""
    from apps.workflow.tasks import execute_ai_review

    if expected_token is None:
        expected_token = AIReviewRun.objects.filter(instance_id=instance_id, node_id=node_id).values_list("token", flat=True).first()
    if expected_token is None:
        return
    try:
        execute_ai_review.delay(str(instance_id), node_id, str(expected_token))
    except Exception:
        logger.warning("AI 代码审查任务投递失败")
        AIReviewRun.objects.filter(instance_id=instance_id, node_id=node_id, status="queued", token=expected_token).update(
            status="failed", summary="审查任务投递失败，请联系管理员"
        )


def _current(instance, node_id):
    release = resolve_release(instance)
    return bool(release and release.status == "pending" and release.workflow_instance_id == instance.id
                and instance.source_project_id == release.project_id and instance.source_biz_id == instance.biz_id
                and instance.status == "running" and instance.current_node_id == node_id)


def _same_identity(before, after):
    """锁实例前后的发布身份必须一致，防止锁住错误仓库后推进。"""
    fields = ("biz_type", "biz_id", "source_biz_id", "source_project_id", "definition_id")
    return all(getattr(before, field) == getattr(after, field) for field in fields)


def lease_expired(run: AIReviewRun) -> bool:
    """模型请求最多十次、每次五分钟；超时执行权可由后续重试接管。"""
    return run.status == "running" and run.updated_at <= timezone.now() - timedelta(hours=1)


def execute_review(instance_id: str | uuid.UUID, node_id: str, expected_token: str | uuid.UUID | None = None) -> None:
    """取执行权、锁外审查，再核验当前流程与执行标识后提交结果。"""
    with transaction.atomic():
        source = WorkflowInstance.objects.filter(pk=instance_id).first()
        if not source or not source.source_project_id or not source.source_biz_id or source.source_biz_id != source.biz_id:
            return
        instance = WorkflowEngine._lock_instance(source)
        run = AIReviewRun.objects.select_for_update().filter(instance=instance, node_id=node_id).first()
        if (not _same_identity(source, instance) or not run
                or (expected_token is not None and str(run.token) != str(expected_token)) or not _current(instance, node_id)):
            return
        expired = lease_expired(run)
        if run.status != "queued" and not expired:
            return
        if expired:
            _archive(run)
            run.token = uuid.uuid4()
        run.status = "running"
        run.summary = "代码审查进行中"
        run.save(update_fields=["status", "summary", "token", "history", "updated_at"])
        token = run.token
        scope = instance.review_scope
        scope_status = scope.status

    if scope_status in ("first_release", "no_changes"):
        outcome = {"status": scope_status, "summary": "首次发布，已跳过 AI 审查" if scope_status == "first_release" else "无代码变更",
                   "coverage": {"total_files": 0, "reviewed_files": 0, "warnings": []}, "dimensions": [], "findings": []}
    else:
        try:
            from apps.workflow.ai_review_model import review_scope
            outcome = review_scope(run, scope, checkpoint=lambda results, result: _checkpoint(
                instance_id, node_id, token, results, result,
            ), is_current=lambda: _is_current_execution(instance_id, node_id, token))
            if outcome is None:
                return
        except Exception:
            # 模型与远端响应可能含源码、密钥；不得写入日志或用户消息。
            logger.warning("AI 代码审查执行失败")
            outcome = None

    with transaction.atomic():
        source = WorkflowInstance.objects.filter(pk=instance_id).first()
        if not source or not source.source_project_id or not source.source_biz_id or source.source_biz_id != source.biz_id:
            return
        instance = WorkflowEngine._lock_instance(source)
        run = AIReviewRun.objects.select_for_update().filter(instance=instance, node_id=node_id).first()
        if not _same_identity(source, instance) or not run or run.status != "running" or run.token != token or not _current(instance, node_id):
            return
        if outcome is None:
            # 发生异常时保留此前成功保存的批次证据，而不是清空已审查范围。
            run.status = "failed"
            run.summary = "代码审查执行失败，请联系管理员"
            coverage = dict(run.coverage or {})
            coverage["warnings"] = [*(coverage.get("warnings") or []), "审查执行失败"]
            run.coverage = coverage
        else:
            run.status = outcome["status"]
            run.summary = outcome["summary"]
            run.coverage = outcome["coverage"]
            run.dimensions = outcome["dimensions"]
            run.findings = outcome["findings"]
        run.save(update_fields=["status", "summary", "coverage", "dimensions", "findings", "updated_at"])
        if run.status in ("completed", "first_release", "no_changes"):
            try:
                # 后续人工节点不可用时回滚推进与新建任务，保留可恢复的失败状态。
                with transaction.atomic():
                    WorkflowEngine._advance(instance, node_id)
                    state = instance.node_status or {}
                    state[node_id] = run.status
                    instance.node_status = state
                    instance.save(update_fields=["node_status", "updated_at"])
            except Exception:
                logger.warning("AI 审查完成后人工审批节点不可用")
                run.status = "failed"
                run.summary = "人工审批节点不可用，流程未推进"
                run.save(update_fields=["status", "summary", "updated_at"])


def _is_current_execution(instance_id: str | uuid.UUID, node_id: str, token: uuid.UUID) -> bool:
    """只读核验执行权，等待外部响应时不延长租约。"""
    instance = WorkflowInstance.objects.filter(pk=instance_id).first()
    if not instance or not instance.source_project_id or instance.source_biz_id != instance.biz_id:
        return False
    return _current(instance, node_id) and AIReviewRun.objects.filter(
        instance=instance, node_id=node_id, status="running", token=token,
    ).exists()


def _checkpoint(instance_id, node_id, token, results, outcome):
    """仅当前轮、当前执行可保存批次检查点；迟到执行不能覆盖新结果。"""
    with transaction.atomic():
        source = WorkflowInstance.objects.filter(pk=instance_id).first()
        if not source or not source.source_project_id or not source.source_biz_id or source.source_biz_id != source.biz_id:
            return False
        instance = WorkflowEngine._lock_instance(source)
        run = AIReviewRun.objects.select_for_update().filter(instance=instance, node_id=node_id).first()
        if not _same_identity(source, instance) or not run or run.status != "running" or run.token != token or not _current(instance, node_id):
            return False
        run.batch_results = results
        run.coverage = outcome["coverage"]
        run.dimensions = outcome["dimensions"]
        run.findings = outcome["findings"]
        run.save(update_fields=["batch_results", "coverage", "dimensions", "findings", "updated_at"])
        return True


def _authorized_manager(user, project):
    """按目标项目的当前显式成员与有效角色授权。"""
    from apps.project.models import ProjectMember
    from utils.permissions import ProjectRolePermission

    if user.is_superuser:
        return True
    return bool(project and ProjectMember.objects.filter(project=project, user=user).exists()
                and ProjectRolePermission._effective_role(project, user) in ("manager", "software_admin"))


def _archive(run):
    """在同一锁内保存本次执行的完整结果及覆盖缺口。"""
    history = list(run.history or [])
    expired = lease_expired(run)
    history.append({"token": str(run.token), "status": "failed" if expired else run.status,
                    "summary": "审查执行中断或超时" if expired else run.summary,
                    "coverage": run.coverage, "dimensions": run.dimensions,
                    "findings": run.findings, "updated_at": run.updated_at.isoformat()})
    run.history = history


@transaction.atomic
def recover_review(
    instance_id: str | uuid.UUID, node_id: str, user: User, *, skip_reason: str | None = None,
) -> AIReviewRun:
    """在当前 AI 节点重试或留理由跳过，保留轮次和过往执行。"""
    source = WorkflowInstance.objects.filter(pk=instance_id).first()
    if source is None:
        raise serializers.ValidationError({"workflow": "流程不存在"})
    # 新审查轮次必须具有在提审时保存的项目与业务身份，不能由当前值重新推断。
    if not source.source_project_id or not source.source_biz_id or source.source_biz_id != source.biz_id:
        raise serializers.ValidationError({"workflow": "无法核验审查轮次所属项目"})
    instance = WorkflowEngine._lock_instance(source)
    if not _same_identity(source, instance):
        raise serializers.ValidationError({"workflow": "流程身份已变化，请刷新后重试"})
    release = resolve_release(instance)
    if release is None or not _authorized_manager(user, release.project):
        raise PermissionDenied("只有项目管理员、软件管理员或超管可以操作")
    run = AIReviewRun.objects.select_for_update().filter(instance=instance, node_id=node_id).first()
    if not run or not _current(instance, node_id):
        raise serializers.ValidationError({"workflow": "流程已结束或不在该审查节点"})
    if run.status not in ("failed", "incomplete") and not lease_expired(run):
        raise serializers.ValidationError({"workflow": "只有失败或未完成的审查可以处理"})
    if skip_reason is not None and not skip_reason.strip():
        raise serializers.ValidationError({"reason": "请填写跳过原因"})
    if skip_reason is not None:
        nodes = WorkflowEngine._instance_node_config(instance)
        current_index = next((index for index, node in enumerate(nodes) if node.get("node_id") == node_id), None)
        if current_index is None or not any(node.get("node_type") != "ai_review" for node in nodes[current_index + 1:]):
            raise serializers.ValidationError({"workflow": "审查后缺少人工审批节点，无法跳过"})
    _archive(run)
    run.token = uuid.uuid4()
    if skip_reason is None:
        run.status = "queued"
        run.summary = "等待重新审查"
        run.coverage = {}
        run.dimensions = []
        run.findings = []
        run.save(update_fields=["history", "token", "status", "summary", "coverage", "dimensions", "findings", "updated_at"])
        transaction.on_commit(lambda: queue_review(instance.pk, node_id, run.token))
    else:
        run.status = "skipped"
        run.summary = "管理员已留理由跳过 AI 审查"
        run.skipped_by = user
        run.skipped_at = timezone.now()
        run.skip_reason = skip_reason.strip()
        run.save(update_fields=["history", "token", "status", "summary", "skipped_by", "skipped_at", "skip_reason", "updated_at"])
        WorkflowEngine._advance(instance, node_id)
        state = instance.node_status or {}
        state[node_id] = "skipped"
        instance.node_status = state
        instance.save(update_fields=["node_status", "updated_at"])
    return run
