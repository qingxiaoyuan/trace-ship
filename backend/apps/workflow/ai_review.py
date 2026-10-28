"""发布审批中的 AI 节点调度与固定轮次保护。"""
import logging
import uuid
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.workflow.models import AIReviewRun, WorkflowInstance
from apps.workflow.services import WorkflowEngine, resolve_release

logger = logging.getLogger(__name__)


def queue_review(instance_id, node_id):
    """仅在提交后投递；投递失败停在节点并显示失败。"""
    from apps.workflow.tasks import execute_ai_review

    try:
        execute_ai_review.delay(str(instance_id), node_id)
    except Exception:
        logger.warning("AI 代码审查任务投递失败")
        AIReviewRun.objects.filter(instance_id=instance_id, node_id=node_id, status="queued").update(
            status="failed", summary="审查任务投递失败，请联系管理员"
        )


def _current(instance, node_id):
    release = resolve_release(instance)
    return bool(release and release.status == "pending" and release.workflow_instance_id == instance.id
                and instance.status == "running" and instance.current_node_id == node_id)


def lease_expired(run):
    """模型请求最多十次、每次五分钟；超时执行权可由后续重试接管。"""
    return run.status == "running" and run.updated_at <= timezone.now() - timedelta(hours=1)


def execute_review(instance_id, node_id):
    """取执行权、锁外审查，再核验当前流程与执行标识后提交结果。"""
    with transaction.atomic():
        source = WorkflowInstance.objects.filter(pk=instance_id).first()
        if not source:
            return
        instance = WorkflowEngine._lock_instance(source)
        run = AIReviewRun.objects.select_for_update().filter(instance=instance, node_id=node_id).first()
        if not run or not _current(instance, node_id):
            return
        expired = lease_expired(run)
        if run.status != "queued" and not expired:
            return
        if expired:
            run.token = uuid.uuid4()
        run.status = "running"
        run.summary = "代码审查进行中"
        run.save(update_fields=["status", "summary", "token", "updated_at"])
        token = run.token
        scope = instance.review_scope
        scope_status = scope.status

    if scope_status in ("first_release", "no_changes"):
        outcome = {"status": scope_status, "summary": "首次发布，已跳过 AI 审查" if scope_status == "first_release" else "无代码变更",
                   "coverage": {"total_files": 0, "reviewed_files": 0, "warnings": []}, "dimensions": [], "findings": []}
    elif scope_status != "ready":
        outcome = {"status": "incomplete", "summary": "审查范围不完整，等待处理", "coverage": {
            "total_files": len(scope.diffs), "reviewed_files": 0, "warnings": scope.warnings}, "dimensions": [], "findings": []}
    else:
        try:
            from apps.workflow.ai_review_model import review_scope
            outcome = review_scope(run, scope)
        except Exception:
            # 模型与远端响应可能含源码、密钥；不得写入日志或用户消息。
            logger.warning("AI 代码审查执行失败")
            outcome = {"status": "failed", "summary": "代码审查执行失败，请联系管理员", "coverage": {
                "total_files": len(scope.diffs), "reviewed_files": 0, "warnings": ["审查未完成"]}, "dimensions": [], "findings": []}

    with transaction.atomic():
        source = WorkflowInstance.objects.filter(pk=instance_id).first()
        if not source:
            return
        instance = WorkflowEngine._lock_instance(source)
        run = AIReviewRun.objects.select_for_update().filter(instance=instance, node_id=node_id).first()
        if not run or run.status != "running" or run.token != token or not _current(instance, node_id):
            return
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
