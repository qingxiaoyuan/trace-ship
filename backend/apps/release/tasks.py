"""
发布模块 Celery 任务

包含草稿单据清理等定时/异步任务。
"""
from celery import shared_task
from django.utils import timezone

from apps.release.models import ReleaseRecord
from apps.release.services import ReleaseService


@shared_task
def cleanup_draft_releases() -> dict:
    """
    清理过期的空草稿发布申请。

    由 Celery beat 每个整点调度执行。仅删除超过 1 小时且没有发布说明、
    关联变更、更新条目和测试确认信息的临时草稿，避免误删用户正在编辑的草稿。

    Returns:
        {"deleted": int} 删除记录数
    """
    expires_at = timezone.now() - timezone.timedelta(hours=1)
    deleted, _ = (
        ReleaseRecord.objects.filter(status="draft", created_at__lt=expires_at)
        .filter(ReleaseService.empty_draft_filter())
        .delete()
    )
    return {"deleted": deleted}
