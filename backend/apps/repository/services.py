from typing import List, Optional

from django.utils import timezone

from apps.repository.models import CommitRecord, Repository
from utils.commit_reviewer import CommitReviewer
from utils.provider.base import CommitInfo
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider


class RepositoryService:
    """仓库相关业务逻辑封装"""

    @staticmethod
    def _resolve_server_url(repo: Repository) -> str:
        """优先从 ProjectIntegration.config 读取 server_url，否则使用 Repository.url"""
        if repo.integration and repo.integration.config:
            server_url = repo.integration.config.get("server_url")
            if server_url:
                return server_url
        return repo.url

    @staticmethod
    def test_connection(repo: Repository, request_user=None) -> dict:
        """测试仓库连通性，返回 {connected, detail}，并更新 health_status"""
        try:
            cred_data = resolve_credential(repo, request_user)
            provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
            connected = provider.test_connection()
            repo.health_status = "healthy"
            repo.save(update_fields=["health_status", "updated_at"])
            return {"connected": connected, "detail": "连接成功"}
        except ProviderError as exc:
            repo.health_status = "unhealthy"
            repo.save(update_fields=["health_status", "updated_at"])
            return {"connected": False, "detail": str(exc)}
        except Exception as exc:
            repo.health_status = "unhealthy"
            repo.save(update_fields=["health_status", "updated_at"])
            return {"connected": False, "detail": f"连接异常: {exc}"}

    @staticmethod
    def list_branches(repo: Repository, request_user=None) -> List[dict]:
        cred_data = resolve_credential(repo, request_user)
        provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
        branches = provider.list_branches(repo.external_identity)
        return [
            {
                "name": b.name,
                "is_default": b.is_default,
                "last_commit_hash": b.last_commit_hash,
            }
            for b in branches
        ]

    @staticmethod
    def list_commits(
        repo: Repository,
        branch: Optional[str] = None,
        request_user=None,
    ) -> List[CommitInfo]:
        cred_data = resolve_credential(repo, request_user)
        provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
        branch = branch or repo.default_branch
        return provider.list_commits(repo.external_identity, branch)

    @staticmethod
    def sync_commits(
        repo: Repository,
        branch: Optional[str] = None,
        request_user=None,
    ) -> dict:
        """
        同步指定仓库的 commits。
        返回 {"synced_count": int, "illegal_count": int}
        """
        branch = branch or repo.default_branch
        commits = RepositoryService.list_commits(repo, branch, request_user)

        synced_count = 0
        illegal_count = 0

        for commit in commits:
            status, reason, parsed = CommitReviewer.review(commit.message)
            if status == "illegal":
                illegal_count += 1

            _, created = CommitRecord.objects.update_or_create(
                repository=repo,
                commit_hash=commit.hash,
                defaults={
                    "project": repo.project,
                    "author": commit.author,
                    "author_email": commit.author_email or "",
                    "message": commit.message,
                    "committed_at": commit.committed_at or timezone.now(),
                    "branch": branch,
                    "parsed_message": parsed,
                    "review_status": status,
                    "review_reason": reason,
                },
            )
            if created:
                synced_count += 1

        repo.last_sync_at = timezone.now()
        repo.save(update_fields=["last_sync_at", "updated_at"])

        return {"synced_count": synced_count, "illegal_count": illegal_count}

    @staticmethod
    def ai_review(commit: CommitRecord) -> dict:
        """阶段二占位：基于规则引擎返回建议"""
        suggestion = CommitReviewer.suggest(commit.message)
        return {
            "review_status": commit.review_status,
            "suggestion": suggestion,
            "risks": [],
        }
