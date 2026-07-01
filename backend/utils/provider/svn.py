"""
SVN Provider

基于 svn 命令行的适配器，对外提供 list_commits / test_connection 接口。
"""
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List, Optional

from django.utils.dateparse import parse_datetime

from .base import CommitInfo, MergeRequestInfo
from .exceptions import ConnectionError, ProviderError


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
            raise ConnectionError(f"SVN 命令失败: {safe_stderr}")
        return result.stdout

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
