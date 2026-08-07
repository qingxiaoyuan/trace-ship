"""
系统管理视图权限测试

验证 system.config / system.log 权限拆分后的访问控制：
- 无权限用户 403
- 拥有对应权限的普通用户可访问
- 超管自动放行
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User, Role, UserRole, Permission


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
