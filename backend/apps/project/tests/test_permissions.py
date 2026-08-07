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
def software_admin():
    """软件管理员用户（项目内拥有全部操作权限）"""
    return User.objects.create_user(username="sw_admin", password="pass")


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
def test_leader_without_membership_can_manage_members(manager):
    """
    项目负责人（leader）即使没有成员记录，也视同 manager 可管理成员
    """
    project = Project.objects.create(code="LEAD", name="Leader 项目", leader=manager)
    new_user = User.objects.create_user(username="lead_new", password="pass")

    list_response = auth_client(manager).get(f"/api/projects/{project.id}/members/")
    assert list_response.status_code == 200

    add_response = auth_client(manager).post(f"/api/projects/{project.id}/members/", {
        "user_ids": [str(new_user.id)],
        "role": "developer",
    }, format="json")
    assert add_response.status_code == 201


@pytest.mark.django_db
def test_leader_without_membership_sees_project_in_list(manager):
    """
    项目负责人（leader）即使没有成员记录，项目列表也可见
    """
    Project.objects.create(code="LEAD2", name="Leader 可见项目", leader=manager)

    response = auth_client(manager).get("/api/projects/")

    assert response.status_code == 200
    names = [p["name"] for p in response.data["data"]["results"]]
    assert "Leader 可见项目" in names


@pytest.mark.django_db
def test_my_role_returns_manager_for_leader(manager):
    """
    项目详情 my_role 对 leader（无成员记录）返回 manager
    """
    project = Project.objects.create(code="LEAD3", name="Leader 角色项目", leader=manager)

    response = auth_client(manager).get(f"/api/projects/{project.id}/")

    assert response.status_code == 200
    assert response.data["data"]["my_role"] == "manager"


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


@pytest.mark.django_db
def test_software_admin_can_list_members(project, software_admin):
    """
    软件管理员作为项目成员可查看成员列表
    """
    ProjectMember.objects.create(project=project, user=software_admin, role="software_admin")

    response = auth_client(software_admin).get(f"/api/projects/{project.id}/members/")

    assert response.status_code == 200
    assert response.data["code"] == 0


@pytest.mark.django_db
def test_software_admin_can_batch_add_members(project, software_admin, outsider):
    """
    软件管理员可批量添加成员（写操作权限与项目管理员等同）
    """
    ProjectMember.objects.create(project=project, user=software_admin, role="software_admin")

    response = auth_client(software_admin).post(f"/api/projects/{project.id}/members/", {
        "user_ids": [str(outsider.id)],
        "role": "developer",
    }, format="json")

    assert response.status_code == 201
    assert response.data["code"] == 0
    assert ProjectMember.objects.filter(project=project, user=outsider, role="developer").exists()


@pytest.mark.django_db
def test_software_admin_can_update_member_role(project, software_admin, developer):
    """
    软件管理员可修改成员角色
    """
    ProjectMember.objects.create(project=project, user=software_admin, role="software_admin")
    member = ProjectMember.objects.get(project=project, user=developer)

    response = auth_client(software_admin).patch(
        f"/api/projects/{project.id}/members/{member.id}/",
        {"role": "tester"},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["code"] == 0
    member.refresh_from_db()
    assert member.role == "tester"


@pytest.mark.django_db
def test_update_member_role_with_patch_only_role(project, manager, developer):
    """
    回归测试：PATCH 仅提交 role 字段可成功更新成员角色

    历史问题：前端用 PUT 只发 {role}，后端序列化器 user_id 必填，
    全量校验失败被异常处理器统一返回“参数错误”。
    改用 PATCH 后走 partial 更新，跳过 user_id 必填校验。
    """
    member = ProjectMember.objects.get(project=project, user=developer)

    response = auth_client(manager).patch(
        f"/api/projects/{project.id}/members/{member.id}/",
        {"role": "auditor"},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["code"] == 0
    member.refresh_from_db()
    assert member.role == "auditor"


@pytest.mark.django_db
def test_software_admin_can_be_assigned_as_role(project, manager, outsider):
    """
    软件管理员角色可被项目管理员分配给成员
    """
    ProjectMember.objects.create(project=project, user=outsider, role="viewer")
    member = ProjectMember.objects.get(project=project, user=outsider)

    response = auth_client(manager).patch(
        f"/api/projects/{project.id}/members/{member.id}/",
        {"role": "software_admin"},
        format="json",
    )

    assert response.status_code == 200
    member.refresh_from_db()
    assert member.role == "software_admin"


@pytest.mark.django_db
def test_software_admin_my_role_returned(project, software_admin):
    """
    项目详情 my_role 对软件管理员返回 software_admin
    """
    ProjectMember.objects.create(project=project, user=software_admin, role="software_admin")

    response = auth_client(software_admin).get(f"/api/projects/{project.id}/")

    assert response.status_code == 200
    assert response.data["data"]["my_role"] == "software_admin"


def _grant_permission(user, code):
    """为用户授予指定权限（通过临时角色绑定，权限不存在时自动创建）"""
    perm, _ = Permission.objects.get_or_create(
        code=code,
        defaults={"name": code, "module": "release"},
    )
    role = Role.objects.create(name=f"role_{code}_{user.username}", code=f"role_{code}_{user.username}")
    role.permissions.add(perm)
    UserRole.objects.create(user=user, role=role)
    return role


@pytest.mark.django_db
def test_auditor_sees_all_projects(project, outsider):
    """
    审查员（拥有 release.audit 权限）可查看全部项目，包括非成员项目

    期望：项目列表包含非自己成员的项目
    """
    # outsider 获得 release.audit 权限，但不是任何项目成员
    _grant_permission(outsider, "release.audit")

    response = auth_client(outsider).get("/api/projects/")

    assert response.status_code == 200
    names = [p["name"] for p in response.data["data"]["results"]]
    assert "权限项目" in names


@pytest.mark.django_db
def test_auditor_can_view_non_member_project_detail(project, outsider):
    """
    审查员可查看非成员项目的详情

    期望：HTTP 200，不是 404
    """
    _grant_permission(outsider, "release.audit")

    response = auth_client(outsider).get(f"/api/projects/{project.id}/")

    assert response.status_code == 200
    assert response.data["data"]["name"] == "权限项目"


@pytest.mark.django_db
def test_non_auditor_only_sees_member_projects(project, outsider):
    """
    非审查员且非项目成员只能看到自己参与的项目

    期望：项目列表不包含非成员项目
    """
    response = auth_client(outsider).get("/api/projects/")

    assert response.status_code == 200
    names = [p["name"] for p in response.data["data"]["results"]]
    assert "权限项目" not in names
