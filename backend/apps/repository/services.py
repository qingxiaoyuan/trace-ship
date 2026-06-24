"""
仓库业务服务

封装仓库连通性测试、分支/commit 查询、提交同步以及 AI 审查建议等业务逻辑。
"""
from typing import List, Optional

from django.utils import timezone

from apps.repository.models import CommitRecord, Repository
from utils.commit_reviewer import CommitReviewer
from utils.provider.base import CommitInfo
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider


class RepositoryService:
    """
    仓库相关业务逻辑封装
    """

    @staticmethod
    def _resolve_server_url(repo: Repository) -> str:
        """
        解析仓库服务端地址

        优先从 ProjectIntegration.config 读取 server_url，否则回退到 Repository.url。

        Args:
            repo: Repository 实例

        Returns:
            服务端地址字符串
        """
        if repo.integration and repo.integration.config:
            server_url = repo.integration.config.get("server_url")
            if server_url:
                return server_url
        return repo.url

    @staticmethod
    def test_connection(repo: Repository, request_user=None) -> dict:
        """
        测试仓库连通性

        根据凭证模式解析凭证，调用对应 Provider 测试连接，并更新仓库健康状态。

        Args:
            repo: Repository 实例
            request_user: 当前请求用户

        Returns:
            {"connected": bool, "detail": str}
        """
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
        """
        获取仓库分支列表

        Args:
            repo: Repository 实例
            request_user: 当前请求用户

        Returns:
            分支信息字典列表
        """
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
        """
        获取指定分支的 commit 列表

        Args:
            repo: Repository 实例
            branch: 分支名称，默认使用仓库默认分支
            request_user: 当前请求用户

        Returns:
            CommitInfo 对象列表
        """
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
        同步指定仓库的 commits

        使用规则引擎审查提交信息，将结果保存到 CommitRecord。

        Args:
            repo: Repository 实例
            branch: 分支名称，默认使用仓库默认分支
            request_user: 当前请求用户

        Returns:
            {"synced_count": int, "illegal_count": int}
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
        """
        AI 审查建议（阶段二占位）

        当前基于规则引擎返回建议，后续可接入 LLM。

        Args:
            commit: CommitRecord 实例

        Returns:
            审查建议字典
        """
        suggestion = CommitReviewer.suggest(commit.message)
        return {
            "review_status": commit.review_status,
            "suggestion": suggestion,
            "risks": [],
        }
