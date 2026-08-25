"""
开放接口 Access Token 认证

供外部系统（服务端到服务端）调用 /api/open/ 下的只读接口使用。
认证方式：请求头携带 Authorization: Bearer <token>（token 由超管在
「系统 · 访问令牌」页面签发，形如 tsat_xxxx）。

该认证类不显式挂到全局 DEFAULT_AUTHENTICATION_CLASSES，只用于开放接口视图，
无 Authorization 头时返回 None，不影响 JWT 等现有认证方式。
"""
from django.contrib.auth.models import AnonymousUser
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from apps.system.models import AccessToken


class AccessTokenAuthentication(BaseAuthentication):
    """Bearer Access Token 认证，成功后 request.auth 为 AccessToken 实例"""

    def authenticate(self, request):
        """校验 Bearer token，通过返回 (AnonymousUser, access_token)，无头返回 None

        user 使用 AnonymousUser 而非 None：保证 request.user.is_authenticated
        语义完整，避免中间件等下游代码访问 None 崩溃。
        """
        header = request.headers.get("Authorization", "")
        if not header:
            return None
        parts = header.split()
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return None
        token = parts[1]

        access_token = AccessToken.objects.filter(token_hash=AccessToken.hash_token(token)).first()
        if access_token is None:
            raise AuthenticationFailed("访问令牌无效")
        if not access_token.is_active:
            raise AuthenticationFailed("访问令牌已被禁用")
        if access_token.is_expired:
            raise AuthenticationFailed("访问令牌已过期")

        # 记录最近使用时间与来源 IP（审计用，失败不影响认证）
        AccessToken.objects.filter(pk=access_token.pk).update(
            last_used_at=timezone.now(),
            last_used_ip=self._client_ip(request),
        )
        return (AnonymousUser(), access_token)

    def authenticate_header(self, request) -> str:
        """返回 WWW-Authenticate 头，保证认证失败响应为 401 而非 403

        DRF 在视图无法提供 authenticate 头时会把 401 降级为 403，
        实现此方法后 AuthenticationFailed / NotAuthenticated 保持 401。
        """
        return 'Bearer realm="api"'

    @staticmethod
    def _client_ip(request) -> str:
        """取客户端 IP：优先 X-Forwarded-For 首跳，兜底 REMOTE_ADDR"""
        forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.META.get("REMOTE_ADDR", "")
