"""
EKP OA 单点登录测试

覆盖验票成功自动开通用户、LDAP 资料回填与降级、重复 SSO 复用用户、
token 失效/过期、SSO 未启用、验票服务不可用等场景
（mock OA 验票请求与 LDAP 查询，不依赖真实外部服务）。
"""
from unittest import mock

import pytest
import requests
from rest_framework.test import APIClient

from apps.account.models import Role, User
from apps.system.models import SystemConfig

VERIFY_URL = "http://oa.example.com/api/v1/sso/traceship/verify-token"
SSO_URL = "/api/auth/sso/login/"


def _success_payload(user_id: str = "TH2005070101", user_name: str = "张三") -> dict:
    """构造验票成功响应体"""
    return {
        "code": 0,
        "data": {
            "result": 100,
            "message": "验证成功",
            "userDetail": {"userId": user_id, "userName": user_name, "email": "", "department": ""},
        },
        "msg": "验证成功",
    }


def _fail_payload(result: int, message: str) -> dict:
    """构造验票失败响应体"""
    return {"code": -1, "data": {"result": result, "message": message}, "msg": message}


def _mock_verify(payload: dict):
    """构造 requests.post 的 mock 返回值"""
    resp = mock.Mock()
    resp.json.return_value = payload
    return mock.Mock(return_value=resp)


@pytest.fixture(autouse=True)
def sso_config(db):
    """每个用例写入 SSO 配置并在结束后清理"""
    SystemConfig.objects.update_or_create(
        key="sso_verify_url", defaults={"value": VERIFY_URL}
    )
    SystemConfig.objects.update_or_create(
        key="sso_enabled", defaults={"value": "true"}
    )
    yield
    SystemConfig.objects.filter(key__startswith="sso_").delete()


@pytest.fixture
def developer_role(db):
    """内置开发人员角色"""
    return Role.objects.create(name="开发人员", code="developer")


@pytest.mark.django_db
def test_sso_login_success_creates_user(developer_role):
    """
    测试首次 SSO 登录自动开通用户并返回双 Token

    期望：HTTP 200；用户名按小写落库；昵称取 OA 返回姓名；默认赋开发人员角色
    """
    with (
        mock.patch("apps.account.sso.requests.post", _mock_verify(_success_payload())),
        mock.patch("apps.account.ldap_config.search_ldap_user", return_value=None),
    ):
        response = APIClient().post(SSO_URL, {"token": "sso_ts_xxx"})

    assert response.status_code == 200
    assert response.data["code"] == 0
    assert "access_token" in response.data["data"]
    assert "refresh_token" in response.data["data"]

    user = User.objects.get(username="th2005070101")
    assert user.nickname == "张三"
    assert user.source == "ldap"
    assert user.user_roles.filter(role__code="developer").exists()


@pytest.mark.django_db
def test_sso_login_ldap_backfill(developer_role):
    """
    测试 LDAP 查到属性时昵称/部门/邮箱以 LDAP 为准

    期望：cn 按 <部门>姓名 拆分，邮箱取 LDAP mail
    """
    ldap_attrs = {"cn": "<研发部>李四", "mail": "lisi@example.com"}
    with (
        mock.patch("apps.account.sso.requests.post", _mock_verify(_success_payload())),
        mock.patch("apps.account.ldap_config.search_ldap_user", return_value=ldap_attrs),
    ):
        response = APIClient().post(SSO_URL, {"token": "sso_ts_xxx"})

    assert response.status_code == 200
    user = User.objects.get(username="th2005070101")
    assert user.nickname == "李四"
    assert user.department == "研发部"
    assert user.email == "lisi@example.com"


@pytest.mark.django_db
def test_sso_login_reuses_existing_user(developer_role):
    """
    测试同一用户再次 SSO 复用已有用户（不重复建，大小写差异也不产生新用户）

    期望：用户总数不变
    """
    User.objects.create_user(username="th2005070101", source="ldap")
    with (
        mock.patch("apps.account.sso.requests.post", _mock_verify(_success_payload())),
        mock.patch("apps.account.ldap_config.search_ldap_user", return_value=None),
    ):
        response = APIClient().post(SSO_URL, {"token": "sso_ts_yyy"})

    assert response.status_code == 200
    assert User.objects.filter(username__iexact="TH2005070101").count() == 1


