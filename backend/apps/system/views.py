"""
系统管理视图

提供系统参数配置、LDAP 连接测试和操作日志查询接口。
系统配置默认需要 system.config 权限，操作日志需要 system.log 权限（超管自动放行）；
其中 is_public=True 的配置可通过 /configs/public/ 由任意登录用户读取（仅限非敏感配置）。
"""
import re

from django_filters import FilterSet
from django_filters.rest_framework import DateTimeFromToRangeFilter, DjangoFilterBackend
from rest_framework import filters
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.system.models import OperationLog, SystemConfig
from apps.system.serializers import OperationLogSerializer, SystemConfigSerializer
from utils.permissions import HasPermission
from utils.response import error_response, success_response
from utils.viewsets import StandardModelViewSet, StandardReadOnlyModelViewSet

# 敏感配置键模式：与前端 isSensitiveKey 口径一致，公开读取接口强制排除，
# 防止管理员误将密码/密钥类配置标记为公开后泄露给全部登录用户
SENSITIVE_KEY_RE = re.compile(r"(password|passwd|token|secret|api_key|credential)", re.IGNORECASE)


class SystemConfigViewSet(StandardModelViewSet):
    """
    系统参数视图集

    使用 key 作为 lookup 字段，需要 system.config 权限（超管自动放行）。
    """

    queryset = SystemConfig.objects.all()
    serializer_class = SystemConfigSerializer
    lookup_field = "key"
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    search_fields = ["key", "description"]

    def get_permissions(self):
        """默认需要 system.config 权限（超管自动放行）；public 动作仅需登录"""
        if self.action == "public":
            return [IsAuthenticated()]
        return [IsAuthenticated(), HasPermission("system.config")]

    @action(detail=False, methods=["get"])
    def public(self, request: Request) -> Response:
        """
        读取公开配置（is_public=True），仅需登录

        用于前端读取非敏感的全局配置（如变更文档高亮关键字），
        敏感配置（密码/密钥类）不应标记为公开。

        Returns:
            {key: value} 字典（敏感键即使被误标为公开也不会返回）
        """
        configs = (
            SystemConfig.objects.filter(is_public=True)
            .exclude(key__iregex=SENSITIVE_KEY_RE.pattern)
            .values_list("key", "value")
        )
        return success_response(dict(configs))

    @action(detail=False, methods=["post"], url_path="ldap-test")
    def ldap_test(self, request: Request) -> Response:
        """
        使用当前生效的 LDAP 配置（页面配置优先，环境变量兜底）测试连通性

        Returns:
            成功返回提示信息，失败返回具体原因
        """
        from apps.account.ldap_config import LdapConfigError, test_ldap_connection

        try:
            message = test_ldap_connection()
        except LdapConfigError as exc:
            return error_response(40001, str(exc))
        return success_response({"detail": message}, message=message)


class OperationLogFilter(FilterSet):
    """操作日志过滤器，支持时间范围与结果过滤。"""

    created_at = DateTimeFromToRangeFilter(field_name="created_at")

    class Meta:
        model = OperationLog
        fields = ["module", "action", "user", "result", "created_at"]


class OperationLogViewSet(StandardReadOnlyModelViewSet):
    """
    操作日志视图集

    仅支持查询，按模块、动作、用户、结果、时间范围过滤，需要 system.log 权限（超管自动放行）。
    """

    queryset = OperationLog.objects.select_related("user")
    serializer_class = OperationLogSerializer

    def get_permissions(self):
        """需要 system.log 权限（超管自动放行）"""
        return [IsAuthenticated(), HasPermission("system.log")]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = OperationLogFilter
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]
