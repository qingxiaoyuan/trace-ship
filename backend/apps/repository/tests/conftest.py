import pytest

from apps.account.models import User
from apps.credential.models import Credential
from apps.project.models import Project, ProjectMember
from apps.repository.models import CommitRecord, Repository


@pytest.fixture
def user():
    return User.objects.create_user(
        username="testuser",
        password="testpass",
        nickname="测试用户",
    )


@pytest.fixture
def project(user):
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
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="后端仓库",
        url="https://gitlab.example.com/test/backend.git",
        external_identity="test/backend",
        default_branch="develop",
        credential=credential,
        credential_mode="fixed",
        health_status="unknown",
    )


@pytest.fixture
def commit(repository, project):
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
