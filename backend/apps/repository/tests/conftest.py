"""
仓库模块测试夹具

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
        username="testuser",
        password="testpass",
        nickname="测试用户",
    )


@pytest.fixture
def project(user):
    """测试项目，用户为项目管理员"""
    project = Project.objects.create(
        code="TEST",
        name="测试项目",
        leader=user,
        status=1,
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
    )
    cred.set_data({"token": "glpat-test"})
    cred.save()
    return cred


@pytest.fixture
def repository(project, credential):
    """测试仓库，并补齐原产品下的启用关联。"""
    from apps.project.services import ensure_repository_component

    repo = Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="后端仓库",
        url="https://gitlab.example.com/test/backend.git",
        external_identity="test/backend",
        default_branch="develop",
        credential=credential,
        credential_mode="project",
        health_status="unknown",
        created_by=project.leader,
    )
    ensure_repository_component(repo, project)
    return repo


@pytest.fixture
def commit(repository, project):
    """测试提交记录"""
    return CommitRecord.objects.create(
        project=project,
        repository=repository,
        commit_hash="abc123",
        author="张三",
        message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A xxx",
        committed_at="2026-06-20T10:00:00+08:00",
        branch="develop",
        parsed_message={"change_type": "无配置项改动", "updates": [{"type": "A", "content": "xxx"}]},
        review_status="pass",
    )
