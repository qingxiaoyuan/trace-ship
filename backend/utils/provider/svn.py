import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List, Optional

from django.utils.dateparse import parse_datetime

from .base import CommitInfo
from .exceptions import ConnectionError, ProviderError


class SVNProvider:
    """SVN 命令行适配器，语义上与 GitProvider 不同，但对外提供 list_commits / test_connection"""

    def __init__(self, repo_url: str, credential_data: dict):
        self.repo_url = repo_url.rstrip("/")
        self.username = credential_data.get("username", "")
        self.password = credential_data.get("password", "")

    def _base_cmd(self) -> List[str]:
        cmd = ["svn", "--non-interactive", "--no-auth-cache"]
        if self.username:
            cmd.extend(["--username", self.username])
        if self.password:
            cmd.extend(["--password", self.password])
        return cmd

    def _run(self, cmd: List[str], timeout: int = 60) -> str:
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
        cmd = self._base_cmd() + ["log", "--xml", "-l", str(per_page), self.repo_url]
        xml_data = self._run(cmd, timeout=60)
        return self._parse_xml_log(xml_data)

    def _parse_xml_log(self, xml_data: str) -> List[CommitInfo]:
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
        if not value:
            return None
        # SVN 日期通常形如 2023-01-01T12:00:00.000000Z
        dt = parse_datetime(value)
        return dt
