"""
仓库业务服务

封装仓库连通性测试、分支/commit 查询、提交同步等业务逻辑。
"""
from typing import List, Optional
from urllib.parse import urlparse

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

        支持两种录入方式：
        - 服务器根地址，如 http://gitea.example.com
        - 仓库克隆地址，如 http://gitea.example.com/owner/repo.git

        Args:
            repo: Repository 实例

        Returns:
            服务端根地址字符串
        """
        url = repo.url.rstrip("/")
        parsed = urlparse(url)
        # 如果路径看起来像仓库克隆地址（包含 /owner/repo.git），只取 scheme + netloc
        path = parsed.path.strip("/")
        if path and ".git" in path:
            return f"{parsed.scheme}://{parsed.netloc}"
        return url

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
    def list_tags(repo: Repository, request_user=None) -> List[dict]:
        """
        获取仓库标签列表

        仅 Git 类仓库支持；SVN 仓库返回空列表。

        Args:
            repo: Repository 实例
            request_user: 当前请求用户

        Returns:
            标签信息字典列表
        """
        if repo.repo_type != "git":
            return []
        cred_data = resolve_credential(repo, request_user)
        provider = get_provider(repo.vendor, RepositoryService._resolve_server_url(repo), cred_data)
        tags = provider.list_tags(repo.external_identity)
        return [
            {
                "name": t.name,
                "commit_hash": t.commit_hash,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in tags
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