@pytest.mark.django_db
def test_sso_login_token_used():
    """
    测试 token 已使用时返回 401 并透传 OA 错误信息

    期望：HTTP 401，message 为「token不存在或已使用」
    """
    payload = _fail_payload(101, "token不存在或已使用")
    with mock.patch("apps.account.sso.requests.post", _mock_verify(payload)):
        response = APIClient().post(SSO_URL, {"token": "sso_ts_used"})

    assert response.status_code == 401
    assert response.data["code"] == 40100
    assert "token不存在或已使用" in response.data["message"]


@pytest.mark.django_db
def test_sso_login_token_expired():
    """
    测试 token 过期时返回 401 并透传 OA 错误信息

    期望：HTTP 401，message 为「token已过期」
    """
    payload = _fail_payload(102, "token已过期")
    with mock.patch("apps.account.sso.requests.post", _mock_verify(payload)):
        response = APIClient().post(SSO_URL, {"token": "sso_ts_expired"})

    assert response.status_code == 401
    assert "token已过期" in response.data["message"]


@pytest.mark.django_db
def test_sso_login_disabled():
    """
    测试页面显式关闭 SSO 时返回 401

    期望：HTTP 401，提示 SSO 未启用
    """
    SystemConfig.objects.update_or_create(key="sso_enabled", defaults={"value": "false"})
    response = APIClient().post(SSO_URL, {"token": "sso_ts_xxx"})

    assert response.status_code == 401
    assert "未启用" in response.data["message"]


@pytest.mark.django_db
def test_sso_login_verify_service_unavailable():
    """
    测试验票服务网络异常时返回 401

    期望：HTTP 401，提示验票服务不可用
    """
    with mock.patch(
        "apps.account.sso.requests.post",
        side_effect=requests.ConnectionError("connection refused"),
    ):
        response = APIClient().post(SSO_URL, {"token": "sso_ts_xxx"})

    assert response.status_code == 401
    assert "验票服务不可用" in response.data["message"]


@pytest.mark.django_db
def test_sso_login_local_account_rejected(developer_role):
    """
    测试 SSO 不允许接管同名本地账号

    期望：HTTP 401，本地账号 source/资料不被改写
    """
    User.objects.create_user(
        username="th2005070101", password="localpass123", source="local", nickname="本地运维"
    )
    with (
        mock.patch("apps.account.sso.requests.post", _mock_verify(_success_payload())),
        mock.patch("apps.account.ldap_config.search_ldap_user", return_value=None),
    ):
        response = APIClient().post(SSO_URL, {"token": "sso_ts_xxx"})

    assert response.status_code == 401
    assert "本地账号" in response.data["message"]
    user = User.objects.get(username="th2005070101")
    assert user.source == "local"
    assert user.nickname == "本地运维"


@pytest.mark.django_db
def test_sso_login_inactive_user_rejected(developer_role):
    """
    测试停用账号 SSO 登录被拒绝且资料不被更新

    期望：HTTP 401 提示账号已停用，nickname/last_login 保持原值
    """
    User.objects.create_user(
        username="th2005070101", source="ldap", nickname="旧昵称", is_active=False
    )
    with (
        mock.patch("apps.account.sso.requests.post", _mock_verify(_success_payload())),
        mock.patch("apps.account.ldap_config.search_ldap_user", return_value=None),
    ):
        response = APIClient().post(SSO_URL, {"token": "sso_ts_xxx"})

    assert response.status_code == 401
    assert "账号已停用" in response.data["message"]
    user = User.objects.get(username="th2005070101")
    assert user.nickname == "旧昵称"
    assert user.last_login is None


@pytest.mark.django_db
def test_sso_login_missing_token():
    """
    测试缺少 token 参数时返回参数校验错误

    期望：HTTP 400
    """
    response = APIClient().post(SSO_URL, {})
    assert response.status_code == 400
