"""
Gitea Provider

基于 Gitea REST API v1 的统一适配器实现。
"""
from datetime import datetime
from typing import List, Optional

import requests
from django.utils.dateparse import parse_datetime

from .base import BranchInfo, CommitInfo, GitProvider, MergeRequestInfo, TagInfo
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
        # 兼容 token 模式和 password 模式（后者可能把 token 存在 password 字段）
        self.token = credential_data.get("token") or credential_data.get("password", "")
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
            raise ProviderError(f"Gitea 资源不存在: {path} (URL: {url})")
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
                created_at=self._parse_datetime(
                    t.get("created")
                    or (t.get("commit") or {}).get("created")
                ),
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
        """
        比较两个 ref 之间的 commits。

        优先调用 Gitea 原生 compare 接口；部分 Gitea 版本无该接口或返回 404，
        则回退到分别拉取 base/head 的 commits，按 commit hash 去重后取差集。
        """
        owner, repo = self._owner_repo(repo_identity)
        try:
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
        except Exception as exc:
            # compare 接口不存在或失败时，回退到 hash 差集
            logger = __import__("logging").getLogger(__name__)
            logger.warning("Gitea compare 接口调用失败，回退到 hash 差集: %s", exc)
            try:
                base_commits = self.list_commits(repo_identity, base, per_page=100)
                head_commits = self.list_commits(repo_identity, head, per_page=100)
            except Exception:
                return []
            base_hashes = {c.hash for c in base_commits}
            return [c for c in head_commits if c.hash not in base_hashes]

    def list_merge_requests(
        self,
        repo_identity: str,
        target_branch: str,
        since: Optional[datetime] = None,
    ) -> List[MergeRequestInfo]:
        """拉取合并到目标分支的 PR 列表"""
        owner, repo = self._owner_repo(repo_identity)
        params: dict = {
            "state": "closed",
            "base": target_branch,
            "limit": 100,
        }
        resp = self._request(
            "GET",
            f"/repos/{owner}/{repo}/pulls",
            params=params,
        )
        result: List[MergeRequestInfo] = []
        for pr in resp.json():
            merged_at = self._parse_datetime(pr.get("merged_at"))
            # Gitea state=closed 可能仅关闭未合并，过滤掉未合并的
            if not pr.get("merged") and not merged_at:
                continue
            if since and merged_at and merged_at < since:
                continue
            result.append(
                MergeRequestInfo(
                    number=str(pr.get("number", "")),
                    title=pr.get("title", "") or "",
                    description=pr.get("body", "") or "",
                    author=pr.get("user", {}).get("login", "") or "",
                    source_branch=pr.get("head", {}).get("ref", "") or "",
                    target_branch=pr.get("base", {}).get("ref", "") or "",
                    web_url=pr.get("html_url", "") or "",
                    merged_at=merged_at,
                )
            )
        return result

    def list_merge_requests(
        self,
        repo_identity: str,
        target_branch: str,
        since: Optional[datetime] = None,
    ) -> List[MergeRequestInfo]:
        """拉取合并到目标分支的 PR 列表（Gitea 中 PR 即 Pull Request）"""
        owner, repo = self._owner_repo(repo_identity)
        params: dict = {
            "state": "closed",
            "base": target_branch,
            "limit": 100,
        }
        if since:
            params["since"] = since.isoformat()
        resp = self._request(
            "GET",
            f"/repos/{owner}/{repo}/pulls",
            params=params,
        )
        mrs: List[MergeRequestInfo] = []
        for pr in resp.json():
            merged_at = self._parse_datetime(pr.get("merged_at"))
            # Gitea closed 状态可能含未合并的 PR，仅保留已合并的
            if pr.get("merged") is not True and merged_at is None:
                continue
            mrs.append(
                MergeRequestInfo(
                    number=str(pr.get("number", "")),
                    title=pr.get("title", ""),
                    description=pr.get("body", "") or "",
                    author=pr.get("user", {}).get("login", "") or "",
                    source_branch=pr.get("head", {}).get("ref", "") or "",
                    target_branch=pr.get("base", {}).get("ref", "") or "",
                    web_url=pr.get("html_url", "") or "",
                    merged_at=merged_at,
                )
            )
        return mrs

    def list_merge_requests(
        self,
        repo_identity: str,
        target_branch: str,
        since: Optional[datetime] = None,
    ) -> List[MergeRequestInfo]:
        """拉取合并到目标分支的 PR 列表"""
        owner, repo = self._owner_repo(repo_identity)
        params: dict = {
            "state": "closed",
            "base": target_branch,
            "limit": 100,
        }
        if since:
            params["since"] = since.isoformat()
        resp = self._request(
            "GET",
            f"/repos/{owner}/{repo}/pulls",
            params=params,
        )
        result: List[MergeRequestInfo] = []
        for pr in resp.json():
            merged_at_raw = pr.get("merged_at")
            # Gitea 返回的 closed 但未合并的 PR 需过滤
            if not merged_at_raw:
                continue
            user = pr.get("user", {}) or {}
            result.append(
                MergeRequestInfo(
                    number=str(pr.get("number", "")),
                    title=pr.get("title", "") or "",
                    description=pr.get("body", "") or "",
                    author=user.get("login", "") or user.get("full_name", "") or "",
                    source_branch=pr.get("head", {}).get("ref", "") or "",
                    target_branch=pr.get("base", {}).get("ref", "") or "",
                    web_url=pr.get("html_url", "") or "",
                    merged_at=self._parse_datetime(merged_at_raw),
                )
            )
        return result

    def list_merge_requests(
        self,
        repo_identity: str,
        target_branch: str,
        since: Optional[datetime] = None,
    ) -> List[MergeRequestInfo]:
        """拉取合并到目标分支的 PR 列表（Gitea 称为 Pull）"""
        owner, repo = self._owner_repo(repo_identity)
        params: dict = {
            "state": "closed",
            "base": target_branch,
            "limit": 100,
            "type": "pulls",
        }
        if since:
            params["since"] = since.isoformat()
        resp = self._request(
            "GET",
            f"/repos/{owner}/{repo}/pulls",
            params=params,
        )
        return [
            MergeRequestInfo(
                number=str(pr.get("number", "")),
                title=pr.get("title", ""),
                description=pr.get("body", "") or "",
                author=pr.get("user", {}).get("login", ""),
                source_branch=pr.get("head", {}).get("ref", "") or "",
                target_branch=pr.get("base", {}).get("ref", "") or "",
                web_url=pr.get("html_url", "") or "",
                merged_at=self._parse_datetime(pr.get("merged_at")),
            )
            for pr in resp.json()
        ]

    def list_merge_requests(
        self,
        repo_identity: str,
        target_branch: str,
        since: Optional[datetime] = None,
    ) -> List[MergeRequestInfo]:
        """拉取合并到目标分支的 PR 列表"""
        owner, repo = self._owner_repo(repo_identity)
        params: dict = {
            "state": "closed",
            "base": target_branch,
            "limit": 100,
            "type": "pulls",
        }
        if since:
            params["since"] = since.isoformat()
        resp = self._request(
            "GET",
            f"/repos/{owner}/{repo}/pulls",
            params=params,
        )
        return [
            MergeRequestInfo(
                number=str(p.get("number", "")),
                title=p.get("title", ""),
                description=p.get("body", "") or "",
                author=p.get("user", {}).get("login", ""),
                source_branch=p.get("head", {}).get("ref", "") or "",
                target_branch=p.get("base", {}).get("ref", "") or "",
                web_url=p.get("html_url", "") or "",
                merged_at=self._parse_datetime(p.get("merged_at")),
            )
            for p in resp.json()
            if p.get("merged_at") is not None
        ]

    @staticmethod
    def _parse_datetime(value) -> Optional[datetime]:
        """解析 ISO 格式日期字符串"""
        if not value:
            return None
        return parse_datetime(value)
