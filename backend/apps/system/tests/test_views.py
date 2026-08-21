"""
系统管理视图权限测试

验证 system.config / system.log 权限拆分后的访问控制：
- 无权限用户 403
- 拥有对应权限的普通用户可访问
- 超管自动放行
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import Permission, Role, User, UserRole


def _make_user(username: str, **kwargs) -> User:
    return User.objects.create_user(
        username=username,
        password="testpass123",
        source="local",
        is_active=True,
        **kwargs,
    )


def _grant_permission(user: User, code: str) -> Role:
    """为用户授予指定权限（通过临时角色绑定）"""
    perm = Permission.objects.get(code=code)
    role = Role.objects.create(name=f"role_{code}_{user.username}", code=f"role_{code}_{user.username}")
    role.permissions.add(perm)
    UserRole.objects.create(user=user, role=role)
    return role


@pytest.mark.django_db
def test_config_requires_permission():
    """无 system.config 权限的普通用户访问系统配置返回 403"""
    user = _make_user("config_viewer")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/system/configs/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_config_accessible_by_permission_holder():
    """拥有 system.config 权限的普通用户可访问系统配置"""
    user = _make_user("config_mgr")
    _grant_permission(user, "system.config")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/system/configs/")
    assert response.status_code == 200


@pytest.mark.django_db
def test_config_accessible_by_superuser():
    """超管可访问系统配置"""
    admin = User.objects.create_superuser(username="config_admin", password="pass")
    client = APIClient()
    client.force_authenticate(user=admin)
    response = client.get("/api/system/configs/")
    assert response.status_code == 200


@pytest.mark.django_db
def test_log_requires_permission():
    """无 system.log 权限的普通用户访问操作日志返回 403"""
    user = _make_user("log_viewer")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/system/logs/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_log_accessible_by_permission_holder():
    """拥有 system.log 权限的普通用户可访问操作日志"""
    user = _make_user("log_mgr")
    _grant_permission(user, "system.log")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/system/logs/")
    assert response.status_code == 200


@pytest.mark.django_db
def test_public_configs_accessible_by_any_authenticated_user():
    """公开配置接口任意登录用户可读，仅返回 is_public=True 的配置"""
    from apps.system.models import SystemConfig

    SystemConfig.objects.create(key="review_doc_highlight_keywords", value="数据库\n接口变更", is_public=True)
    SystemConfig.objects.create(key="nexus_password", value="secret123", is_public=False)

    user = _make_user("public_reader")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/system/configs/public/")

    assert response.status_code == 200
    assert response.data["code"] == 0
    assert response.data["data"] == {"review_doc_highlight_keywords": "数据库\n接口变更"}


@pytest.mark.django_db
def test_public_configs_exclude_sensitive_keys_even_if_marked_public():
    """敏感键（password/token/secret 等）即使被误标为公开也不会从公开接口泄露"""
    from apps.system.models import SystemConfig

    SystemConfig.objects.create(key="nexus_password", value="secret123", is_public=True)
    SystemConfig.objects.create(key="ai_api_key", value="sk-test", is_public=True)
    SystemConfig.objects.create(key="review_doc_highlight_keywords", value="数据库", is_public=True)

    user = _make_user("public_reader2")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/system/configs/public/")

    assert response.status_code == 200
    assert response.data["data"] == {"review_doc_highlight_keywords": "数据库"}


@pytest.mark.django_db
def test_public_configs_requires_authentication():
    """未登录访问公开配置接口返回 401/403"""
    client = APIClient()
    response = client.get("/api/system/configs/public/")
    assert response.status_code in (401, 403)
