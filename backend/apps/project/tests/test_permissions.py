"""
项目权限测试

覆盖项目成员、外站绑定的权限控制以及 vendor 校验。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.credential.models import Credential
from apps.project.models import Project, ProjectMember


@pytest.fixture
def manager():
    """项目管理员用户"""
    return User.objects.create_user(username="manager", password="pass")


@pytest.fixture
def developer():
    """项目开发人员用户"""
    return User.objects.create_user(username="developer", password="pass")


@pytest.fixture
def outsider():
    """非项目成员用户"""
    return User.objects.create_user(username="outsider", password="pass")


@pytest.fixture
def project(manager, developer):
    """创建测试项目并添加管理员和开发人员"""
    project = Project.objects.create(code="PERM", name="权限项目", leader=manager)
    ProjectMember.objects.create(project=project, user=manager, role="manager")
    ProjectMember.objects.create(project=project, user=developer, role="developer")
    return project


def auth_client(user):
    """构造已认证客户端"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_project_manager_can_list_members(project, manager):
    """
    项目管理员可以查看成员列表
    """
    response = auth_client(manager).get(f"/api/projects/{project.id}/members/")

    assert response.status_code == 200


@pytest.mark.django_db
def test_project_developer_cannot_list_members(project, developer):
    """
    普通开发人员不能查看成员列表
    """
    response = auth_client(developer).get(f"/api/projects/{project.id}/members/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_non_member_cannot_list_integrations(project, outsider):
    """
    非项目成员不能查看外站绑定
    """
    response = auth_client(outsider).get(f"/api/projects/{project.id}/integrations/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_project_developer_cannot_create_integration(project, developer):
    """
    普通开发人员不能创建外站绑定
    """
    payload = {
        "integration_type": "git_repo",
        "vendor": "gitlab",
        "name": "GitLab",
        "external_identity": "group/repo",
        "config": {"server_url": "https://gitlab.example.com"},
        "credential_mode": "fixed",
        "is_active": True,
    }

    response = auth_client(developer).post(
        f"/api/projects/{project.id}/integrations/",
        payload,
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_manager_cannot_create_git_integration_with_svn_vendor(project, manager):
    """
    项目管理员创建 Git 集成时不能使用不支持的 SVN vendor
    """
    credential = Credential.objects.create(
        name="Token",
        cred_type="gitlab_token",
        auth_mode="token",
        owner=manager,
        scope="project",
        project=project,
    )
    credential.set_data({"token": "glpat-test"})
    credential.save()

    payload = {
        "integration_type": "git_repo",
        "vendor": "svn",
        "name": "Invalid",
        "external_identity": "group/repo",
        "config": {"server_url": "https://gitlab.example.com"},
        "credential": str(credential.id),
        "credential_mode": "fixed",
        "is_active": True,
    }

    response = auth_client(manager).post(
        f"/api/projects/{project.id}/integrations/",
        payload,
        format="json",
    )

    assert response.status_code == 400
    assert "vendor" in response.data["data"]
