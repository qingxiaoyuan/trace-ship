"""
项目管理视图

提供项目 CRUD、项目成员管理接口。
"""
from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, filters, status
from utils.viewsets import StandardModelViewSet, StandardReadOnlyModelViewSet
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.project.models import Project, ProjectMember
from apps.project.serializers import (
    ProjectSerializer, ProjectListSerializer, ProjectMemberSerializer,
)
from apps.project.services import ProjectService
from utils.permissions import IsSuperUser, IsProjectManager
from utils.response import success_response, error_response


class ProjectViewSet(StandardModelViewSet):
    """
    项目管理视图集

    - 超管可创建项目
    - 项目管理员可修改/删除项目
    - 普通成员仅可查看自己参与的项目
    """

    queryset = Project.objects.all()
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["status"]
    search_fields = ["code", "name"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        """
        列表接口使用精简序列化器

        Returns:
            Serializer 类
        """
        if self.action == "list":
            return ProjectListSerializer
        return ProjectSerializer

    def get_queryset(self):
        """
        根据用户身份返回可见项目，并 annotate 仓库 / Jenkins / 成员 / 发布数量，
        供列表与详情序列化器直接读取，避免 N+1 查询。
        """
        if getattr(self, "swagger_fake_view", False):
            return Project.objects.none()
        user = self.request.user
        if not user or not user.is_authenticated:
            return Project.objects.none()
        queryset = Project.objects.select_related("leader").annotate(
            repo_count=Count("repositories", distinct=True),
            member_count=Count("members", distinct=True),
            jenkins_count=Count("jenkins_jobs", distinct=True),
            release_count=Count("releases", distinct=True),
        )
        if user.is_superuser:
            return queryset.all()
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(id__in=project_ids)

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request: Request) -> Response:
        """项目统计：项目总数、启用中、关联仓库总数、项目成员总数。"""
        queryset = self.get_queryset()
        aggregate = queryset.aggregate(
            total=Count("id", distinct=True),
            active_count=Count("id", distinct=True, filter=Q(status=1)),
            repo_total=Count("repositories", distinct=True),
            member_total=Count("members", distinct=True),
        )
        return success_response({
            "total": aggregate["total"] or 0,
            "active_count": aggregate["active_count"] or 0,
            "repo_total": aggregate["repo_total"] or 0,
            "member_total": aggregate["member_total"] or 0,
        })

    def get_permissions(self):
        """
        创建需超管权限，修改/删除需项目管理员权限

        Returns:
            权限实例列表
        """
        if self.action == "create":
            return [IsAuthenticated(), IsSuperUser()]
        elif self.action in ["update", "partial_update", "destroy"]:
            return [IsAuthenticated(), IsProjectManager()]
        return super().get_permissions()

    def create(self, request: Request, *args, **kwargs) -> Response:
        """
        创建项目并返回统一格式响应

        Args:
            request: DRF Request

        Returns:
            统一成功响应，HTTP 201
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return success_response(serializer.data, "创建成功", status=status.HTTP_201_CREATED)

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        """
        获取项目详情并返回统一格式响应

        Args:
            request: DRF Request

        Returns:
            统一成功响应
        """
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return success_response(serializer.data)

    def update(self, request: Request, *args, **kwargs) -> Response:
        """
        更新项目并返回统一格式响应

        Args:
            request: DRF Request

        Returns:
            统一成功响应
        """
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        if getattr(instance, "_prefetched_objects_cache", None):
            instance._prefetched_objects_cache = {}
        return success_response(serializer.data, "更新成功")

    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        """
        部分更新项目

        Args:
            request: DRF Request

        Returns:
            统一成功响应
        """
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """
        删除项目并返回统一格式响应

        Args:
            request: DRF Request

        Returns:
            统一成功响应
        """
        instance = self.get_object()
        self.perform_destroy(instance)
        return success_response(None, "删除成功")

    def perform_create(self, serializer):
        """
        创建项目后自动将创建者设为项目管理员

        Args:
            serializer: 已校验的项目序列化器
        """
        project = serializer.save()
        ProjectService.add_creator_as_manager(project, self.request.user)


class NestedProjectPermissionMixin:
    """
    嵌套资源权限校验 Mixin

    确保项目成员等嵌套资源先对父项目做对象级权限检查。
    """

    def get_parent_project(self) -> Project:
        """
        获取当前路由对应的项目实例

        Returns:
            Project 实例
        """
        if not hasattr(self, "_parent_project"):
            self._parent_project = get_object_or_404(Project, id=self.kwargs["project_pk"])
        return self._parent_project

    def initial(self, request: Request, *args, **kwargs):
        """
        在视图初始化时对父项目进行对象级权限检查
        """
        super().initial(request, *args, **kwargs)
        self.check_object_permissions(request, self.get_parent_project())


class ProjectMemberViewSet(NestedProjectPermissionMixin, StandardModelViewSet):
    """
    项目成员视图集

    提供项目成员的增删改查，仅项目管理员可操作。
    """

    queryset = ProjectMember.objects.all()
    serializer_class = ProjectMemberSerializer
    permission_classes = [IsAuthenticated, IsProjectManager]

    def get_queryset(self):
        """
        返回当前项目的成员列表

        Returns:
            ProjectMember QuerySet
        """
        if getattr(self, "swagger_fake_view", False):
            return ProjectMember.objects.none()
        return (
            ProjectMember.objects
            .select_related("user", "project")
            .filter(project_id=self.kwargs["project_pk"])
            .order_by("-created_at")
        )

    def create(self, request: Request, *args, **kwargs) -> Response:
        """添加成员并返回统一格式响应"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return success_response(serializer.data, "添加成功", status=status.HTTP_201_CREATED)

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        """查询单个成员详情"""
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return success_response(serializer.data)

    def update(self, request: Request, *args, **kwargs) -> Response:
        """更新成员角色"""
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return success_response(serializer.data, "更新成功")

    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        """部分更新成员"""
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """移除成员"""
        instance = self.get_object()
        self.perform_destroy(instance)
        return success_response(None, "移除成功")

    def perform_create(self, serializer):
        """
        创建成员时自动关联到当前项目

        Args:
            serializer: 已校验的成员序列化器
        """
        serializer.save(project=self.get_parent_project())