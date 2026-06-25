"""
项目权限测试

覆盖项目成员的权限控制。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
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
