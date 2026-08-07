"""
LDAP 动态配置模块测试

覆盖配置解析优先级（页面配置 > 环境变量）、启用开关逻辑与测试连接的
成功/失败路径（通过注入 fake python-ldap 模块，不依赖真实 LDAP 服务）。
"""
import sys
from types import ModuleType
from unittest import mock

import pytest
from rest_framework.test import APIClient

from apps.account.ldap_config import (
    LdapConfigError,
    resolve_ldap_config,
    test_ldap_connection,
)
from apps.account.models import User
from apps.system.models import SystemConfig


def _set_config(key: str, value: str) -> None:
    """写入系统配置"""
    SystemConfig.objects.update_or_create(key=key, defaults={"value": value})


@pytest.fixture(autouse=True)
def clean_ldap_config():
    """每个用例前后清理 ldap_* 配置并清空相关环境变量"""
    SystemConfig.objects.filter(key__startswith="ldap_").delete()
    env_keys = [
        "LDAP_SERVER_URI", "LDAP_BIND_DN", "LDAP_BIND_PASSWORD",
        "LDAP_USER_SEARCH_BASE", "LDAP_USER_FILTER", "LDAP_TLS_REQCERT",
        "LDAP_CA_CERT_PATH",
    ]
    with mock.patch.dict("os.environ", {k: "" for k in env_keys}):
        yield
    SystemConfig.objects.filter(key__startswith="ldap_").delete()


def _make_fake_ldap(fail_bind: bool = False, empty_search: bool = False) -> ModuleType:
    """构造 fake python-ldap 模块"""
    fake = ModuleType("ldap")
    fake.SCOPE_SUBTREE = 2
    fake.SCOPE_BASE = 0
    fake.OPT_NETWORK_TIMEOUT = 1
    fake.OPT_TIMEOUT = 2
    fake.OPT_X_TLS_REQUIRE_CERT = 3
    fake.OPT_X_TLS_CACERTFILE = 4
    fake.OPT_X_TLS_DEMAND = 10
    fake.OPT_X_TLS_ALLOW = 11
    fake.OPT_X_TLS_NEVER = 12
    fake.OPT_X_TLS_TRY = 13

    class LDAPError(Exception):
        pass

    class INVALID_CREDENTIALS(LDAPError):
        pass

    class NO_SUCH_OBJECT(LDAPError):
        pass

    fake.LDAPError = LDAPError
    fake.INVALID_CREDENTIALS = INVALID_CREDENTIALS
    fake.NO_SUCH_OBJECT = NO_SUCH_OBJECT
    fake.set_option = lambda *args, **kwargs: None

    class FakeConn:
        def set_option(self, *args):
            pass

        def simple_bind_s(self, dn, password):
            if fail_bind:
                raise INVALID_CREDENTIALS("invalid credentials")

        def search_s(self, base, scope, *args, **kwargs):
            assert scope == fake.SCOPE_BASE
            if empty_search:
                return []
            return [("ou=users,dc=example,dc=com", {})]

        def unbind_s(self):
            pass

    fake.initialize = lambda uri: FakeConn()
    return fake


@pytest.mark.django_db
def test_resolve_disabled_without_any_config():
    """
    测试无任何配置时 LDAP 处于停用状态

    期望：enabled 为 False，各字段为空
    """
    cfg = resolve_ldap_config()
    assert cfg["enabled"] is False
    assert cfg["server_uri"] == ""
    assert cfg["user_search_base"] == ""


@pytest.mark.django_db
def test_resolve_env_fallback_enables_ldap():
    """
    测试环境变量配置完整时自动启用 LDAP

    期望：enabled 为 True，字段取自环境变量
    """
    with mock.patch.dict("os.environ", {
        "LDAP_SERVER_URI": "ldaps://ldap.example.com:636",
        "LDAP_USER_SEARCH_BASE": "ou=users,dc=example,dc=com",
        "LDAP_TLS_REQCERT": "never",
    }):
        cfg = resolve_ldap_config()
    assert cfg["enabled"] is True
    assert cfg["server_uri"] == "ldaps://ldap.example.com:636"
    assert cfg["tls_reqcert"] == "never"
    assert cfg["user_filter"] == "(uid=%(user)s)"


