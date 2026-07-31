"""
项目管理视图

提供项目 CRUD、项目成员管理接口。
"""
from django_filters.rest_framework import DjangoFilterBackend
from django.core.exceptions import ValidationError
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
from utils.permissions import HasPermission, IsProjectManager, IsProjectMember
from utils.response import success_response, error_response


class ProjectViewSet(StandardModelViewSet):
    """
    项目管理视图集

    - 拥有 project.create 权限（含超管）可创建项目
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
        根据用户身份返回可见项目，并 annotate 仓库 / 打包配置 / 成员 / 发布数量，
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
            package_count=Count("package_configs", distinct=True),
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
        创建需 project.create 功能权限（超管默认放行），修改/删除需项目管理员权限

        Returns:
            权限实例列表
        """
        if self.action == "create":
            return [IsAuthenticated(), HasPermission("project.create")]
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

    查询（列表/详情）对项目全体成员开放，增删改仅项目管理员可操作。
    """

    queryset = ProjectMember.objects.all()
    serializer_class = ProjectMemberSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]

    def get_permissions(self):
        """
        写操作需项目管理员，读操作项目成员即可

        Returns:
            权限实例列表
        """
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsAuthenticated(), IsProjectManager()]
        return [IsAuthenticated(), IsProjectMember()]

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
        """添加成员并返回统一格式响应（支持 user_ids 批量添加）"""
        user_ids = request.data.get("user_ids")
        if user_ids is None:
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
            return success_response(serializer.data, "添加成功", status=status.HTTP_201_CREATED)
        return self._create_members_batch(request, user_ids)

    def _create_members_batch(self, request: Request, user_ids) -> Response:
        """
        批量添加成员

        已在项目中的用户自动跳过，返回新增成员列表与跳过数量。

        Args:
            request: DRF Request，body 含 user_ids 与 role
            user_ids: 用户 ID 列表

        Returns:
            统一成功响应，data 含 created / skipped
        """
        if not isinstance(user_ids, list) or not user_ids:
            return error_response(40001, "请选择要添加的用户")
        role = request.data.get("role", "developer")
        if role not in dict(ProjectMember.ROLE_CHOICES):
            return error_response(40001, "无效的角色")

        from apps.account.models import User

        project = self.get_parent_project()
        try:
            users = list(User.objects.filter(id__in=user_ids))
        except (ValidationError, ValueError):
            return error_response(40001, "存在无效的用户 ID")
        if not users:
            return error_response(40001, "所选用户不存在")

        existing_user_ids = set(
            ProjectMember.objects.filter(project=project, user__in=users)
            .values_list("user_id", flat=True)
        )
        new_members = [
            ProjectMember(project=project, user=user, role=role)
            for user in users
            if user.id not in existing_user_ids
        ]
        ProjectMember.objects.bulk_create(new_members)

        skipped = len(users) - len(new_members)
        serializer = self.get_serializer(new_members, many=True)
        message = f"已添加 {len(new_members)} 位成员"
        if skipped:
            message += f"，{skipped} 位已在项目中，自动跳过"
        return success_response(
            {"created": serializer.data, "skipped": skipped},
            message,
            status=status.HTTP_201_CREATED,
        )

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
