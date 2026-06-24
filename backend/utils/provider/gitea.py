"""
Gitea Provider

基于 Gitea REST API v1 的统一适配器实现。
"""
from datetime import datetime
from typing import List, Optional

import requests
from django.utils.dateparse import parse_datetime

from .base import BranchInfo, CommitInfo, GitProvider, TagInfo
from .exceptions import AuthenticationError, ConnectionError, ProviderError


class GiteaProvider(GitProvider):
    """
    Gitea REST API 适配器
    """

    def __init__(self, server_url: str, credential_data: dict):
        """
        Args:
            server_url: Gitea 服务器地址
            credential_data: 解密后的凭证数据，需包含 token
        """
        super().__init__(server_url, credential_data)
        self.token = credential_data.get("token", "")
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"token {self.token}"})
        self.session.headers.update({"Accept": "application/json"})
        self.base_api = f"{self.server_url}/api/v1"

    def _owner_repo(self, repo_identity: str) -> tuple:
        """
        解析仓库标识

        Args:
            repo_identity: owner/repo 格式字符串

        Returns:
            (owner, repo) 元组

        Raises:
            ProviderError: 格式错误时抛出
        """
        parts = repo_identity.split("/")
        if len(parts) != 2:
            raise ProviderError(f"Gitea 仓库标识格式错误: {repo_identity}，应为 owner/repo")
        return parts[0], parts[1]

    def _request(self, method: str, path: str, **kwargs):
        """
        发送 Gitea API 请求

        Raises:
            ConnectionError: 网络请求失败
            AuthenticationError: 认证失败
            ProviderError: 资源不存在
        """
        url = f"{self.base_api}{path}"
        try:
            resp = self.session.request(method, url, timeout=30, **kwargs)
        except requests.RequestException as exc:
            raise ConnectionError(f"Gitea 请求失败: {exc}") from exc

        if resp.status_code == 401:
            raise AuthenticationError("Gitea Token 无效或已过期")
        if resp.status_code == 404:
            raise ProviderError(f"Gitea 资源不存在: {path}")
        resp.raise_for_status()
        return resp

    def test_connection(self) -> bool:
        """测试 Gitea 连通性"""
        resp = self._request("GET", "/user")
        return resp.status_code == 200

    def list_branches(self, repo_identity: str) -> List[BranchInfo]:
        """列出仓库分支"""
        owner, repo = self._owner_repo(repo_identity)
        resp = self._request(
            "GET",
            f"/repos/{owner}/{repo}/branches",
            params={"limit": 100},
        )
        return [
            BranchInfo(
                name=b["name"],
                is_default=b.get("default", False),
                last_commit_hash=b.get("commit", {}).get("id"),
            )
            for b in resp.json()
        ]

    def list_commits(
        self,
        repo_identity: str,
        branch: str,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        per_page: int = 100,
    ) -> List[CommitInfo]:
        """拉取指定分支 commit 列表"""
        owner, repo = self._owner_repo(repo_identity)
        params = {"sha": branch, "limit": per_page}
        if since:
            params["since"] = since.isoformat()
        if until:
            params["until"] = until.isoformat()

        resp = self._request(
            "GET",
            f"/repos/{owner}/{repo}/commits",
            params=params,
        )
        return [
            CommitInfo(
                hash=c["sha"],
                author=c.get("commit", {}).get("author", {}).get("name", ""),
                author_email=c.get("commit", {}).get("author", {}).get("email", ""),
                message=c.get("commit", {}).get("message", ""),
                committed_at=self._parse_datetime(
                    c.get("commit", {}).get("author", {}).get("date")
                ),
            )
            for c in resp.json()
        ]

    def get_commit(self, repo_identity: str, commit_hash: str) -> CommitInfo:
        """获取单个 commit 详情"""
        owner, repo = self._owner_repo(repo_identity)
        resp = self._request(
            "GET",
            f"/repos/{owner}/{repo}/git/commits/{commit_hash}",
        )
        c = resp.json()
        return CommitInfo(
            hash=c["sha"],
            author=c.get("author", {}).get("name", ""),
            author_email=c.get("author", {}).get("email", ""),
            message=c.get("message", ""),
            committed_at=self._parse_datetime(c.get("author", {}).get("date")),
        )

    def list_tags(self, repo_identity: str) -> List[TagInfo]:
        """列出仓库 tag"""
        owner, repo = self._owner_repo(repo_identity)
        resp = self._request(
            "GET",
            f"/repos/{owner}/{repo}/tags",
            params={"limit": 100},
        )
        return [
            TagInfo(
                name=t["name"],
                commit_hash=t.get("commit", {}).get("sha"),
            )
            for t in resp.json()
        ]

    def create_tag(self, repo_identity: str, tag_name: str, commit_hash: str, message: str = "") -> TagInfo:
        """创建 tag"""
        owner, repo = self._owner_repo(repo_identity)
        payload = {"tag_name": tag_name, "target": commit_hash}
        if message:
            payload["message"] = message
        resp = self._request(
            "POST",
            f"/repos/{owner}/{repo}/tags",
            json=payload,
        )
        data = resp.json()
        return TagInfo(
            name=data["name"],
            commit_hash=data.get("commit", {}).get("sha"),
        )

    def compare_commits(self, repo_identity: str, base: str, head: str) -> List[CommitInfo]:
        """比较两个 ref 之间的 commits"""
        owner, repo = self._owner_repo(repo_identity)
        resp = self._request(
            "GET",
            f"/repos/{owner}/{repo}/compare/{base}...{head}",
        )
        return [
            CommitInfo(
                hash=c["sha"],
                author=c.get("commit", {}).get("author", {}).get("name", ""),
                author_email=c.get("commit", {}).get("author", {}).get("email", ""),
                message=c.get("commit", {}).get("message", ""),
                committed_at=self._parse_datetime(
                    c.get("commit", {}).get("author", {}).get("date")
                ),
            )
            for c in resp.json().get("commits", [])
        ]

    @staticmethod
    def _parse_datetime(value) -> Optional[datetime]:
        """解析 ISO 格式日期字符串"""
        if not value:
            return None
        return parse_datetime(value)
