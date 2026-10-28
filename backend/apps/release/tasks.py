"""
发布模块 Celery 任务

包含草稿单据清理等定时/异步任务。
"""
from celery import shared_task
from django.db import transaction
from django.utils import timezone

from apps.release.models import ReleaseRecord
from apps.repository.models import Repository


@shared_task
def cleanup_draft_releases() -> dict:
    """
    清理过期的草稿发布申请。

    由 Celery beat 每个整点调度执行。草稿只是发布前的临时单据，
    创建超过 1 小时的普通草稿会清理；已退回修改的原申请必须保留。
    清理与提审、退回使用相同锁顺序，并在锁内再次检查状态。

    Returns:
        {"deleted": int} 删除记录数
    """
    expires_at = timezone.now() - timezone.timedelta(hours=1)
    candidates = list(ReleaseRecord.objects.filter(
        status="draft", created_at__lt=expires_at, has_revision_history=False,
    ).values_list("id", "repository_id"))
    deleted = 0
    for release_id, repository_id in candidates:
        with transaction.atomic():
            if not Repository.objects.select_for_update(no_key=True).filter(pk=repository_id).exists():
                continue
            draft = ReleaseRecord.objects.select_for_update().filter(
                pk=release_id, repository_id=repository_id, status="draft",
                created_at__lt=expires_at, has_revision_history=False,
            ).first()
            if draft:
                count, _ = draft.delete()
                deleted += count
    return {"deleted": deleted}
