"""
SVN Provider

基于 svn 命令行的适配器，对外提供 list_commits / test_connection 接口。
"""
import os
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List, Optional

from django.utils.dateparse import parse_datetime

from .base import CommitInfo, MergeRequestInfo
from .exceptions import AuthenticationError, ConnectionError, NotFoundError, ProviderError


class SVNProvider:
    """
    SVN 命令行适配器

    语义上与 GitProvider 不同，但对外提供 list_commits / test_connection 能力。
    """

    def __init__(self, repo_url: str, credential_data: dict):
        """
        Args:
            repo_url: SVN 仓库地址
            credential_data: 解密后的凭证数据，可包含 username/password
        """
        self.repo_url = repo_url.rstrip("/")
        self.username = credential_data.get("username", "")
        self.password = credential_data.get("password", "")

    def _base_cmd(self) -> List[str]:
        """构造带认证的 svn 基础命令"""
        cmd = ["svn", "--non-interactive", "--no-auth-cache"]
        if self.username:
            cmd.extend(["--username", self.username])
        if self.password:
            cmd.extend(["--password", self.password])
        return cmd

    def _run(self, cmd: List[str], timeout: int = 60) -> str:
        """
        执行 svn 命令

        Args:
            cmd: 命令参数列表
            timeout: 超时时间（秒）

        Returns:
            命令标准输出

        Raises:
            ConnectionError: 命令执行失败、超时或未安装 svn
        """
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ConnectionError(f"SVN 命令执行超时: {' '.join(cmd)}") from exc
        except FileNotFoundError as exc:
            raise ConnectionError("未找到 svn 命令行工具，请安装 subversion") from exc

        if result.returncode != 0:
            # 避免将密码输出到日志
            safe_stderr = result.stderr.replace(self.password, "***") if self.password else result.stderr
            raise self._classify_error(safe_stderr)
        return result.stdout

    @staticmethod
    def _classify_error(stderr: str) -> ProviderError:
        """根据 svn stderr 内容分类异常。"""
        lower = stderr.lower()
        # 认证失败优先判定
        auth_hints = [
            "authorization failed",
            "authentication failed",
            "could not authenticate",
            "username not found",
            "password not found",
            "e170001",
            "e215004",
            "authentication error",
        ]
        if any(h in lower for h in auth_hints):
            return AuthenticationError(f"SVN 认证失败: {stderr}")
        # 路径/仓库不存在
        not_found_hints = [
            "e160013",
            "e170000",
            "url not found",
            "path not found",
            "non-existent in that revision",
            "w160013",
            "w170000",
            "doesn't exist",
        ]
        if any(h in lower for h in not_found_hints):
            return NotFoundError(f"SVN 路径不存在: {stderr}")
        # 网络/连接问题
        conn_hints = [
            "could not resolve hostname",
            "could not connect to server",
            "connection timed out",
            "connection refused",
            "no route to host",
            "e730053",
            "e120002",
            "e000111",
            "network is unreachable",
        ]
        if any(h in lower for h in conn_hints):
            return ConnectionError(f"SVN 连接失败: {stderr}")
        return ConnectionError(f"SVN 命令失败: {stderr}")

    def test_connection(self) -> bool:
        """测试 SVN 仓库连通性"""
        cmd = self._base_cmd() + ["info", self.repo_url]
        self._run(cmd, timeout=30)
        return True

    def list_commits(
        self,
        branch: str = None,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        per_page: int = 100,
    ) -> List[CommitInfo]:
        """
        拉取 SVN 提交日志

        Args:
            branch: SVN 中分支概念较弱，暂不使用
            since: 起始时间
            until: 结束时间
            per_page: 最大条数

        Returns:
            CommitInfo 列表
        """
        cmd = self._base_cmd() + ["log", "--xml", "-l", str(per_page), self.repo_url]
        xml_data = self._run(cmd, timeout=60)
        return self._parse_xml_log(xml_data)

    def _parse_xml_log(self, xml_data: str) -> List[CommitInfo]:
        """
        解析 SVN log XML

        Args:
            xml_data: svn log --xml 输出

        Returns:
            CommitInfo 列表

        Raises:
            ProviderError: XML 解析失败
        """
        try:
            root = ET.fromstring(xml_data)
        except ET.ParseError as exc:
            raise ProviderError(f"无法解析 SVN log XML: {exc}") from exc

        commits = []
        for entry in root.findall("logentry"):
            revision = entry.get("revision", "")
            author = entry.findtext("author", default="")
            date_str = entry.findtext("date", default="")
            msg = entry.findtext("msg", default="")
            commits.append(
                CommitInfo(
                    hash=revision,
                    author=author,
                    author_email="",
                    message=msg,
                    committed_at=self._parse_svn_date(date_str),
                )
            )
        return commits

    @staticmethod
    def _parse_svn_date(value: str) -> Optional[datetime]:
        """
        解析 SVN 日期格式

        SVN 日期通常形如 2023-01-01T12:00:00.000000Z
        """
        if not value:
            return None
        dt = parse_datetime(value)
        return dt

    def list_merge_requests(
        self,
        repo_identity: str,
        target_branch: str,
        since: Optional[datetime] = None,
    ) -> List[MergeRequestInfo]:
        """SVN 不支持 MR 概念，返回空列表"""
        return []

    def list_dir(self, url: str = None) -> List[dict]:
        """
        列出 SVN 远程目录的直接子项（不递归）。

        Args:
            url: 要列出的远程目录地址，缺省为仓库根地址

        Returns:
            条目列表，每项包含 name / kind(dir|file) / size / revision / author / date

        Raises:
            ConnectionError: 命令执行失败或路径不存在
            ProviderError: XML 解析失败
        """
        target = (url or self.repo_url).rstrip("/")
        cmd = self._base_cmd() + ["list", "--xml", target]
        xml_data = self._run(cmd, timeout=60)
        return self._parse_xml_list(xml_data)

    def _parse_xml_list(self, xml_data: str) -> List[dict]:
        """
        解析 svn list --xml 输出

        Args:
            xml_data: svn list --xml 输出

        Returns:
            目录条目列表

        Raises:
            ProviderError: XML 解析失败
        """
        try:
            root = ET.fromstring(xml_data)
        except ET.ParseError as exc:
            raise ProviderError(f"无法解析 SVN list XML: {exc}") from exc

        entries = []
        for entry in root.iter("entry"):
            kind = entry.get("kind", "")
            commit = entry.find("commit")
            size_text = entry.findtext("size", default="")
            entries.append(
                {
                    "name": entry.findtext("name", default=""),
                    "kind": kind,
                    "size": int(size_text) if size_text.isdigit() else 0,
                    "revision": commit.get("revision", "") if commit is not None else "",
                    "author": commit.findtext("author", default="") if commit is not None else "",
                    "date": self._parse_svn_date(
                        commit.findtext("date", default="") if commit is not None else ""
                    ),
                }
            )
        return entries

    def remote_exists(self, url: str) -> bool:
        """
        检查远程路径是否已存在。

        Args:
            url: SVN 远程路径

        Returns:
            路径存在返回 True，否则返回 False
        """
        cmd = self._base_cmd() + ["info", url]
        try:
           self._run(cmd, timeout=30)
           return True
        except ProviderError:
            return False

    def mkdir(self, remote_url: str, message: str = "") -> None:
        """
        在 SVN 仓库中远程创建目录。

        Args:
            remote_url: 要创建的远程目录地址
            message: 提交说明

        Raises:
            ConnectionError: 命令执行失败
        """
        cmd = self._base_cmd() + ["mkdir", remote_url, "-m", message]
        self._run(cmd, timeout=60)

    def import_path(self, local_path: str, remote_url: str, message: str = "") -> None:
        """
        将本地文件或目录导入 SVN（无需工作副本）。

        Args:
            local_path: 本地文件或目录路径
            remote_url: SVN 远程目标地址
            message: 提交说明

        Raises:
            ConnectionError: 命令执行失败或超时
        """
        cmd = self._base_cmd() + ["import", local_path, remote_url, "-m", message]
        self._run(cmd, timeout=300)

    def replace_file(self, remote_url: str, local_path: str, message: str = "") -> None:
        """
        替换 SVN 远程目录中的单个文件（checkout -> 覆盖 -> commit）。

        用于已推送过产物的版本目录中更新发布文档等单个文件，无需整目录重建。

        Args:
            remote_url: SVN 远程目录地址
            local_path: 本地新文件路径，取文件名替换远程同名文件
            message: 提交说明

        Raises:
            NotFoundError: 远程目录中不存在同名文件
            ConnectionError: 命令执行失败或超时
        """
        filename = os.path.basename(local_path)
        if not filename:
            raise ProviderError("替换文件名为空")
        workcopy = tempfile.mkdtemp(prefix="trace-ship-svn-")
        try:
            # 仅检出目录下文件（发布文档位于版本目录根），避免拉取整个产物子目录
            checkout_cmd = self._base_cmd() + [
                "checkout", remote_url, workcopy, "--depth", "files",
            ]
            self._run(checkout_cmd, timeout=300)

            target = os.path.join(workcopy, filename)
            if not os.path.exists(target):
                raise NotFoundError(f"SVN 远程目录中不存在文件: {filename}")
            with open(local_path, "rb") as fsrc:
                new_data = fsrc.read()
            with open(target, "rb") as fdst:
                old_data = fdst.read()
            # 内容一致时跳过 commit，避免 SVN "no changes" 误报为同步失败
            if old_data != new_data:
                with open(target, "wb") as fdst:
                    fdst.write(new_data)
                commit_cmd = self._base_cmd() + ["commit", workcopy, "-m", message]
                self._run(commit_cmd, timeout=300)
        finally:
            shutil.rmtree(workcopy, ignore_errors=True)

    def _status_entries(self, workcopy: str) -> list[tuple]:
        """解析工作副本 svn status（XML），返回 (item_status, path) 列表。"""
        status_xml = self._run(self._base_cmd() + ["status", "--xml", workcopy], timeout=120)
        entries: list[tuple] = []
        for entry in ET.fromstring(status_xml).iter("entry"):
            wc_status = entry.find("wc-status")
            if wc_status is None:
                continue
            entries.append((wc_status.get("item", ""), entry.get("path", "")))
        return entries

    def sync_directory(self, remote_url: str, local_dir: str, message: str = "") -> None:
        """
        将本地目录镜像覆盖同步到已存在的 SVN 远程目录（checkout -> 覆盖 -> commit）。

        与 import_path 的"全新导入"不同，本方法面向已存在的远程目录：
        新增文件 svn add、内容变化直接覆盖、本地已删除的远程文件 svn rm，
        提交后远程目录内容与本地完全一致。无任何变更时跳过 commit。

        Args:
            remote_url: SVN 远程目标目录地址（必须已存在）
            local_dir: 本地目录路径
            message: 提交说明

        Raises:
            NotFoundError: 远程目录不存在
            ConnectionError: 命令执行失败或超时
        """
        workcopy = tempfile.mkdtemp(prefix="trace-ship-svn-sync-")
        try:
            # 全量检出：覆盖式同步需比对整棵目录树（含子目录），不能用 --depth files；
            # 忽略 svn:externals，避免外部引用内容被误纳入同步范围
            self._run(self._base_cmd() + ["checkout", "--ignore-externals", remote_url, workcopy], timeout=300)

            # 本地内容覆盖拷贝进工作副本（跳过 .svn 元数据）
            for root, dirs, files in os.walk(local_dir):
                dirs[:] = [d for d in dirs if d != ".svn"]
                rel_root = os.path.relpath(root, local_dir)
                target_root = workcopy if rel_root == "." else os.path.join(workcopy, rel_root)
                os.makedirs(target_root, exist_ok=True)
                for name in files:
                    shutil.copy2(os.path.join(root, name), os.path.join(target_root, name))

            entries = self._status_entries(workcopy)
            # 新增：--force 递归把版本控制外（?）的文件/目录加入
            if any(item == "unversioned" for item, _ in entries):
                self._run(self._base_cmd() + ["add", "--force", workcopy], timeout=120)
            # 删除：本地已删（!）的路径逐个 svn rm；父目录已删时跳过其子路径
            missing = sorted(
                (path for item, path in entries if item == "missing" and path),
                key=len,
            )
            removed: list[str] = []
            for path in missing:
                if any(path.startswith(parent + os.sep) for parent in removed):
                    continue
                self._run(self._base_cmd() + ["rm", "--force", path], timeout=120)
                removed.append(path)

            # 重新确认存在变更（新增/删除/修改）后再提交；无变更跳过，避免 "no changes" 误报
            changed = {"added", "deleted", "modified", "replaced"}
            if any(item in changed for item, _ in self._status_entries(workcopy)):
                self._run(self._base_cmd() + ["commit", workcopy, "-m", message], timeout=300)
        finally:
            shutil.rmtree(workcopy, ignore_errors=True)
