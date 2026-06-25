"""
凭证管理视图

提供凭证的增删改查、有效性测试、使用记录查询以及凭证类型枚举接口。
"""
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import serializers, viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.credential.models import Credential
from apps.credential.serializers import CredentialSerializer, CredentialListSerializer
from apps.credential.services import CredentialService
from utils.response import success_response, error_response


class CredentialViewSet(viewsets.ModelViewSet):
    """
    凭证管理视图集

    支持按类型、作用范围、状态过滤和按名称/用户名搜索；
    普通用户只能查看自己有权限的凭证，超管可查看全部。
    """

    serializer_class = CredentialSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["cred_type", "scope", "is_active"]
    search_fields = ["name", "username"]
    ordering_fields = ["created_at", "last_used_at"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        """
        列表接口使用精简序列化器

        Returns:
            当前 action 对应的 Serializer 类
        """
        if self.action == "list":
            return CredentialListSerializer
        return CredentialSerializer

    def get_queryset(self):
        """
        根据当前用户返回可见凭证查询集

        Returns:
            Credential QuerySet
        """
        if getattr(self, "swagger_fake_view", False):
            return Credential.objects.none()
        return CredentialService.queryset_for_user(self.request.user)

    def perform_create(self, serializer):
        """
        保存凭证时自动设置归属人和创建人

        Args:
            serializer: 已校验的 CredentialSerializer 实例
        """
        serializer.save(owner=self.request.user, created_by=self.request.user)

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """
        删除凭证前检查是否存在外部引用

        Args:
            request: DRF Request

        Returns:
            无引用时执行删除，有引用时返回 409
        """
        credential = self.get_object()
        try:
            CredentialService.ensure_can_delete(credential)
        except serializers.ValidationError as exc:
            return error_response(
                40900,
                exc.detail[0] if isinstance(exc.detail, list) else str(exc.detail),
                status_code=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def test(self, request: Request, pk=None) -> Response:
        """
        测试凭证有效性（Milestone 1 中简化实现）

        Args:
            request: DRF Request
            pk: 凭证主键

        Returns:
            当前仅返回格式有效提示，后续应调用实际外部接口测试
        """
        credential = self.get_object()
        # TODO: 根据 cred_type 调用实际外部接口测试
        return success_response({
            "valid": True,
            "detail": "凭证格式有效（当前为简化实现）",
            "cred_type": credential.cred_type,
        })

    @action(detail=True, methods=["get"])
    def usage(self, request: Request, pk=None) -> Response:
        """
        凭证使用记录

        Args:
            request: DRF Request
            pk: 凭证主键

        Returns:
            当前为占位实现，后续补充使用记录查询
        """
        # TODO: 实现凭证使用记录查询
        return success_response({
            "total": 0,
            "results": [],
        })

    @action(detail=False, methods=["get"])
    def types(self, request: Request) -> Response:
        """
        支持的凭证类型、认证模式和作用范围枚举

        Args:
            request: DRF Request

        Returns:
            枚举值列表
        """
        return success_response({
            "cred_types": [
                {"value": "gitlab_token", "label": "GitLab Token"},
                {"value": "gitea_token", "label": "Gitea Token"},
                {"value": "svn_password", "label": "SVN 密码"},
                {"value": "jenkins_token", "label": "Jenkins Token"},
                {"value": "ldap_password", "label": "LDAP 密码"},
                {"value": "ai_api_key", "label": "AI API Key"},
            ],
            "auth_modes": [
                {"value": "token", "label": "Token"},
                {"value": "password", "label": "用户名密码"},
            ],
            "scopes": [
                {"value": "personal", "label": "个人"},
                {"value": "project", "label": "项目"},
                {"value": "global", "label": "全局"},
            ],
        })
