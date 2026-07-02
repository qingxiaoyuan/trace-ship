"""
系统内置打包视图
"""
from pathlib import Path

from django.http import FileResponse, Http404, HttpResponse
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

from apps.package.models import PackageConfig, PackageImage, PackageTask
from apps.package.serializers import (
    PackageConfigSerializer,
    PackageImageSerializer,
    PackageTaskSerializer,
)
from apps.package.services import PackageService
from apps.project.models import ProjectMember
from apps.release.models import ReleaseRecord
from utils.permissions import IsProjectManager, IsProjectMember, IsSuperUser
from utils.response import error_response, success_response
from utils.viewsets import StandardModelViewSet, StandardReadOnlyModelViewSet


class PackageImageViewSet(StandardModelViewSet):
    """系统级打包镜像配置视图集。"""

    queryset = PackageImage.objects.all()
    serializer_class = PackageImageSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["build_type", "is_active"]
    search_fields = ["name", "image"]
    ordering_fields = ["created_at", "build_type"]
    ordering = ["build_type", "-created_at"]

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [IsAuthenticated(), IsSuperUser()]
        return [IsAuthenticated()]


class PackageConfigViewSet(StandardModelViewSet):
    """项目级打包配置视图集。"""

    queryset = PackageConfig.objects.all()
    serializer_class = PackageConfigSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["project", "repository", "mode", "build_type", "is_active", "auto_package_on_release"]
    search_fields = ["name", "repository__name"]
    ordering_fields = ["created_at", "updated_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return PackageConfig.objects.none()
        queryset = PackageConfig.objects.select_related("project", "repository", "image")
        if user.is_superuser:
            return queryset
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [IsAuthenticated(), IsProjectManager()]
        return [IsAuthenticated(), IsProjectMember()]

    @action(detail=True, methods=["post"], url_path="trigger")
    def trigger(self, request, pk=None):
        """手动触发某个已发布版本的打包。"""
        config = self.get_object()
        release_id = request.data.get("release") or request.data.get("release_id")
        if not release_id:
            return error_response(40000, "必须指定 release_id", status_code=status.HTTP_400_BAD_REQUEST)
        release = ReleaseRecord.objects.filter(id=release_id).select_related("project", "repository").first()
        if not release:
            return error_response(40400, "发布记录不存在", status_code=status.HTTP_404_NOT_FOUND)
        task = PackageService.create_task_for_release(config, release, request_user=request.user)
        data = PackageTaskSerializer(task, context={"request": request}).data
        return success_response(data, "已创建打包任务", status=status.HTTP_201_CREATED)


class PackageTaskViewSet(StandardReadOnlyModelViewSet):
    """打包任务只读视图集。"""

    queryset = PackageTask.objects.all()
    serializer_class = PackageTaskSerializer
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["project", "repository", "release", "config", "status", "mode", "build_type"]
    search_fields = ["name", "version", "tag_name", "project__name", "repository__name"]
    ordering_fields = ["created_at", "started_at", "finished_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        user = self.request.user
        if not user.is_authenticated:
            return PackageTask.objects.none()
        queryset = PackageTask.objects.select_related("config", "release", "project", "repository", "triggered_by")
        if user.is_superuser:
            return queryset
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        return [IsAuthenticated(), IsProjectMember()]

    @action(detail=True, methods=["get"], url_path="logs")
    def logs(self, request, pk=None):
        """读取任务日志。"""
        task = self.get_object()
        if not task.log_path or not Path(task.log_path).exists():
            return HttpResponse("", content_type="text/plain; charset=utf-8")
        workspace = Path(task.workspace_path).resolve() if task.workspace_path else None
        log_path = Path(task.log_path).resolve()
        workspace_root = PackageService.workspace_root().resolve()
        if (
            not workspace
            or (workspace != workspace_root and workspace_root not in workspace.parents)
            or (workspace not in log_path.parents and log_path != workspace)
        ):
            raise Http404("日志路径非法")
        return FileResponse(open(log_path, "rb"), content_type="text/plain; charset=utf-8")

    @action(detail=True, methods=["get"], url_path=r"artifacts/(?P<artifact_id>[^/.]+)/download")
    def download_artifact(self, request, pk=None, artifact_id=None):
        """下载任务产物。"""
        task = self.get_object()
        artifact = next((item for item in task.artifact_info if item.get("id") == artifact_id), None)
        if not artifact:
            raise Http404("产物不存在")
        workspace = Path(task.workspace_path).resolve() if task.workspace_path else None
        workspace_root = PackageService.workspace_root().resolve()
        if not workspace or (workspace != workspace_root and workspace_root not in workspace.parents):
            raise Http404("工作区路径非法")
        root = workspace / "artifacts"
        file_path = (root / artifact["path"]).resolve()
        if root.resolve() not in file_path.parents and file_path != root.resolve():
            raise Http404("产物路径非法")
        if not file_path.exists() or not file_path.is_file():
            raise Http404("产物文件不存在")
        return FileResponse(open(file_path, "rb"), as_attachment=True, filename=artifact.get("name") or file_path.name)
