from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets, filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.project.models import Project, ProjectMember, ProjectIntegration
from apps.project.serializers import (
    ProjectSerializer, ProjectListSerializer, ProjectMemberSerializer,
    ProjectIntegrationSerializer,
)
from utils.permissions import IsSuperUser, IsProjectManager
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


class ProjectMemberViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectMemberSerializer
    permission_classes = [IsAuthenticated, IsProjectManager]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ProjectMember.objects.none()
        return ProjectMember.objects.filter(project_id=self.kwargs["project_pk"])

    def perform_create(self, serializer):
        project = Project.objects.get(id=self.kwargs["project_pk"])
        serializer.save(project=project)


class ProjectIntegrationViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectIntegrationSerializer
    permission_classes = [IsAuthenticated, IsProjectManager]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ProjectIntegration.objects.none()
        return ProjectIntegration.objects.filter(project_id=self.kwargs["project_pk"])

    def perform_create(self, serializer):
        project = Project.objects.get(id=self.kwargs["project_pk"])
        serializer.save(project=project)

    @action(detail=True, methods=["post"])
    def test(self, request, project_pk=None, pk=None):
        """测试外站绑定连通性（Milestone 1 中简化实现）"""
        integration = self.get_object()
        # TODO: 根据 integration_type 和 vendor 调用实际的外部接口测试
        return success_response({
            "connected": True,
            "detail": "连通性测试通过（当前为简化实现）",
            "integration_type": integration.integration_type,
            "vendor": integration.vendor,
        })
