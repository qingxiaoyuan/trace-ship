from django_filters.rest_framework import DjangoFilterBackend
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, filters
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from apps.project.models import Project, ProjectMember, ProjectIntegration
from apps.project.serializers import (
    ProjectSerializer, ProjectListSerializer, ProjectMemberSerializer,
    ProjectIntegrationSerializer,
)
from utils.permissions import IsSuperUser, IsProjectManager
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider
from utils.response import success_response, error_response


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status"]
    search_fields = ["code", "name"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        if self.action == "list":
            return ProjectListSerializer
        return ProjectSerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Project.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Project.objects.none()
        if user.is_superuser:
            return Project.objects.all()
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return Project.objects.filter(id__in=project_ids)

    def get_permissions(self):
        if self.action == "create":
            return [IsAuthenticated(), IsSuperUser()]
        elif self.action in ["update", "partial_update", "destroy"]:
            return [IsAuthenticated(), IsProjectManager()]
        return super().get_permissions()

    def perform_create(self, serializer):
        project = serializer.save()
        # 创建者自动成为项目管理员
        ProjectMember.objects.get_or_create(
            project=project,
            user=self.request.user,
            defaults={"role": "manager"},
        )


class NestedProjectPermissionMixin:
    """Ensure nested project resources check permissions against the parent project."""

    def get_parent_project(self):
        if not hasattr(self, "_parent_project"):
            self._parent_project = get_object_or_404(Project, id=self.kwargs["project_pk"])
        return self._parent_project

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        self.check_object_permissions(request, self.get_parent_project())


class ProjectMemberViewSet(NestedProjectPermissionMixin, viewsets.ModelViewSet):
    serializer_class = ProjectMemberSerializer
    permission_classes = [IsAuthenticated, IsProjectManager]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ProjectMember.objects.none()
        return ProjectMember.objects.filter(project_id=self.kwargs["project_pk"]).order_by("-created_at")

    def perform_create(self, serializer):
        serializer.save(project=self.get_parent_project())


class ProjectIntegrationViewSet(NestedProjectPermissionMixin, viewsets.ModelViewSet):
    serializer_class = ProjectIntegrationSerializer
    permission_classes = [IsAuthenticated, IsProjectManager]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ProjectIntegration.objects.none()
        return ProjectIntegration.objects.filter(project_id=self.kwargs["project_pk"]).order_by("-created_at")

    def perform_create(self, serializer):
        serializer.save(project=self.get_parent_project())

    @action(detail=True, methods=["post"])
    def test(self, request, project_pk=None, pk=None):
        """测试外站绑定连通性"""
        integration = self.get_object()
        try:
            cred_data = resolve_credential(integration, request.user)
            server_url = integration.config.get("server_url", "")
            if not server_url and integration.external_identity:
                server_url = integration.external_identity
            provider = get_provider(integration.vendor, server_url, cred_data)
            connected = provider.test_connection()
            return success_response({
                "connected": connected,
                "detail": "连接成功",
                "integration_type": integration.integration_type,
                "vendor": integration.vendor,
            })
        except ProviderError as exc:
            return success_response({
                "connected": False,
                "detail": str(exc),
                "integration_type": integration.integration_type,
                "vendor": integration.vendor,
            })
        except Exception as exc:
            return error_response(
                50000,
                f"连通性测试异常: {exc}",
                data={
                    "integration_type": integration.integration_type,
                    "vendor": integration.vendor,
                },
                status_code=500,
            )
