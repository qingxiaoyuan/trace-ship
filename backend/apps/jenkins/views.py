"""
Jenkins 集成视图

提供 Jenkins 任务 CRUD、构建触发、构建记录查询与日志获取接口。
"""
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from utils.viewsets import StandardModelViewSet, StandardReadOnlyModelViewSet

from apps.jenkins.models import JenkinsBuild, JenkinsJob
from apps.jenkins.serializers import (
    JenkinsBuildSerializer,
    JenkinsJobListSerializer,
    JenkinsJobSerializer,
)
from apps.jenkins.services import JenkinsService
from apps.project.models import ProjectMember
from utils.permissions import IsProjectDeveloper, IsProjectManager, IsProjectMember
from utils.response import error_response, success_response


class JenkinsJobViewSet(StandardModelViewSet):
    """
    Jenkins 任务视图集

    - 项目管理员可创建/修改/删除任务
    - 项目开发者可触发构建
    - 普通成员仅可查看自己参与项目的任务
    """

    queryset = JenkinsJob.objects.all()
    serializer_class = JenkinsJobSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["project", "is_active"]
    search_fields = ["name", "job_name"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        """
        列表接口使用精简序列化器

        Returns:
            Serializer 类
        """
        if self.action == "list":
            return JenkinsJobListSerializer
        return JenkinsJobSerializer

    def get_queryset(self):
        """
        根据用户身份返回可见任务

        Returns:
            JenkinsJob QuerySet
        """
        if getattr(self, "swagger_fake_view", False):
            return JenkinsJob.objects.none()
        user = self.request.user
        queryset = JenkinsJob.objects.select_related("project", "credential", "repository").prefetch_related("builds")
        if user.is_superuser:
            return queryset.all()
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        """
        写操作需项目管理员，触发构建需项目开发者

        Returns:
            权限实例列表
        """
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsAuthenticated(), IsProjectManager()]
        if self.action == "trigger":
            return [IsAuthenticated(), IsProjectDeveloper()]
        return super().get_permissions()

    def create(self, request: Request, *args, **kwargs) -> Response:
        """
        创建 Jenkins 任务

        Args:
            request: DRF Request

        Returns:
            创建后的任务
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return success_response(serializer.data, message="创建成功", status=201)

    def update(self, request: Request, *args, **kwargs) -> Response:
        """
        更新 Jenkins 任务

        Args:
            request: DRF Request

        Returns:
            更新后的任务
        """
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return success_response(serializer.data, message="更新成功")

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """
        删除 Jenkins 任务

        Args:
            request: DRF Request

        Returns:
            删除结果
        """
        instance = self.get_object()
        self.perform_destroy(instance)
        return success_response(None, message="删除成功")

    @action(detail=True, methods=["post"])
    def trigger(self, request: Request, pk=None) -> Response:
        """
        触发构建

        Args:
            request: DRF Request，body 可包含 release_id 或 version/branch/git_hash
            pk: 任务主键

        Returns:
            构建记录
        """
        job = self.get_object()
        release_id = request.data.get("release_id")
        try:
            if release_id:
                from apps.release.models import ReleaseRecord
                release = ReleaseRecord.objects.get(id=release_id)
                build = JenkinsService.trigger_build(job, release, request.user)
            else:
                from types import SimpleNamespace
                release = SimpleNamespace(
                    id=None,
                    version=request.data.get("version", ""),
                    branch=request.data.get("branch", ""),
                    git_hash=request.data.get("git_hash", ""),
                )
                build = JenkinsService.trigger_build(job, release, request.user)
        except Exception as exc:
            return error_response(50001, f"触发构建失败: {exc}", status_code=500)
        serializer = JenkinsBuildSerializer(build, context={"request": request})
        return success_response(serializer.data, message="触发成功", status=201)


class JenkinsBuildViewSet(StandardReadOnlyModelViewSet):
    """
    Jenkins 构建记录视图集

    仅只读，支持查询详情与日志。
    """

    queryset = JenkinsBuild.objects.all()
    serializer_class = JenkinsBuildSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["job", "status"]
    ordering_fields = ["created_at", "started_at", "finished_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        """
        根据用户身份返回可见构建记录

        Returns:
            JenkinsBuild QuerySet
        """
        if getattr(self, "swagger_fake_view", False):
            return JenkinsBuild.objects.none()
        user = self.request.user
        queryset = JenkinsBuild.objects.select_related("job", "job__project")
        if user.is_superuser:
            return queryset.all()
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(job__project_id__in=project_ids)

    def get_permissions(self):
        """
        查看日志需项目成员权限

        Returns:
            权限实例列表
        """
        if self.action == "log":
            return [IsAuthenticated(), IsProjectMember()]
        return super().get_permissions()

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        """
        构建详情

        Args:
            request: DRF Request

        Returns:
            构建详情
        """
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return success_response(serializer.data)

    @action(detail=True, methods=["get"])
    def log(self, request: Request, pk=None) -> Response:
        """
        获取构建日志

        Args:
            request: DRF Request
            pk: 构建主键

        Returns:
            日志文本
        """
        build = self.get_object()
        content = JenkinsService.get_build_log(build)
        return success_response({"content": content})