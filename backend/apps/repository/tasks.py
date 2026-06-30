"""
仓库 Celery 任务

提供异步同步仓库提交记录的任务。
"""
from celery import shared_task

from apps.repository.models import Repository
from apps.repository.services import RepositoryService


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def sync_repository_commits(self, repository_id: str, branch: str = None) -> dict:
    """
    异步同步指定仓库的 commits

    仅支持已绑定凭证的仓库（无需当前登录用户上下文，直接使用绑定的凭证）。
    失败时会更新仓库健康状态为 unhealthy，并按指数退避重试 3 次。

    Args:
        self: Celery task 实例
        repository_id: 仓库 UUID 字符串
        branch: 分支名称，默认使用仓库默认分支

    Returns:
        {"synced_count": int, "illegal_count": int}
    """
    try:
        repo = Repository.objects.get(id=repository_id)
        branch = branch or repo.default_branch
        result = RepositoryService.sync_commits(repo, branch, request_user=None)
        return result
    except Exception as exc:
        # 记录失败时间，便于排查
        try:
            repo = Repository.objects.get(id=repository_id)
            repo.health_status = "unhealthy"
            repo.save(update_fields=["health_status", "updated_at"])
        except Exception:
            pass
        raise self.retry(exc=exc)
