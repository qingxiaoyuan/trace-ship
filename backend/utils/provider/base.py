from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional


@dataclass
class CommitInfo:
    hash: str
    author: str
    author_email: str
    message: str
    committed_at: datetime
    files_changed: Optional[List[str]] = None


@dataclass
class BranchInfo:
    name: str
    is_default: bool = False
    last_commit_hash: Optional[str] = None


@dataclass
class TagInfo:
    name: str
    commit_hash: Optional[str] = None
    created_at: Optional[datetime] = None


class GitProvider(ABC):
    """Git 平台统一适配器抽象基类"""

    def __init__(self, server_url: str, credential_data: dict):
        self.server_url = server_url.rstrip("/")
        self.credential_data = credential_data

    @abstractmethod
    def test_connection(self) -> bool:
        """测试连通性，成功返回 True，失败抛出异常"""
        pass

    @abstractmethod
    def list_branches(self, repo_identity: str) -> List[BranchInfo]:
        """列出分支"""
        pass

    @abstractmethod
    def list_commits(
        self,
        repo_identity: str,
        branch: str,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        per_page: int = 100,
    ) -> List[CommitInfo]:
        """拉取 commit 列表"""
        pass

    @abstractmethod
    def get_commit(self, repo_identity: str, commit_hash: str) -> CommitInfo:
        """获取单个 commit"""
        pass

    @abstractmethod
    def list_tags(self, repo_identity: str) -> List[TagInfo]:
        """列出 tag"""
        pass

    @abstractmethod
    def create_tag(self, repo_identity: str, tag_name: str, commit_hash: str, message: str = "") -> TagInfo:
        """创建 tag"""
        pass

    @abstractmethod
    def compare_commits(self, repo_identity: str, base: str, head: str) -> List[CommitInfo]:
        """比较两个 ref 之间的差异"""
        pass
