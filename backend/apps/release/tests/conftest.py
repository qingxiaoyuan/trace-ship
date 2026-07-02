"""
发布管理测试夹具

提供用户、项目、凭证、仓库、提交记录等通用测试数据。
"""
import pytest

from apps.account.models import User
from apps.credential.models import Credential
from apps.project.models import Project, ProjectMember
from apps.repository.models import CommitRecord, Repository


@pytest.fixture
def user():
    """测试用户"""
    return User.objects.create_user(
        username="releaseuser",
        password="testpass",
        nickname="发布测试用户",
    )


@pytest.fixture
def project(user):
    """测试项目，包含版本号与发布规则"""
    project = Project.objects.create(
        code="RELEASE",
        name="发布测试项目",
        leader=user,
        status=1,
        version_rule={"prefix": "VA", "major": 1, "minor": 0, "patch": 0, "suffixes": {"rc": "rc", "beta": "alpha"}},
        release_rule={"formal_branch": "main", "release_cycle_days": 3},
    )
    ProjectMember.objects.create(project=project, user=user, role="manager")
    return project


@pytest.fixture
def credential(user, project):
    """测试凭证（项目级 GitLab Token）"""
    cred = Credential.objects.create(
        name="GitLab Token",
        cred_type="gitlab_token",
        auth_mode="token",
        owner=user,
        scope="project",
        project=project,
    )
    cred.set_data({"token": "glpat-test"})
    cred.save()
    return cred


@pytest.fixture
def repository(project, credential):
    """测试仓库"""
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="后端仓库",
        url="https://gitlab.example.com/release/backend.git",
        external_identity="release/backend",
        default_branch="develop",
        credential=credential,
        credential_mode="project",
    )


@pytest.fixture
def commit(repository, project):
    """测试提交记录"""
    return CommitRecord.objects.create(
        project=project,
        repository=repository,
        commit_hash="abc123def",
        author="张三",
        message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A 新增功能",
        committed_at="2026-06-20T10:00:00+08:00",
        branch="develop",
        parsed_message={"change_type": "无配置项改动", "updates": [{"type": "A", "content": "新增功能"}]},
        review_status="pass",
    )


@pytest.fixture
def mock_git_provider():
    """模拟的 GitProvider"""
    class MockProvider:
        def __init__(self):
            self.tags = []

        def list_tags(self, repo_identity: str):
            return self.tags

        def create_tag(self, repo_identity: str, tag_name: str, commit_hash: str, message: str = ""):
            from utils.provider.base import TagInfo
            self.tags.append(TagInfo(name=tag_name, commit_hash=commit_hash))
            return TagInfo(name=tag_name, commit_hash=commit_hash)

        def list_commits(self, repo_identity: str, branch: str, since=None, until=None, per_page=100):
            from datetime import datetime, timezone as tz
            from utils.provider.base import CommitInfo
            return [
                CommitInfo(
                    hash="targethead001",
                    author="张三",
                    author_email="",
                    message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A 新增功能",
                    committed_at=datetime(2026, 6, 20, 10, 0, 0, tzinfo=tz.utc),
                )
            ]

        def compare_commits(self, repo_identity: str, base: str, head: str):
            return self.list_commits(repo_identity, head)

        def list_merge_requests(self, repo_identity: str, target_branch: str, since=None):
            return []

    return MockProvider()