@pytest.mark.django_db
def test_resolve_page_config_overrides_env():
    """
    测试页面配置优先于环境变量

    期望：server_uri 取页面值，未在页面配置的字段仍回退环境变量
    """
    _set_config("ldap_server_uri", "ldaps://page-ldap:636")
    _set_config("ldap_user_search_base", "ou=page,dc=example,dc=com")
    _set_config("ldap_user_filter", "(sAMAccountName=%(user)s)")
    with mock.patch.dict("os.environ", {
        "LDAP_SERVER_URI": "ldap://env-ldap:389",
        "LDAP_BIND_DN": "cn=env,dc=example,dc=com",
    }):
        cfg = resolve_ldap_config()
    assert cfg["server_uri"] == "ldaps://page-ldap:636"
    assert cfg["bind_dn"] == "cn=env,dc=example,dc=com"
    assert cfg["user_filter"] == "(sAMAccountName=%(user)s)"


@pytest.mark.django_db
def test_resolve_page_disabled_overrides_env():
    """
    测试页面显式停用时即使环境变量完整也不启用

    期望：enabled 为 False
    """
    _set_config("ldap_enabled", "false")
    with mock.patch.dict("os.environ", {
        "LDAP_SERVER_URI": "ldaps://ldap.example.com:636",
        "LDAP_USER_SEARCH_BASE": "ou=users,dc=example,dc=com",
    }):
        cfg = resolve_ldap_config()
    assert cfg["enabled"] is False


@pytest.mark.django_db
def test_test_connection_success():
    """
    测试连接成功路径

    期望：返回成功提示，不抛异常
    """
    _set_config("ldap_server_uri", "ldaps://ldap.example.com:636")
    _set_config("ldap_user_search_base", "ou=users,dc=example,dc=com")
    fake = _make_fake_ldap()
    with mock.patch.dict(sys.modules, {"ldap": fake}):
        message = test_ldap_connection()
    assert "连接成功" in message


@pytest.mark.django_db
def test_test_connection_missing_config():
    """
    测试缺少服务地址时直接报错

    期望：抛出 LdapConfigError
    """
    with pytest.raises(LdapConfigError, match="服务地址"):
        test_ldap_connection()


@pytest.mark.django_db
def test_test_connection_invalid_credentials():
    """
    测试服务账号密码错误时返回友好提示

    期望：抛出 LdapConfigError 且提示绑定失败
    """
    _set_config("ldap_server_uri", "ldaps://ldap.example.com:636")
    _set_config("ldap_user_search_base", "ou=users,dc=example,dc=com")
    _set_config("ldap_bind_dn", "cn=svc,dc=example,dc=com")
    _set_config("ldap_bind_password", "wrong")
    fake = _make_fake_ldap(fail_bind=True)
    with mock.patch.dict(sys.modules, {"ldap": fake}):
        with pytest.raises(LdapConfigError, match="无法绑定"):
            test_ldap_connection()


@pytest.mark.django_db
def test_ldap_test_api_requires_superuser():
    """
    测试 LDAP 连接测试接口仅超管可用

    期望：普通用户返回 403
    """
    user = User.objects.create_user(username="ldap_api_user", password="pass12345", source="local", is_active=True)
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post("/api/system/configs/ldap-test/")
    assert response.status_code == 403


@pytest.mark.django_db
def test_ldap_test_api_with_fake_ldap():
    """
    测试超管调用连接测试接口成功

    期望：HTTP 200，code 为 0
    """
    _set_config("ldap_server_uri", "ldaps://ldap.example.com:636")
    _set_config("ldap_user_search_base", "ou=users,dc=example,dc=com")
    admin = User.objects.create_user(
        username="ldap_api_admin", password="pass12345", source="local", is_active=True, is_superuser=True
    )
    client = APIClient()
    client.force_authenticate(user=admin)
    fake = _make_fake_ldap()
    with mock.patch.dict(sys.modules, {"ldap": fake}):
        response = client.post("/api/system/configs/ldap-test/")
    assert response.status_code == 200
    assert response.data["code"] == 0


