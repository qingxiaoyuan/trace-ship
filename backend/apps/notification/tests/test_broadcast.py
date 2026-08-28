"""
系统通知发送接口测试

覆盖 POST /api/notifications/broadcast/：
全员广播、指定用户发送、权限拦截与参数校验。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import Permission, Role, RolePermission, User, UserRole
from apps.notification.models import Notification


@pytest.fixture
def admin():
    """超管用户"""
    return User.objects.create_superuser(username="sysadmin", password="pass", nickname="管理员")


@pytest.fixture
def admin_client(admin):
    """超管客户端"""
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def normal_user(db):
    """普通用户（无通知发送权限）"""
    return User.objects.create_user(username="normaluser", password="pass", nickname="普通用户")


@pytest.fixture
def normal_client(normal_user):
    """普通用户客户端"""
    client = APIClient()
    client.force_authenticate(user=normal_user)
    return client


def _create_active_user(username: str) -> User:
    """创建启用状态的普通用户"""
    return User.objects.create_user(username=username, password="pass", nickname=username)


@pytest.mark.django_db
def test_broadcast_to_all_users(admin_client, normal_user):
    """超管全员广播：全部启用用户各收到一条 system 通知"""
    _create_active_user("bcast_a")
    _create_active_user("bcast_b")

    resp = admin_client.post("/api/notifications/broadcast/", {
        "title": "系统维护通知",
        "content": "本周六凌晨停机维护",
        "scope": "all",
    }, format="json")

    assert resp.status_code == 200, resp.data
    expected = User.objects.filter(is_active=True).count()
    assert resp.data["data"]["count"] == expected
    assert Notification.objects.filter(
        notification_type="system", title="系统维护通知"
    ).count() == expected
    # 停用用户不接收
    disabled = _create_active_user("bcast_disabled")
    disabled.is_active = False
    disabled.save(update_fields=["is_active"])
    assert not Notification.objects.filter(user=disabled).exists()


@pytest.mark.django_db
def test_broadcast_to_selected_users(admin_client, normal_user):
    """指定用户发送：仅所选用户收到通知"""
    user_a = _create_active_user("bcast_sel_a")
    user_b = _create_active_user("bcast_sel_b")

    resp = admin_client.post("/api/notifications/broadcast/", {
        "title": "定向通知",
        "content": "仅发送给指定用户",
        "scope": "users",
        "user_ids": [str(user_a.id)],
    }, format="json")

    assert resp.status_code == 200, resp.data
    assert resp.data["data"]["count"] == 1
    assert Notification.objects.filter(user=user_a, notification_type="system").count() == 1
    assert not Notification.objects.filter(user=user_b).exists()


@pytest.mark.django_db
def test_broadcast_requires_permission(normal_client):
    """无 system.notification 权限的用户不能发送系统通知"""
    resp = normal_client.post("/api/notifications/broadcast/", {
        "title": "越权通知",
        "content": "应被拒绝",
        "scope": "all",
    }, format="json")

    assert resp.status_code == 403
    assert not Notification.objects.filter(notification_type="system").exists()


@pytest.mark.django_db
def test_broadcast_allowed_with_role_permission(normal_user, normal_client):
    """通过角色授予 system.notification 权限的普通用户可发送"""
    perm, _ = Permission.objects.get_or_create(
        code="system.notification",
        defaults={"name": "通知发送", "module": "system"},
    )
    role = Role.objects.create(code="notify_admin", name="通知管理员")
    RolePermission.objects.create(role=role, permission=perm)
    UserRole.objects.create(user=normal_user, role=role)

    resp = normal_client.post("/api/notifications/broadcast/", {
        "title": "角色授权通知",
        "content": "通过角色获得发送权限",
        "scope": "users",
        "user_ids": [str(normal_user.id)],
    }, format="json")

    assert resp.status_code == 200, resp.data
    assert resp.data["data"]["count"] == 1


@pytest.mark.django_db
def test_broadcast_validates_params(admin_client):
    """参数校验：标题/内容必填，scope=users 必须选择用户"""
    resp = admin_client.post("/api/notifications/broadcast/", {
        "title": "  ",
        "content": "内容",
        "scope": "all",
    }, format="json")
    assert resp.status_code == 400

    resp = admin_client.post("/api/notifications/broadcast/", {
        "title": "标题",
        "content": "内容",
        "scope": "users",
    }, format="json")
    assert resp.status_code == 400
