from celery import shared_task
from django.utils import timezone

from apps.repository.models import Repository
from apps.repository.services import RepositoryService


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def sync_repository_commits(self, repository_id: str, branch: str = None):
    """
    异步同步指定仓库的 commits。
    仅支持 credential_mode 为 fixed / global 的仓库。
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