@pytest.mark.django_db
def test_parse_display_name_with_department():
    """
    测试 <部门>姓名 格式拆分

    期望：部门与姓名分别返回
    """
    from apps.account.ldap_config import parse_ldap_display_name

    assert parse_ldap_display_name("<研发部>张三") == ("研发部", "张三")
    assert parse_ldap_display_name("<信息办> 李四") == ("信息办", "李四")


@pytest.mark.django_db
def test_parse_display_name_without_department():
    """
    测试无部门前缀时原样返回姓名

    期望：部门为空字符串
    """
    from apps.account.ldap_config import parse_ldap_display_name

    assert parse_ldap_display_name("张三") == ("", "张三")
    assert parse_ldap_display_name("") == ("", "")
    assert parse_ldap_display_name("<研发部>") == ("", "<研发部>")


@pytest.mark.django_db
def test_ldap_first_login_assigns_developer_role():
    """
    测试 LDAP 首次登录自动赋予开发人员角色并拆分部门姓名

    期望：同步附加字段到 django-auth-ldap 落库的用户，绑定 developer 角色
    """
    from apps.account.models import Role, UserRole

    role = Role.objects.create(name="开发人员", code="developer")
    ldap_user = User.objects.create_user(
        username="ldap_new_user", password="", source="ldap", first_name="<研发部>张三", email="zs@example.com"
    )
    client = APIClient()
    with mock.patch("apps.account.ldap_config.authenticate_ldap", return_value=ldap_user):
        response = client.post("/api/auth/login/", {"username": "ldap_new_user", "password": "anypass"})
    assert response.status_code == 200
    assert response.data["code"] == 0
    user = User.objects.get(username="ldap_new_user")
    assert user.source == "ldap"
    assert user.nickname == "张三"
    assert user.department == "研发部"
    assert UserRole.objects.filter(user=user, role=role).exists()


@pytest.mark.django_db
def test_ldap_repeated_login_idempotent():
    """
    测试重复 LDAP 登录不会重复建用户、重复绑角色

    期望：两次登录后用户仅一条记录，角色仅一条关联
    """
    from apps.account.models import Role, UserRole

    Role.objects.create(name="开发人员", code="developer")
    ldap_user = User.objects.create_user(username="ldap_repeat", password="", source="ldap", first_name="李四")
    client = APIClient()
    with mock.patch("apps.account.ldap_config.authenticate_ldap", return_value=ldap_user):
        for _ in range(2):
            response = client.post("/api/auth/login/", {"username": "ldap_repeat", "password": "anypass"})
            assert response.status_code == 200
    assert User.objects.filter(username="ldap_repeat").count() == 1
    assert UserRole.objects.filter(user=ldap_user).count() == 1


@pytest.mark.django_db
def test_menus_package_image_requires_system_permission():
    """
    测试打包镜像菜单需要 system.package_image 权限，不再因 package 模块自动可见

    期望：仅有 package.trigger 权限的用户菜单中不包含任何系统管理子菜单
    （打包镜像菜单也属于系统管理，需要 system.package_image 权限）
    """
    from apps.account.models import Permission, Role, UserRole

    perm = Permission.objects.create(name="触发打包", code="package.trigger", module="package")
    role = Role.objects.create(name="开发人员", code="developer")
    role.permissions.add(perm)
    user = User.objects.create_user(username="menu_dev_user", password="pass12345", source="local", is_active=True)
    UserRole.objects.create(user=user, role=role)
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/auth/menus/")
    assert response.status_code == 200
    paths = []

    def collect(items):
        for item in items:
            paths.append(item["path"])
            collect(item.get("children", []))

    collect(response.data["data"])
    assert "/system/package-images" not in paths
    assert "/system/users" not in paths
    assert "/system/configs" not in paths
