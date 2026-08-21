"""
账号模块视图测试

覆盖本地用户登录、密码错误场景以及已认证用户信息获取。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User


@pytest.mark.django_db
def test_local_user_login():
    """
    测试本地用户登录成功并返回 JWT Token

    期望：HTTP 200，响应 code 为 0，data 中包含 access_token
    """
    User.objects.create_user(
        username="testuser",
        password="testpass123",
        source="local",
        is_active=True,
    )
    client = APIClient()
    response = client.post("/api/auth/login/", {
        "username": "testuser",
        "password": "testpass123",
    })
    assert response.status_code == 200
    assert response.data["code"] == 0
    assert "access_token" in response.data["data"]


@pytest.mark.django_db
def test_login_wrong_password():
    """
    测试使用错误密码登录失败

    期望：HTTP 401，响应 code 为 40100
    """
    User.objects.create_user(
        username="testuser",
        password="testpass123",
        source="local",
        is_active=True,
    )
    client = APIClient()
    response = client.post("/api/auth/login/", {
        "username": "testuser",
        "password": "wrongpass",
    })
    assert response.status_code == 401
    assert response.data["code"] == 40100


@pytest.mark.django_db
def test_user_info():
    """
    测试获取当前登录用户信息

    期望：HTTP 200，返回的用户名与登录用户一致
    """
    user = User.objects.create_user(
        username="testuser",
        password="testpass123",
        source="local",
        is_active=True,
    )
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/auth/user-info/")
    assert response.status_code == 200
    assert response.data["data"]["username"] == "testuser"


def _make_user(username: str, **kwargs) -> User:
    """创建测试用户"""
    return User.objects.create_user(
        username=username,
        password="testpass123",
        source="local",
        is_active=True,
        **kwargs,
    )


@pytest.mark.django_db
def test_user_list_open_to_all_users():
    """
    测试人员查询全员可用：普通用户可列出全部用户，但仅返回精简字段

    期望：HTTP 200，列表包含其他用户，且不包含邮箱等敏感字段
    """
    _make_user("picker_target", nickname="目标用户", email="target@example.com")
    viewer = _make_user("picker_viewer")
    client = APIClient()
    client.force_authenticate(user=viewer)
    response = client.get("/api/account/users/")
    assert response.status_code == 200
    results = response.data["data"]["results"]
    assert len(results) == 2
    target = next(u for u in results if u["username"] == "picker_target")
    assert target["nickname"] == "目标用户"
    assert "email" not in target
    assert "is_superuser" not in target


@pytest.mark.django_db
def test_user_retrieve_self_returns_full_fields():
    """
    测试普通用户查看自己详情仍返回完整字段

    期望：HTTP 200，包含 email 字段
    """
    user = _make_user("self_viewer", email="self@example.com")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get(f"/api/account/users/{user.id}/")
    assert response.status_code == 200
    assert response.data["data"]["email"] == "self@example.com"


@pytest.mark.django_db
def test_user_retrieve_other_returns_brief_fields():
    """
    测试普通用户查看他人详情仅返回精简字段

    期望：HTTP 200，不包含 email 字段
    """
    other = _make_user("other_user", email="other@example.com")
    viewer = _make_user("brief_viewer")
    client = APIClient()
    client.force_authenticate(user=viewer)
    response = client.get(f"/api/account/users/{other.id}/")
    assert response.status_code == 200
    assert "email" not in response.data["data"]


@pytest.mark.django_db
def test_user_update_other_forbidden():
    """
    测试普通用户不能修改他人信息

    期望：HTTP 404（写操作查询集仅包含自己）
    """
    other = _make_user("update_target")
    viewer = _make_user("update_viewer")
    client = APIClient()
    client.force_authenticate(user=viewer)
    response = client.patch(f"/api/account/users/{other.id}/", {"nickname": "篡改"})
    assert response.status_code == 404


@pytest.mark.django_db
def test_user_update_self_cannot_escalate_privileges():
    """
    测试普通用户修改自己时管理字段被忽略，无法提权

    期望：HTTP 200，但 is_superuser/role_ids 等字段不生效
    """
    user = _make_user("escalate_user")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.patch(f"/api/account/users/{user.id}/", {
        "nickname": "新昵称",
        "is_superuser": True,
        "is_active": False,
    })
    assert response.status_code == 200
    user.refresh_from_db()
    assert user.nickname == "新昵称"
    assert user.is_superuser is False
    assert user.is_active is True


def _menu_ids(response) -> set:
    """提取菜单响应中的全部菜单 id（含子菜单）"""
    ids = set()
    for menu in response.data["data"]:
        ids.add(menu["id"])
        for child in menu.get("children", []):
            ids.add(child["id"])
    return ids


@pytest.mark.django_db
def test_menus_project_member_sees_business_menus():
    """
    测试项目成员即使没有任何系统角色，也能看到全部业务菜单

    期望：项目/仓库/发布/工作流/提交审查/打包菜单可见，凭证与系统管理子菜单不可见
    """
    from apps.project.models import Project, ProjectMember

    leader = _make_user("menu_leader")
    member = _make_user("menu_member")
    project = Project.objects.create(code="MENU", name="菜单项目", leader=leader)
    ProjectMember.objects.create(project=project, user=member, role="developer")

    client = APIClient()
    client.force_authenticate(user=member)
    response = client.get("/api/auth/menus/")

    assert response.status_code == 200
    ids = _menu_ids(response)
    assert {"projects", "repositories", "releases", "workflows", "commits", "packages"} <= ids
    assert "credentials" not in ids
    # 系统管理各子菜单均需要对应的 system.* 权限，项目成员无系统权限时全部不可见，
    # 且父级"系统管理"菜单也因无可见子菜单而隐藏
    assert "system" not in ids
    assert not {"system_users", "system_roles", "system_configs", "system_package_images", "system_logs"} & ids


@pytest.mark.django_db
def test_menus_granular_system_permissions():
    """
    测试系统管理权限拆分后，仅拥有对应 system.* 权限的子菜单可见

    期望：拥有 system.user + system.package_image 的用户仅看到用户管理与打包镜像，
    看不到角色管理/系统配置/操作日志
    """
    from apps.account.models import Permission, Role, UserRole

    perm_user = Permission.objects.get(code="system.user")
    perm_image = Permission.objects.get(code="system.package_image")
    role = Role.objects.create(name="镜像管理员", code="image_mgr")
    role.permissions.add(perm_user, perm_image)

    user = _make_user("granular_user")
    UserRole.objects.create(user=user, role=role)

    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/auth/menus/")

    assert response.status_code == 200
    ids = _menu_ids(response)
    assert "system" in ids
    assert {"system_users", "system_package_images"} <= ids
    assert not {"system_roles", "system_configs", "system_logs"} & ids


@pytest.mark.django_db
def test_menus_non_member_without_role_sees_no_business_menus():
    """
    测试无系统角色且未加入任何项目的用户看不到业务菜单

    期望：仅保留无需权限的菜单（工作台/通知/指南/反馈）
    """
    user = _make_user("menu_isolated")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/auth/menus/")

    assert response.status_code == 200
    ids = _menu_ids(response)
    assert {"dashboard", "notifications", "guide", "feedback"} <= ids
    assert "projects" not in ids
    assert "repositories" not in ids


def _grant_system_permission(user, code):
    """为用户授予指定 system.* 权限（通过临时角色绑定）"""
    from apps.account.models import Permission, Role, UserRole
    perm = Permission.objects.get(code=code)
    role = Role.objects.create(name=f"role_{code}_{user.username}", code=f"role_{code}_{user.username}")
    role.permissions.add(perm)
    UserRole.objects.create(user=user, role=role)
    return role


@pytest.mark.django_db
def test_user_create_requires_permission():
    """
    测试无 system.user 权限的普通用户不能创建用户

    期望：HTTP 403
    """
    viewer = _make_user("create_viewer")
    client = APIClient()
    client.force_authenticate(user=viewer)
    response = client.post("/api/account/users/", {
        "username": "new_user",
        "password": "pass1234",
        "nickname": "新用户",
    })
    assert response.status_code == 403


@pytest.mark.django_db
def test_system_user_holder_can_create_user():
    """
    测试拥有 system.user 权限的普通用户可以创建用户

    期望：HTTP 201，用户创建成功
    """
    manager = _make_user("user_mgr")
    _grant_system_permission(manager, "system.user")
    client = APIClient()
    client.force_authenticate(user=manager)
    response = client.post("/api/account/users/", {
        "username": "new_user",
        "password": "pass1234",
        "nickname": "新用户",
        "is_active": True,
        "role_ids": [],
    })
    assert response.status_code == 200
    assert response.data["code"] == 0


@pytest.mark.django_db
def test_non_superuser_cannot_create_superuser_user():
    """
    测试拥有 system.user 权限的普通用户创建用户时不能设置 is_superuser

    期望：HTTP 201，但创建出的用户 is_superuser 为 False，防止提权
    """
    manager = _make_user("escalate_mgr")
    _grant_system_permission(manager, "system.user")
    client = APIClient()
    client.force_authenticate(user=manager)
    response = client.post("/api/account/users/", {
        "username": "backdoor",
        "password": "pass1234",
        "nickname": "后门",
        "is_superuser": True,
        "is_active": True,
        "role_ids": [],
    })
    assert response.status_code == 200
    assert response.data["code"] == 0
    created = User.objects.get(username="backdoor")
    assert created.is_superuser is False


@pytest.mark.django_db
def test_user_info_returns_permissions():
    """
    测试用户信息接口返回 permissions 权限编码列表

    期望：拥有 system.user 权限的用户，permissions 中包含 system.user
    """
    user = _make_user("perm_user")
    _grant_system_permission(user, "system.user")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/auth/user-info/")
    assert response.status_code == 200
    assert "system.user" in response.data["data"]["permissions"]
