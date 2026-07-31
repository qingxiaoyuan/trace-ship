"""
项目权限测试

覆盖项目成员的权限控制。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import Permission, Role, User, UserRole
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
def test_create_project_requires_project_create_permission(outsider):
    """
    无 project.create 权限的用户不能创建项目

    期望：HTTP 403，响应 message 提示无权限
    """
    response = auth_client(outsider).post("/api/projects/", {
        "code": "NEW1",
        "name": "新项目",
        "leader_id": str(outsider.id),
        "status": 1,
    })

    assert response.status_code == 403
    assert response.data["code"] == 40300
    assert response.data["message"]


@pytest.mark.django_db
def test_create_project_with_project_create_permission(outsider):
    """
    绑定含 project.create 权限角色的用户可创建项目（覆盖 LDAP 用户场景）

    期望：HTTP 201，创建成功
    """
    permission = Permission.objects.create(name="创建项目", code="project.create", module="project")
    role = Role.objects.create(name="项目创建者", code="project_creator")
    role.permissions.add(permission)
    UserRole.objects.create(user=outsider, role=role)

    response = auth_client(outsider).post("/api/projects/", {
        "code": "NEW2",
        "name": "新项目",
        "leader_id": str(outsider.id),
        "status": 1,
    })

    assert response.status_code == 201
    assert response.data["code"] == 0


@pytest.mark.django_db
def test_create_project_superuser_allowed():
    """
    超管无需绑定角色即可创建项目

    期望：HTTP 201，创建成功
    """
    admin = User.objects.create_superuser(username="admin", password="pass")
    response = auth_client(admin).post("/api/projects/", {
        "code": "NEW3",
        "name": "新项目",
        "leader_id": str(admin.id),
        "status": 1,
    })

    assert response.status_code == 201
    assert response.data["code"] == 0
