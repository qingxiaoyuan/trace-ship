from apps.credential.models import Credential
from django.utils import timezone

from .exceptions import ProviderError


VENDOR_TO_CRED_TYPE = {
    "gitlab": "gitlab_token",
    "gitea": "gitea_token",
    "github": "github_token",
    "gitee": "gitee_token",
    "svn": "svn_password",
    "jenkins": "jenkins_token",
}


def _get_matching_credentials(queryset):
    """从 queryset 中取出第一个启用的凭证"""
    return queryset.filter(is_active=True).first()


def resolve_credential(source, request_user=None) -> dict:
    """
    根据 source 的 credential_mode 解析出实际凭证数据。

    source 需具备属性：credential_mode, credential, specified_user, vendor
    返回解密后的 dict，例如 {"token": "xxx"} 或 {"username": "x", "password": "y"}。
    """
    mode = source.credential_mode
    vendor = source.vendor
    expected_cred_type = VENDOR_TO_CRED_TYPE.get(vendor)

    credential = None

    if mode == "fixed":
        credential = source.credential
    elif mode == "global":
        qs = Credential.objects.filter(is_global=True, is_active=True)
        if expected_cred_type:
            qs = qs.filter(cred_type=expected_cred_type)
        credential = qs.first()
    elif mode == "current_user":
        if request_user is None:
            raise ProviderError("current_user 凭证模式需要提供当前用户")
        qs = Credential.objects.filter(owner=request_user, is_active=True)
        if expected_cred_type:
            qs = qs.filter(cred_type=expected_cred_type)
        credential = qs.first()
    elif mode == "specified_user":
        specified_user = getattr(source, "specified_user", None)
        if specified_user is None:
            raise ProviderError("specified_user 凭证模式未指定用户")
        qs = Credential.objects.filter(owner=specified_user, is_active=True)
        if expected_cred_type:
            qs = qs.filter(cred_type=expected_cred_type)
        credential = qs.first()
    else:
        raise ProviderError(f"不支持的凭证模式: {mode}")

    if not credential:
        raise ProviderError("未找到可用的凭证")

    # 更新最后使用时间
    credential.last_used_at = timezone.now()
    credential.save(update_fields=["last_used_at"])

    return credential.get_data()
