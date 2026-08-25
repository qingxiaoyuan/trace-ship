"""
访问令牌管理与认证测试

覆盖：
- 管理接口（/api/system/access-tokens/）的超管权限与明文 token 仅创建时返回
- AccessTokenAuthentication 的失败场景（无头 / 错误 / 禁用 / 过期）
- HasAccessTokenScope 的 scope 授权与只读约束
"""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.account.models import User
from apps.system.models import AccessToken


def _make_token(scopes: list[str], **kwargs) -> tuple[AccessToken, str]:
    """创建令牌并返回 (实例, 明文 token)"""
    plain = AccessToken.generate_token()
    token = AccessToken(name="测试接入方", scopes=scopes, **kwargs)
    token.set_token(plain)
    token.save()
    return token, plain


def _auth_client(plain: str) -> APIClient:
    """携带 Bearer token 的测试客户端"""
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {plain}")
    return client


@pytest.mark.django_db
class TestAccessTokenManageApi:
    """令牌管理接口测试"""

    def test_superuser_can_create_and_see_plain_token_once(self):
        """超管创建令牌，响应一次性包含明文 token，列表不再返回"""
        admin = User.objects.create_superuser(username="token_admin", password="pass")
        client = APIClient()
        client.force_authenticate(user=admin)

        response = client.post(
            "/api/system/access-tokens/",
            {"name": "外部系统A", "scopes": ["release.doc"], "remark": "对接联调"},
            format="json",
        )
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["token"].startswith("tsat_")
        assert data["token_prefix"] == data["token"][:8]

        list_resp = client.get("/api/system/access-tokens/")
        assert list_resp.status_code == 200
        item = list_resp.json()["data"]["results"][0]
        assert "token" not in item
        assert item["token_prefix"] == data["token_prefix"]

    def test_non_superuser_forbidden(self):
        """普通用户访问令牌管理接口返回 403"""
        user = User.objects.create_user(username="normal_user", password="pass", source="local")
        client = APIClient()
        client.force_authenticate(user=user)
        assert client.get("/api/system/access-tokens/").status_code == 403
        assert client.post(
            "/api/system/access-tokens/",
            {"name": "x", "scopes": ["release.doc"]},
            format="json",
        ).status_code == 403

    def test_invalid_scope_rejected(self):
        """scopes 含未登记的接口编码时创建失败"""
        admin = User.objects.create_superuser(username="token_admin2", password="pass")
        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.post(
            "/api/system/access-tokens/",
            {"name": "外部系统B", "scopes": ["not.exist"]},
            format="json",
        )
        assert response.status_code == 400


@pytest.mark.django_db
class TestAccessTokenAuthentication:
    """开放接口认证与 scope 授权测试（以 /api/open/release-doc/ 为验证端点）"""

    URL = "/api/open/release-doc/"

    def test_missing_header_unauthorized(self):
        """无 Authorization 头返回 401"""
        assert APIClient().get(self.URL).status_code == 401

    def test_wrong_token_unauthorized(self):
        """错误 token 返回 401"""
        _make_token(["release.doc"])
        assert _auth_client("tsat_wrongtoken").get(self.URL).status_code == 401

    def test_disabled_token_unauthorized(self):
        """已禁用 token 返回 401"""
        _, plain = _make_token(["release.doc"], is_active=False)
        assert _auth_client(plain).get(self.URL).status_code == 401

    def test_expired_token_unauthorized(self):
        """已过期 token 返回 401"""
        _, plain = _make_token(
            ["release.doc"],
            expires_at=timezone.now() - timedelta(days=1),
        )
        assert _auth_client(plain).get(self.URL).status_code == 401

    def test_scope_mismatch_forbidden(self):
        """token 的 scopes 不含接口所需 scope 时返回 403"""
        _, plain = _make_token(["repo.compare"])
        assert _auth_client(plain).get(self.URL).status_code == 403

    def test_write_method_forbidden(self):
        """携带合法 token 调写方法返回 403（开放接口只读）"""
        _, plain = _make_token(["release.doc"])
        assert _auth_client(plain).post(self.URL, {}, format="json").status_code == 403

    def test_valid_token_passes_auth(self):
        """合法 token 通过认证与授权（业务层因缺参数返回 400 而非 401/403）"""
        _, plain = _make_token(["release.doc"])
        response = _auth_client(plain).get(self.URL)
        assert response.status_code == 400
