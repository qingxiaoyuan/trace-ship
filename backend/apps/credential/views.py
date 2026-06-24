from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import serializers, viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from apps.credential.models import Credential
from apps.credential.serializers import CredentialSerializer, CredentialListSerializer
from apps.credential.services import CredentialService
from utils.response import success_response, error_response


class CredentialViewSet(viewsets.ModelViewSet):
    serializer_class = CredentialSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["cred_type", "scope", "is_active"]
    search_fields = ["name", "username"]
    ordering_fields = ["created_at", "last_used_at"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        if self.action == "list":
            return CredentialListSerializer
        return CredentialSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Credential.objects.none()
        return CredentialService.queryset_for_user(self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user, created_by=self.request.user)

    def destroy(self, request, *args, **kwargs):
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
    def test(self, request, pk=None):
        """测试凭证有效性（Milestone 1 中简化实现）"""
        credential = self.get_object()
        # TODO: 根据 cred_type 调用实际外部接口测试
        return success_response({
            "valid": True,
            "detail": "凭证格式有效（当前为简化实现）",
            "cred_type": credential.cred_type,
        })

    @action(detail=True, methods=["get"])
    def usage(self, request, pk=None):
        """凭证使用记录"""
        # TODO: 实现凭证使用记录查询
        return success_response({
            "total": 0,
            "results": [],
        })

    @action(detail=False, methods=["get"])
    def types(self, request):
        """支持的凭证类型"""
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
