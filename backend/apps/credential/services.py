"""
凭证业务服务

封装凭证的可见范围控制和删除前引用检查等业务规则。
"""
from django.db import models
from rest_framework import serializers

from apps.credential.models import Credential


class CredentialService:
    """
    Credential 业务规则服务

    被序列化器和视图共享，避免业务逻辑重复。
    """

    @staticmethod
    def queryset_for_user(user) -> models.QuerySet:
        """
        返回当前用户可见的凭证查询集

        规则：
        - 未登录：无数据
        - 超管：全部
        - 普通用户：自己的个人凭证 + 全系统共享的 SVN 凭证

        Args:
            user: 当前请求用户

        Returns:
            Credential QuerySet
        """
        queryset = Credential.objects.select_related("owner")
        if not user or not user.is_authenticated:
            return queryset.none()
        if user.is_superuser:
            return queryset.all()
        return queryset.filter(
            models.Q(owner=user)
            | models.Q(cred_type__in=Credential.SYSTEM_SHARED_CRED_TYPES)
        ).distinct()

    @staticmethod
    def ensure_can_delete(credential: Credential) -> None:
        """
        检查凭证是否可以删除

        若凭证已被仓库引用，则禁止删除。

        Args:
            credential: 待删除的 Credential 实例

        Raises:
            ValidationError: 存在引用时抛出
        """
        if credential.repositories.exists():
            raise serializers.ValidationError("凭证已被仓库引用，无法删除")
        if credential.repository_loans.exists():
            raise serializers.ValidationError("凭证已有借用记录，无法删除；请停用凭证或撤销借用")

    @staticmethod
    def test_credential(credential: Credential, server_url: str = "") -> dict:
        """
        按凭证类型执行真实的外部连接测试

        Args:
            credential: 待测试的 Credential 实例
            server_url: 可选的服务器地址（gitlab/svn 类型可在请求中显式指定）

        Returns:
            {"valid": bool, "detail": str, "cred_type": str}
        """
        handlers = {
            "gitlab_token": CredentialService._test_gitlab,
            "svn_password": CredentialService._test_svn,
            "ldap_password": CredentialService._test_ldap,
            "ai_api_key": CredentialService._test_ai_key,
        }
        handler = handlers.get(credential.cred_type)
        if not handler:
            # windows_password / ssh_password 依附于具体节点，无独立测试入口
            return {
                "valid": False,
                "detail": "该类型凭证依附于具体打包节点，请在「打包节点」页面测试节点连通性",
                "cred_type": credential.cred_type,
            }
        result = handler(credential, server_url=(server_url or "").strip())
        result["cred_type"] = credential.cred_type
        return result

    @staticmethod
    def _test_gitlab(credential: Credential, server_url: str = "") -> dict:
        """测试 GitLab Token：地址取请求参数，缺省回退到引用该凭证的仓库地址"""
        from utils.provider.exceptions import ProviderError
        from utils.provider.factory import get_provider

        resolved = server_url
        if not resolved:
            repo = credential.repositories.order_by("created_at").first()
            if repo:
                from apps.repository.services import RepositoryService

                resolved = RepositoryService.normalize_physical_identity(
                    repo.url, repo.external_identity
                )[0]
        if not resolved:
            return {
                "valid": False,
                "detail": "未指定 GitLab 服务器地址，且该凭证未被任何仓库引用；"
                "请在请求中携带 server_url，或在引用仓库的详情页执行连接测试",
            }
        try:
            provider = get_provider("gitlab", resolved, credential.get_data())
            provider.test_connection()
        except ProviderError as exc:
            return {"valid": False, "detail": str(exc)}
        except Exception as exc:
            return {"valid": False, "detail": f"连接异常: {exc}"}
        return {"valid": True, "detail": f"GitLab 连接成功（{resolved}）"}

    @staticmethod
    def _test_svn(credential: Credential, server_url: str = "") -> dict:
        """测试 SVN 凭证：必须显式指定仓库地址，否则引导到打包配置的 SVN 测试入口"""
        from utils.provider.exceptions import ProviderError
        from utils.provider.factory import get_provider

        if not server_url:
            return {
                "valid": False,
                "detail": "SVN 凭证需指定仓库地址才能测试；请在请求中携带 server_url，"
                "或在「打包配置」中使用 SVN 连接测试",
            }
        try:
            provider = get_provider("svn", server_url, credential.get_data())
            provider.test_connection()
        except ProviderError as exc:
            return {"valid": False, "detail": str(exc)}
        except Exception as exc:
            return {"valid": False, "detail": f"连接异常: {exc}"}
        return {"valid": True, "detail": f"SVN 连接成功（{server_url}）"}

    @staticmethod
    def _test_ldap(credential: Credential, server_url: str = "") -> dict:
        """测试 LDAP 凭证：用系统 LDAP 配置做绑定验证（不创建本地用户）"""
        from apps.account.ldap_config import LdapConfigError, verify_ldap_credential

        data = credential.get_data()
        username = data.get("username") or credential.username
        password = data.get("password", "")
        if not username or not password:
            return {"valid": False, "detail": "凭证缺少用户名或密码，无法测试"}
        try:
            message = verify_ldap_credential(username, password)
        except LdapConfigError as exc:
            return {"valid": False, "detail": str(exc)}
        return {"valid": True, "detail": message}

    @staticmethod
    def _test_ai_key(credential: Credential, server_url: str = "") -> dict:
        """测试 AI API Key：服务地址与模型取系统配置 ai_* 键，Key 取凭证本身"""
        from apps.package.ai import AI_CONFIG_KEYS, DEFAULT_AI_MODEL, DEFAULT_AI_PROTOCOL
        from apps.system.services import SystemConfigService
        from utils.provider.ai import AIClientError, call_ai_chat

        values = SystemConfigService.get_many(AI_CONFIG_KEYS)
        endpoint = (values.get("ai_endpoint") or "").strip()
        if not endpoint:
            return {
                "valid": False,
                "detail": "系统未配置 AI 服务地址（ai_endpoint），请先在「系统配置」页面维护",
            }
        api_key = credential.get_data().get("token", "")
        if not api_key:
            return {"valid": False, "detail": "凭证缺少 API Key，无法测试"}
        model = (values.get("ai_model") or "").strip() or DEFAULT_AI_MODEL
        protocol = (values.get("ai_protocol") or "").strip() or DEFAULT_AI_PROTOCOL
        try:
            call_ai_chat(
                endpoint, api_key, model, protocol,
                system="", user="ping", timeout=30, max_tokens=16,
            )
        except AIClientError as exc:
            return {"valid": False, "detail": str(exc)}
        except Exception as exc:
            return {"valid": False, "detail": f"AI 服务调用异常: {exc}"}
        return {"valid": True, "detail": f"AI 服务调用成功（{endpoint}，模型 {model}）"}
