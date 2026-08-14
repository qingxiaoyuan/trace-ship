"""
发布模块 Celery 任务

包含草稿单据清理等定时/异步任务。
"""
from celery import shared_task
from django.utils import timezone

from apps.release.models import ReleaseRecord


@shared_task
def cleanup_draft_releases() -> dict:
    """
    清理过期的草稿发布申请。

    由 Celery beat 每个整点调度执行。草稿只是发布前的临时单据，
    创建超过 1 小时后无论是否填写内容一律删除，避免废弃草稿堆积。
    未提交审批的草稿可随时重建，审批中（pending）及之后的状态不受影响。

    Returns:
        {"deleted": int} 删除记录数
    """
    expires_at = timezone.now() - timezone.timedelta(hours=1)
    deleted, _ = ReleaseRecord.objects.filter(
        status="draft", created_at__lt=expires_at
    ).delete()
    return {"deleted": deleted}
