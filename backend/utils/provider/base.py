"""
Provider 抽象基类与数据类

定义 Git 平台统一适配器接口以及 Commit/Branch/Tag 信息的数据结构。
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, List, Optional


@dataclass
class CommitInfo:
    """
    提交信息数据类

    Attributes:
        hash: 提交哈希
        author: 提交人姓名
        author_email: 提交人邮箱
        message: 提交信息
        committed_at: 提交时间
        files_changed: 变更文件列表（可选）
    """

    hash: str
    author: str
    author_email: str
    message: str
    committed_at: datetime
    files_changed: Optional[List[str]] = None


@dataclass
class BranchInfo:
    """
    分支信息数据类

    Attributes:
        name: 分支名称
        is_default: 是否为默认分支
        last_commit_hash: 最新提交哈希
    """

    name: str
    is_default: bool = False
    last_commit_hash: Optional[str] = None


@dataclass
class TagInfo:
    """
    Tag 信息数据类

    Attributes:
        name: Tag 名称
        commit_hash: 关联提交哈希
        created_at: 创建时间
    """

    name: str
    commit_hash: Optional[str] = None
    created_at: Optional[datetime] = None


class GitProvider(ABC):
    """
    Git 平台统一适配器抽象基类

    所有 Git 类 Provider（GitLab/Gitea/GitHub/Gitee）应继承此类并实现抽象方法。
    """

    def __init__(self, server_url: str, credential_data: dict):
        """
        Args:
            server_url: 服务器地址
            credential_data: 解密后的凭证数据
        """
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
