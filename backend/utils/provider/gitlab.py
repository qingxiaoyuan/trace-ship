"""
GitLab Provider

基于 GitLab REST API v4 的统一适配器实现。
"""
import logging
import threading
from datetime import datetime
from urllib.parse import quote

import requests
from django.utils.dateparse import parse_datetime

from .base import BranchInfo, CommitInfo, GitProvider, MergeRequestInfo, TagInfo
from .exceptions import AuthenticationError, ConnectionError, NotFoundError

logger = logging.getLogger(__name__)


class GitLabProvider(GitProvider):
    """
    GitLab REST API 适配器（统一使用 requests）
    """

    def __init__(self, server_url: str, credential_data: dict):
        """
        Args:
            server_url: GitLab 服务器地址
            credential_data: 解密后的凭证数据，需包含 token
        """
        super().__init__(server_url, credential_data)
        self.token = credential_data.get("token", "")
        self.session = requests.Session()
        self.session.headers.update({"PRIVATE-TOKEN": self.token})
        self.session.headers.update({"Accept": "application/json"})
        self.base_api = f"{self.server_url}/api/v4"
        # requests.Session 非线程安全：并发场景（如发布预览并行拉取 tag/提交）
        # 复用同一 provider 时用锁串行化底层 HTTP 调用，避免连接池/响应头竞争
        self._request_lock = threading.Lock()

    def _request(self, method: str, path: str, **kwargs):
        """
        发送 GitLab API 请求

        Args:
            method: HTTP 方法
            path: API 路径
            **kwargs: requests 额外参数

        Returns:
            Response 对象

        Raises:
            ConnectionError: 网络请求失败
            AuthenticationError: 认证失败
            ProviderError: 资源不存在或其他错误
        """
        url = f"{self.base_api}{path}"
        try:
            with self._request_lock:
                resp = self.session.request(method, url, timeout=30, **kwargs)
        except requests.RequestException as exc:
            raise ConnectionError(f"GitLab 请求失败: {exc}") from exc

        if resp.status_code == 401:
            # 记录 401 细节，帮助定位 token 失效的真实原因
            # （token 是否为空/被截断，GitLab 返回的具体响应体）
            token_preview = (
                f"{self.token[:4]}...{self.token[-4:]}"
                if len(self.token) >= 8
                else (self.token or "<空>")
            )
            diagnostic = {
                "url": url,
                "token_preview": token_preview,
                "status_code": resp.status_code,
                "response_body": resp.text[:500],
            }
            logger.warning(
                "GitLab 认证失败(401): url=%s, token脱敏=%s, 响应体=%s",
                url, token_preview, resp.text[:500],
            )
            exc = AuthenticationError("GitLab Token 无效或已过期")
            exc.diagnostic = diagnostic
            raise exc
        if resp.status_code == 404:
            raise NotFoundError(f"GitLab 资源不存在: {path}")
        resp.raise_for_status()
        return resp

    def _encode_identity(self, repo_identity: str) -> str:
        """将 owner/repo 编码为 URL 安全格式"""
        return quote(repo_identity, safe="")

    def test_connection(self) -> bool:
        """测试 GitLab 连通性"""
        resp = self._request("GET", "/user")
        return resp.status_code == 200

    def list_branches(self, repo_identity: str) -> list[BranchInfo]:
        """
        列出仓库全部分支

        GitLab 分支接口单页最多 100 条，按 X-Next-Page 响应头翻页
        拉取全部，保证同步时不会因截断误删本地分支。
        """
        encoded = self._encode_identity(repo_identity)
        result: list[BranchInfo] = []
        page = 1
        while True:
            resp = self._request(
                "GET",
                f"/projects/{encoded}/repository/branches",
                params={"per_page": 100, "page": page},
            )
            for b in resp.json():
                commit = b.get("commit") or {}
                result.append(
                    BranchInfo(
                        name=b["name"],
                        is_default=b.get("default", False),
                        last_commit_hash=commit.get("id"),
                        last_commit_author=commit.get("author_name", "") or "",
                        last_commit_message=commit.get("message", "") or "",
                        last_commit_at=self._parse_datetime(commit.get("committed_date")),
                    )
                )
            next_page = resp.headers.get("X-Next-Page")
            if not next_page:
                break
            page = int(next_page)
        return result

    def list_tree(
        self,
        repo_identity: str,
        path: str = "",
        ref: str = "",
        recursive: bool = True,
        max_entries: int = 300,
        per_page: int = 100,
    ) -> list[dict]:
        """
        列出仓库文件树（供 AI 生成打包脚本时读取仓库结构）。

        Args:
            repo_identity: 仓库标识（owner/repo）
            path: 子目录路径，为空时从仓库根开始
            ref: 分支 / tag / commit hash，为空时使用仓库默认分支
            recursive: 是否递归列出全部子目录
            max_entries: 最多返回的条目数（防止超大仓库撑爆 prompt）
            per_page: 单页条数（GitLab 上限 100）

        Returns:
            [{"path", "type", "name"}, ...]，type 为 tree / blob
        """
        encoded = self._encode_identity(repo_identity)
        result: list[dict] = []
        page = 1
        params: dict = {
            "per_page": per_page,
            "page": page,
            "recursive": str(recursive).lower(),
        }
        if path:
            params["path"] = path
        if ref:
            params["ref"] = ref
        while len(result) < max_entries:
            resp = self._request(
                "GET",
                f"/projects/{encoded}/repository/tree",
                params=params,
            )
            entries = resp.json()
            if not entries:
                break
            for item in entries:
                result.append(
                    {
                        "path": item.get("path", ""),
                        "type": item.get("type", "blob"),
                        "name": item.get("name", ""),
                    }
                )
                if len(result) >= max_entries:
                    break
            next_page = resp.headers.get("X-Next-Page")
            if not next_page or len(result) >= max_entries:
                break
            page = int(next_page)
            params["page"] = page
        return result

    def get_file_raw(
        self,
        repo_identity: str,
        file_path: str,
        ref: str = "",
        max_bytes: int = 65536,
    ) -> str | None:
        """
        读取仓库内单个文件内容（供 AI 生成打包脚本时读取清单文件）。

        文件不存在、二进制（含 NUL 字节）、解码失败或超过大小上限时
        返回 None，由调用方降级处理，不抛出异常。

        Args:
            repo_identity: 仓库标识（owner/repo）
            file_path: 文件路径，如 ``src/package.json``
            ref: 分支 / tag / commit hash，为空时使用仓库默认分支
            max_bytes: 文件大小上限，超过视为不可用

        Returns:
            文本内容或 None
        """
        encoded = self._encode_identity(repo_identity)
        file_encoded = quote(file_path, safe="")
        params = {"ref": ref} if ref else {}
        try:
            resp = self._request(
                "GET",
                f"/projects/{encoded}/repository/files/{file_encoded}/raw",
                params=params,
            )
        except NotFoundError:
            # 文件不存在等场景按缺失处理，由调用方降级；
            # 认证/连接错误不吞掉，交由 _scan_repo 降级并给出可读警告
            return None
        content = resp.content
        if content is None or len(content) > max_bytes or b"\x00" in content:
            return None
        try:
            return content.decode("utf-8")
        except UnicodeDecodeError:
            return None

    def list_commits(
        self,
        repo_identity: str,
        branch: str,
        since: datetime | None = None,
        until: datetime | None = None,
        per_page: int = 100,
    ) -> list[CommitInfo]:
        """拉取指定分支 commit 列表"""
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
        """获取单个 commit 详情"""
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

    def list_tags(self, repo_identity: str) -> list[TagInfo]:
        """
        列出仓库全部 tag

        单页最多 100 条，按 X-Next-Page 响应头翻页拉取全部。
        created_at 取 tag 指向 commit 的提交时间（committed_date），
        作为 tag 时间点的近似（GitLab REST API 不提供 tag 创建时间），
        用于发布预览的 MR/commit 时间截断；tag 打在历史 commit 上时
        该近似可能早于真实创建时间，调用方（如 review-range 的 MR 过滤）
        应知晓这一误差。
        """
        encoded = self._encode_identity(repo_identity)
        result: list[TagInfo] = []
        page = 1
        while True:
            resp = self._request(
                "GET",
                f"/projects/{encoded}/repository/tags",
                params={"per_page": 100, "page": page},
            )
            for t in resp.json():
                commit = t.get("commit") or {}
                result.append(
                    TagInfo(
                        name=t["name"],
                        commit_hash=commit.get("id"),
                        created_at=self._parse_datetime(commit.get("committed_date")),
                    )
                )
            next_page = resp.headers.get("X-Next-Page")
            if not next_page:
                break
            page = int(next_page)
        return result

    def create_tag(self, repo_identity: str, tag_name: str, commit_hash: str, message: str = "") -> TagInfo:
        """创建 tag（created_at 为 tag 指向 commit 的提交时间近似，同 list_tags 口径）"""
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
        commit = data.get("commit") or {}
        return TagInfo(
            name=data["name"],
            commit_hash=commit.get("id"),
            created_at=self._parse_datetime(commit.get("committed_date")),
        )

    def delete_tag(self, repo_identity: str, tag_name: str) -> None:
        """
        删除远端 tag

        GitLab REST API: DELETE /projects/{id}/repository/tags/{tag_name}。
        tag 不存在时返回 404，由 _request 抛出 NotFoundError，调用方按
        “已不存在”幂等处理。

        Args:
            repo_identity: 仓库标识（owner/repo）
            tag_name: 要删除的 tag 名称

        Raises:
            NotFoundError: tag 不存在
            ProviderError: 认证失败 / 连接失败 / 其他错误
        """
        encoded = self._encode_identity(repo_identity)
        encoded_tag = quote(tag_name, safe="")
        self._request(
            "DELETE",
            f"/projects/{encoded}/repository/tags/{encoded_tag}",
        )

    def compare_commits(self, repo_identity: str, base: str, head: str) -> list[CommitInfo]:
        """比较两个 ref 之间的 commits"""
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

    def get_merge_base(self, repo_identity: str, refs: list[str]) -> str | None:
        """
        获取多个 ref 的 merge base（共同祖先）commit hash

        调用 GitLab merge_base API；用于校验 tag 是否位于目标分支历史上，
        防止跨分支 tag 被误用为发布预览基线。
        """
        encoded = self._encode_identity(repo_identity)
        resp = self._request(
            "GET",
            f"/projects/{encoded}/repository/merge_base",
            params=[("refs[]", r) for r in refs],
        )
        return resp.json().get("id")

    def list_merge_requests(
        self,
        repo_identity: str,
        target_branch: str,
        since: datetime | None = None,
    ) -> list[MergeRequestInfo]:
        """拉取合并到目标分支的 MR 列表"""
        encoded = self._encode_identity(repo_identity)
        params: dict = {"state": "merged", "target_branch": target_branch, "per_page": 100}
        if since:
            params["updated_after"] = since.isoformat()
        resp = self._request("GET", f"/projects/{encoded}/merge_requests", params=params)
        return [
            MergeRequestInfo(
                number=str(mr.get("iid", "")),
                title=mr.get("title", ""),
                description=mr.get("description", "") or "",
                author=(mr.get("author") or {}).get("name", ""),
                source_branch=mr.get("source_branch", "") or "",
                target_branch=mr.get("target_branch", "") or "",
                web_url=mr.get("web_url", "") or "",
                merged_at=self._parse_datetime(mr.get("merged_at")),
            )
            for mr in resp.json()
        ]

    @staticmethod
    def _parse_datetime(value) -> datetime | None:
        """解析 ISO 格式日期字符串"""
        if not value:
            return None
        dt = parse_datetime(value)
        return dt
