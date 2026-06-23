from datetime import datetime
from typing import List, Optional
from urllib.parse import quote

import requests
from django.utils.dateparse import parse_datetime

from .base import BranchInfo, CommitInfo, GitProvider, TagInfo
from .exceptions import AuthenticationError, ConnectionError, ProviderError


class GitLabProvider(GitProvider):
    """GitLab REST API 适配器（统一使用 requests）"""

    def __init__(self, server_url: str, credential_data: dict):
        super().__init__(server_url, credential_data)
        self.token = credential_data.get("token", "")
        self.session = requests.Session()
        self.session.headers.update({"PRIVATE-TOKEN": self.token})
        self.session.headers.update({"Accept": "application/json"})
        self.base_api = f"{self.server_url}/api/v4"

    def _request(self, method: str, path: str, **kwargs):
        url = f"{self.base_api}{path}"
        try:
            resp = self.session.request(method, url, timeout=30, **kwargs)
        except requests.RequestException as exc:
            raise ConnectionError(f"GitLab 请求失败: {exc}") from exc

        if resp.status_code == 401:
            raise AuthenticationError("GitLab Token 无效或已过期")
        if resp.status_code == 404:
            raise ProviderError(f"GitLab 资源不存在: {path}")
        resp.raise_for_status()
        return resp

    def _encode_identity(self, repo_identity: str) -> str:
        return quote(repo_identity, safe="")

    def test_connection(self) -> bool:
        resp = self._request("GET", "/user")
        return resp.status_code == 200

    def list_branches(self, repo_identity: str) -> List[BranchInfo]:
        encoded = self._encode_identity(repo_identity)
        resp = self._request(
            "GET",
            f"/projects/{encoded}/repository/branches",
            params={"per_page": 100},
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
        encoded = self._encode_identity(repo_identity)
        params = {"ref_name": branch, "per_page": per_page}
        if since:
            params["since"] = since.isoformat()
        if until:
            params["until"] = until.isoformat()

        resp = self._request(
            "GET",
            f"/projects/{encoded}/repository/commits",
            params=params,
        )
        return [
            CommitInfo(
                hash=c["id"],
                author=c.get("author_name", ""),
                author_email=c.get("author_email", ""),
                message=c.get("message", ""),
                committed_at=self._parse_datetime(c.get("committed_date")),
            )
            for c in resp.json()
        ]

    def get_commit(self, repo_identity: str, commit_hash: str) -> CommitInfo:
        encoded = self._encode_identity(repo_identity)
        resp = self._request(
            "GET",
            f"/projects/{encoded}/repository/commits/{commit_hash}",
        )
        c = resp.json()
        return CommitInfo(
            hash=c["id"],
            author=c.get("author_name", ""),
            author_email=c.get("author_email", ""),
            message=c.get("message", ""),
            committed_at=self._parse_datetime(c.get("committed_date")),
        )

    def list_tags(self, repo_identity: str) -> List[TagInfo]:
        encoded = self._encode_identity(repo_identity)
        resp = self._request(
            "GET",
            f"/projects/{encoded}/repository/tags",
            params={"per_page": 100},
        )
        return [
            TagInfo(
                name=t["name"],
                commit_hash=t.get("commit", {}).get("id"),
            )
            for t in resp.json()
        ]

    def create_tag(self, repo_identity: str, tag_name: str, commit_hash: str, message: str = "") -> TagInfo:
        encoded = self._encode_identity(repo_identity)
        payload = {"tag_name": tag_name, "ref": commit_hash}
        if message:
            payload["message"] = message
        resp = self._request(
            "POST",
            f"/projects/{encoded}/repository/tags",
            json=payload,
        )
        data = resp.json()
        return TagInfo(
            name=data["name"],
            commit_hash=data.get("commit", {}).get("id"),
        )

    def compare_commits(self, repo_identity: str, base: str, head: str) -> List[CommitInfo]:
        encoded = self._encode_identity(repo_identity)
        resp = self._request(
            "GET",
            f"/projects/{encoded}/repository/compare",
            params={"from": base, "to": head},
        )
        return [
            CommitInfo(
                hash=c["id"],
                author=c.get("author_name", ""),
                author_email=c.get("author_email", ""),
                message=c.get("message", ""),
                committed_at=self._parse_datetime(c.get("committed_date")),
            )
            for c in resp.json().get("commits", [])
        ]

    @staticmethod
    def _parse_datetime(value) -> Optional[datetime]:
        if not value:
            return None
        dt = parse_datetime(value)
        return dt
