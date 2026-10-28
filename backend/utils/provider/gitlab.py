"""
GitLab Provider

基于 GitLab REST API v4 的统一适配器实现。
"""
import json
import logging
import re
import threading
from datetime import datetime
from urllib.parse import quote

import requests
from django.utils.dateparse import parse_datetime

from .base import BranchInfo, CommitInfo, GitProvider, MergeRequestInfo, TagInfo
from .exceptions import AuthenticationError, ConnectionError, NotFoundError, ProviderError

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

        try:
            resp.raise_for_status()
        except requests.HTTPError as exc:
            diagnostic = self._http_error_diagnostic(resp, method, path)
            if resp.status_code == 401:
                message = "GitLab Token 无效或已过期"
                error_class = AuthenticationError
                diagnostic["url"] = self._redact_diagnostic(url)
                diagnostic["token_preview"] = (
                    f"{self.token[:4]}...{self.token[-4:]}" if len(self.token) > 8
                    else ("<已设置>" if self.token else "<空>")
                )
            elif resp.status_code == 404:
                message = f"GitLab 资源不存在: {diagnostic['path']}"
                error_class = NotFoundError
            else:
                message = f"GitLab 请求失败（HTTP {resp.status_code}）"
                error_class = ProviderError
            if diagnostic["request_id"]:
                message += f"，请求编号：{diagnostic['request_id']}"
            logger.warning("GitLab API 请求失败: %s", diagnostic)
            error = error_class(message)
            error.diagnostic = diagnostic
            raise error from exc
        return resp

    def _redact_diagnostic(self, value: object) -> object:
        """错误响应可能回显凭证，先递归脱敏，再截断或写入日志。"""
        if isinstance(value, dict):
            sensitive = {"token", "password", "secret", "authorization", "cookie", "set_cookie", "credentials"}
            return {
                key: "<REDACTED>" if (
                    str(key).lower().replace("-", "_") in sensitive
                    or str(key).lower().replace("-", "_").endswith(("_token", "_password", "_secret"))
                ) else self._redact_diagnostic(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [self._redact_diagnostic(item) for item in value]
        if isinstance(value, str):
            if self.token:
                for secret in {self.token, quote(self.token, safe=""), json.dumps(self.token)[1:-1]}:
                    value = value.replace(secret, "<REDACTED>")
            return re.sub(r"(?i)\b(Bearer|Basic)\s+[\w+/=.\-]+", r"\1 <REDACTED>", value)
        return value

    def _http_error_diagnostic(self, response: requests.Response, method: str, path: str) -> dict:
        """记录受限响应与请求编号，保留内网 GitLab/网关的定位线索。"""
        try:
            body = json.dumps(self._redact_diagnostic(response.json()), ensure_ascii=False)
        except ValueError:
            body = str(self._redact_diagnostic(response.text))
        request_id = response.headers.get("X-Request-Id") or response.headers.get("X-Correlation-Id", "")
        return {
            "method": method.upper(),
            "path": self._redact_diagnostic(path),
            "status_code": response.status_code,
            "request_id": " ".join(str(self._redact_diagnostic(request_id)).split())[:200],
            "response_body": body[:2000],
        }

    def _encode_identity(self, repo_identity: str) -> str:
        """将 owner/repo 编码为 URL 安全格式"""
        return quote(repo_identity, safe="")

    def test_connection(self) -> bool:
        """测试 GitLab 连通性"""
        resp = self._request("GET", "/user")
        return resp.status_code == 200

    @classmethod
    def _parse_branch(cls, data: dict) -> BranchInfo:
        """分支列表与详情使用同一套 HEAD 解析规则。"""
        commit = data.get("commit") or {}
        return BranchInfo(
            name=data["name"],
            is_default=data.get("default", False),
            last_commit_hash=commit.get("id"),
            last_commit_author=commit.get("author_name", "") or "",
            last_commit_message=commit.get("message", "") or "",
            last_commit_at=cls._parse_datetime(commit.get("committed_date")),
        )

    def get_branch(self, repo_identity: str, branch_name: str) -> BranchInfo:
        """查询分支专用接口，含斜杠的名称作为单个路径段编码。"""
        encoded = self._encode_identity(repo_identity)
        response = self._request("GET", f"/projects/{encoded}/repository/branches/{quote(branch_name, safe='')}")
        return self._parse_branch(response.json())

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
            result.extend(self._parse_branch(branch) for branch in resp.json())
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

    def _release_pages(self, path: str, params: dict, identity_key: str) -> list[dict]:
        """拉取全部分页，缺少分页头时继续探测；重复或异常页显式失败。"""
        result, seen = [], set()
        page = 1
        while True:
            resp = self._request("GET", path, params={**params, "per_page": 100, "page": page})
            try:
                items = resp.json()
            except ValueError as exc:
                raise ProviderError("GitLab 发布变更响应不是有效 JSON") from exc
            if not isinstance(items, list):
                raise ProviderError("GitLab 发布变更响应不完整")
            for item in items:
                identity = item.get(identity_key) if isinstance(item, dict) else None
                if not identity or identity in seen:
                    raise ProviderError("GitLab 发布变更分页重复或缺少标识，请重试")
                seen.add(identity)
                result.append(item)
            next_page = resp.headers.get("X-Next-Page")
            if next_page:
                if not next_page.isdigit() or int(next_page) != page + 1 or not items:
                    raise ProviderError("GitLab 发布变更分页异常，请重试")
                page = int(next_page)
            elif next_page == "" or len(items) < 100:
                break
            else:
                page += 1
        return result

    def list_release_commits(self, repo_identity: str, base: str, head: str) -> list[CommitInfo]:
        """GitLab commits 接口支持 revision range；不用可能截断的 compare 接口。"""
        encoded = self._encode_identity(repo_identity)
        items = self._release_pages(
            f"/projects/{encoded}/repository/commits", {"ref_name": f"{base}..{head}" if base else head}, "id",
        )
        return [CommitInfo(
            hash=c["id"], author=c.get("author_name", ""), author_email=c.get("author_email", ""),
            message=c.get("message", ""), committed_at=self._parse_datetime(c.get("committed_date")),
        ) for c in items]

    def list_release_merge_requests(self, repo_identity: str) -> list[MergeRequestInfo]:
        """跨分支与时间完整获取已合并 MR，由调用方按合并提交核验。"""
        encoded = self._encode_identity(repo_identity)
        items = self._release_pages(f"/projects/{encoded}/merge_requests", {"state": "merged", "scope": "all", "order_by": "created_at", "sort": "asc"}, "iid")
        return [MergeRequestInfo(
            number=str(mr["iid"]), title=mr.get("title", ""), description=mr.get("description") or "",
            author=(mr.get("author") or {}).get("name", ""), source_branch=mr.get("source_branch") or "",
            target_branch=mr.get("target_branch") or "", web_url=mr.get("web_url") or "",
            merged_at=self._parse_datetime(mr.get("merged_at")),
            merge_commit_sha=mr.get("merge_commit_sha") or "", squash_commit_sha=mr.get("squash_commit_sha") or "",
        ) for mr in items]

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
                        message=t.get("message") or "",
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
            message=data.get("message") or "",
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

    def compare_diff(self, repo_identity: str, base: str, head: str) -> list[dict]:
        """获取预览差异；远端报告截断时拒绝把不完整内容当作完整预览。"""
        encoded = self._encode_identity(repo_identity)
        data = self._request("GET", f"/projects/{encoded}/repository/compare",
                             params={"from": base, "to": head, "straight": "true"}).json()
        diffs = data.get("diffs")
        if data.get("compare_timeout") or not isinstance(diffs, list):
            raise ProviderError("代码差异获取不完整，请稍后重试")
        result = []
        for item in diffs:
            if item.get("too_large") or item.get("collapsed") or "diff" not in item:
                raise ProviderError("代码差异过大或被截断，无法完整预览")
            result.append({"old_path": item.get("old_path", ""), "new_path": item.get("new_path", ""),
                           "diff": item["diff"]})
        return result

    def review_diff(self, repo_identity: str, base: str, head: str) -> dict:
        """固定 SHA 差异与服务端覆盖声明，缺口不能标为完整审查。"""
        encoded = self._encode_identity(repo_identity)
        data = self._request(
            "GET", f"/projects/{encoded}/repository/compare",
            params={"from": base, "to": head, "straight": "true"},
        ).json()
        diffs = data.get("diffs")
        if not isinstance(diffs, list):
            raise ProviderError("代码差异响应无效，请重试")
        warnings = []
        if data.get("compare_timeout") is not False or data.get("overflow"):
            warnings.append("远端报告比较超时或差异超限，覆盖不完整")
        result = []
        for item in diffs:
            if not isinstance(item, dict):
                raise ProviderError("代码差异响应无效，请重试")
            old_path, new_path = item.get("old_path"), item.get("new_path")
            if not isinstance(old_path, str) or not isinstance(new_path, str):
                raise ProviderError("代码差异缺少文件路径，请重试")
            diff = item.get("diff")
            binary = bool(item.get("binary")) or (isinstance(diff, str) and diff.startswith(("Binary files ", "GIT binary patch")))
            if item.get("too_large") or item.get("collapsed") or binary or not isinstance(diff, str) or not diff:
                warnings.append(f"文件 {new_path or old_path} 的差异不可完整读取")
            result.append({
                "old_path": old_path, "new_path": new_path, "diff": diff if isinstance(diff, str) else "",
                "new_file": bool(item.get("new_file")), "deleted_file": bool(item.get("deleted_file")),
                "renamed_file": bool(item.get("renamed_file")), "binary": binary,
                "too_large": bool(item.get("too_large")), "collapsed": bool(item.get("collapsed")),
            })
        return {"diffs": result, "complete": not warnings, "warnings": warnings}

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
