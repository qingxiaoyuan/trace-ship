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
def test_project_developer_can_list_members(project, developer):
    """
    项目普通成员（开发人员）可以查看成员列表

    权限设计：读操作对项目全体成员开放，仅限制增删改
    """
    response = auth_client(developer).get(f"/api/projects/{project.id}/members/")

    assert response.status_code == 200
    assert response.data["code"] == 0


@pytest.mark.django_db
def test_outsider_cannot_list_members(project, outsider):
    """
    非项目成员不能查看成员列表
    """
    response = auth_client(outsider).get(f"/api/projects/{project.id}/members/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_project_developer_cannot_add_member(project, developer, outsider):
    """
    项目普通成员不能添加成员（写操作仅项目管理员）
    """
    response = auth_client(developer).post(f"/api/projects/{project.id}/members/", {
        "user": str(outsider.id),
        "role": "developer",
    })

    assert response.status_code == 403


@pytest.mark.django_db
def test_project_developer_cannot_remove_member(project, developer, manager):
    """
    项目普通成员不能移除成员（写操作仅项目管理员）
    """
    member = ProjectMember.objects.get(project=project, user=manager)
    response = auth_client(developer).delete(
        f"/api/projects/{project.id}/members/{member.id}/"
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_manager_can_batch_add_members(project, manager):
    """
    项目管理员可批量添加成员（user_ids），重复用户自动跳过
    """
    user_a = User.objects.create_user(username="batch_a", password="pass")
    user_b = User.objects.create_user(username="batch_b", password="pass")

    response = auth_client(manager).post(f"/api/projects/{project.id}/members/", {
        "user_ids": [str(user_a.id), str(user_b.id), str(manager.id)],
        "role": "developer",
    }, format="json")

    assert response.status_code == 201
    assert response.data["code"] == 0
    assert len(response.data["data"]["created"]) == 2
    assert response.data["data"]["skipped"] == 1
    assert ProjectMember.objects.filter(project=project, user=user_a, role="developer").exists()
    assert ProjectMember.objects.filter(project=project, user=user_b, role="developer").exists()


@pytest.mark.django_db
def test_batch_add_members_rejects_empty_list(project, manager):
    """
    批量添加成员时 user_ids 为空返回参数错误
    """
    response = auth_client(manager).post(f"/api/projects/{project.id}/members/", {
        "user_ids": [],
        "role": "developer",
    }, format="json")

    assert response.status_code == 400
    assert response.data["code"] == 40001


@pytest.mark.django_db
def test_batch_add_members_rejects_invalid_role(project, manager, outsider):
    """
    批量添加成员时角色非法返回参数错误
    """
    response = auth_client(manager).post(f"/api/projects/{project.id}/members/", {
        "user_ids": [str(outsider.id)],
        "role": "not_a_role",
    }, format="json")

    assert response.status_code == 400
    assert response.data["code"] == 40001


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
