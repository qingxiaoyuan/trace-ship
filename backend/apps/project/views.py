"""
项目管理视图

提供项目 CRUD、项目成员管理接口。
"""
from django.core.exceptions import ValidationError
from django.db.models import Count, Prefetch, Q
from django.db.models.deletion import ProtectedError
from django.db.models.functions import Greatest
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.project.models import ProductComponent, Project, ProjectMember
from apps.project.serializers import (
    ProductComponentSerializer,
    ProjectListSerializer,
    ProjectMemberSerializer,
    ProjectSerializer,
)
from apps.project.services import (
    ProjectService,
    next_component_code,
    visible_project_ids,
    visible_repository_ids,
)
from apps.repository.models import Repository
from apps.repository.serializers import RepositoryListSerializer
from apps.repository.services import RepositoryService
from utils.permissions import HasPermission, IsProjectManager, IsProjectMember
from utils.provider.credential_resolver import resolve_credential
from utils.provider.factory import get_provider
from utils.response import error_response, success_response
from utils.viewsets import StandardModelViewSet


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
        queryset = (
            Project.objects.select_related("leader")
            .prefetch_related(
                # 预取当前用户在每个项目中的成员记录（to_attr="_my_member"），
                # 供列表序列化器 get_my_role 读取，避免逐项目查询成员表
                Prefetch(
                    "members",
                    queryset=ProjectMember.objects.filter(user=user).only("role", "project_id"),
                    to_attr="_my_member",
                )
            )
            .annotate(
                # 迁移后组件关系覆盖全部旧仓库；Greatest 仍兼容测试夹具、脚本等
                # 直接创建 Repository 而尚未补 ProductComponent 的短暂状态。
                repo_count=Greatest(
                    Count("repositories", distinct=True),
                    Count("product_components", distinct=True),
                ),
                member_count=Count("members", distinct=True),
                package_count=Count("package_configs", distinct=True),
                release_count=Count("releases", distinct=True),
            )
        )
        if user.is_superuser:
            return queryset.all()
        project_ids = visible_project_ids(user)
        return queryset.filter(id__in=project_ids)

    @action(detail=False, methods=["get"], url_path="stats")
    def stats(self, request: Request) -> Response:
        """项目统计：项目总数、启用中、关联仓库总数、项目成员总数。"""
        queryset = self.get_queryset()
        aggregate = queryset.aggregate(
            total=Count("id", distinct=True),
            active_count=Count("id", distinct=True, filter=Q(status=1)),
            member_total=Count("members", distinct=True),
        )
        repo_total = sum(project.repo_count for project in queryset)
        return success_response({
            "total": aggregate["total"] or 0,
            "active_count": aggregate["active_count"] or 0,
            "repo_total": repo_total,
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
        获取当前路由对应、且当前用户可见的项目实例

        Returns:
            Project 实例
        """
        if not hasattr(self, "_parent_project"):
            queryset = Project.objects.filter(id__in=visible_project_ids(self.request.user))
            self._parent_project = get_object_or_404(queryset, id=self.kwargs["project_pk"])
        return self._parent_project

    def initial(self, request: Request, *args, **kwargs):
        """
        在视图初始化时对父项目进行对象级权限检查
        """
        super().initial(request, *args, **kwargs)
        self.check_object_permissions(request, self.get_parent_project())


class ProductComponentViewSet(NestedProjectPermissionMixin, StandardModelViewSet):
    """产品组件管理：关联/解除物理仓库，并维护产品内差异化配置。"""

    queryset = ProductComponent.objects.all()
    serializer_class = ProductComponentSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]

    def get_permissions(self):
        """查询对产品成员开放，维护关系仅产品管理员/软件管理员可操作。"""
        if self.action in ["create", "update", "partial_update", "destroy", "delete_tag"]:
            return [IsAuthenticated(), IsProjectManager()]
        return [IsAuthenticated(), IsProjectMember()]

    def get_serializer_context(self):
        """向序列化器注入父产品，供产品内唯一性校验使用。"""
        context = super().get_serializer_context()
        context["project"] = self.get_parent_project()
        return context

    def get_queryset(self):
        """仅返回路由指定产品的组件，并注解仓库被多少产品引用。"""
        if getattr(self, "swagger_fake_view", False):
            return ProductComponent.objects.none()
        from apps.credential.models import RepositoryCredentialLoan
        from apps.package.models import PackageConfig
        from apps.release.models import ReleaseRecord

        project_id = self.kwargs["project_pk"]
        return (
            ProductComponent.objects
            .filter(project_id=project_id)
            .select_related("project", "repository", "repository__project", "repository__credential")
            .prefetch_related(
                Prefetch(
                    "repository__releases",
                    queryset=ReleaseRecord.objects.filter(
                        project_id=project_id,
                        status="released",
                    ).order_by("-released_at", "-created_at"),
                    to_attr="_latest_project_releases",
                ),
                Prefetch(
                    "package_configs",
                    queryset=PackageConfig.objects.order_by("name"),
                    to_attr="_component_package_configs",
                ),
                Prefetch(
                    "repository__credential_loans",
                    queryset=RepositoryCredentialLoan.objects.filter(
                        allowed_products__id=project_id,
                    ).select_related("credential", "lender").distinct(),
                    to_attr="_available_credential_loans",
                ),
            )
            .annotate(product_count=Count("repository__product_components", distinct=True))
        )

    def list(self, request: Request, *args, **kwargs) -> Response:
        """返回当前产品的组件列表。"""
        queryset = self.filter_queryset(self.get_queryset())
        serializer = self.get_serializer(queryset, many=True)
        return success_response(serializer.data)

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        """返回单个产品组件。"""
        return success_response(self.get_serializer(self.get_object()).data)

    def create(self, request: Request, *args, **kwargs) -> Response:
        """将已有物理仓库关联为当前产品的组件。"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        repository = serializer.validated_data["repository"]
        project = self.get_parent_project()
        component_code = serializer.validated_data.get("component_code") or next_component_code(
            project, repository.name
        )
        display_name = serializer.validated_data.get("display_name") or repository.name
        default_branch = serializer.validated_data.get("default_branch") or repository.default_branch
        component = serializer.save(
            project=project,
            component_code=component_code,
            display_name=display_name,
            default_branch=default_branch,
        )
        return success_response(
            self.get_serializer(component).data,
            "关联成功",
            status=status.HTTP_201_CREATED,
        )

    def update(self, request: Request, *args, **kwargs) -> Response:
        """更新产品内组件配置；不修改物理仓库。"""
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return success_response(serializer.data, "更新成功")

    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        """部分更新产品内组件配置。"""
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """仅解除产品关系，绝不删除物理仓库。有发布或打包历史时只能停用。"""
        instance = self.get_object()
        from apps.release.models import ReleaseRecord

        if ReleaseRecord.objects.filter(
            project_id=instance.project_id, repository_id=instance.repository_id
        ).exists():
            return error_response(
                40901,
                "该仓库在当前产品下已有发布记录，不能移除；请改为停用",
                status_code=status.HTTP_409_CONFLICT,
            )
        try:
            self.perform_destroy(instance)
        except ProtectedError:
            return error_response(
                40901,
                "仓库已有关联的打包配置，不能移除；请改为停用",
                status_code=status.HTTP_409_CONFLICT,
            )
        return success_response(None, "已从产品中移除，物理仓库未删除")

    @action(detail=False, methods=["get"], url_path="available")
    def available(self, request: Request, *args, **kwargs) -> Response:
        """返回当前用户可见的全局仓库目录，同仓库可承担多个组件角色。"""
        queryset = (
            Repository.objects
            .filter(id__in=visible_repository_ids(request.user))
            .select_related("project", "credential")
            .annotate(product_count=Count("product_components", distinct=True))
            .order_by("name")
        )
        keyword = (request.query_params.get("search") or "").strip()
        if keyword:
            queryset = queryset.filter(
                Q(name__icontains=keyword)
                | Q(url__icontains=keyword)
                | Q(external_identity__icontains=keyword)
            )
        serializer = RepositoryListSerializer(
            queryset[:100],
            many=True,
            context={"request": request, "product": self.get_parent_project()},
        )
        return success_response(serializer.data)

    def _provider(self, request: Request, operation: str = "read"):
        """按当前产品与显式借用解析组件仓库 Provider。"""
        component = self.get_object()
        loan = request.query_params.get("credential_loan") or request.data.get("credential_loan")
        data = resolve_credential(
            component.repository,
            request.user,
            product=component.project,
            loan=loan,
            operation=operation,
            product_component=component,
        )
        provider = get_provider(
            component.repository.vendor,
            RepositoryService._resolve_server_url(component.repository),
            data,
        )
        return component, provider

    @action(detail=True, methods=["get"])
    def branches(self, request: Request, *args, **kwargs) -> Response:
        """使用产品可用的凭证借用实时读取组件分支。"""
        component, provider = self._provider(request)
        values = provider.list_branches(component.repository.external_identity)
        return success_response([
            {
                "name": item.name,
                "is_default": item.is_default,
                "last_commit_hash": item.last_commit_hash,
                "last_commit_author": item.last_commit_author,
                "last_commit_message": item.last_commit_message,
                "last_commit_at": item.last_commit_at,
            }
            for item in values
        ])

    @action(detail=True, methods=["get"])
    def tags(self, request: Request, *args, **kwargs) -> Response:
        """使用产品可用的凭证借用实时读取组件 Tag。"""
        component, provider = self._provider(request)
        values = provider.list_tags(component.repository.external_identity)
        return success_response([
            {"name": item.name, "commit_hash": item.commit_hash, "created_at": item.created_at}
            for item in values
        ])

    @action(detail=True, methods=["get"], url_path="next-version")
    def next_version(self, request: Request, *args, **kwargs) -> Response:
        """按仓库/组件版本规则计算下一组件版本。"""
        from apps.release.services import VersionCalculator

        component, provider = self._provider(request)
        release_type = request.query_params.get("release_type", "formal")
        tags = provider.list_tags(component.repository.external_identity)
        version, tag_name = VersionCalculator(component.repository.get_version_rule()).calculate(
            tags, release_type
        )
        return success_response({"next_version": version, "next_tag_name": tag_name})

    @action(detail=True, methods=["post"], url_path="delete-tag")
    def delete_tag(self, request: Request, *args, **kwargs) -> Response:
        """产品管理员凭 delete_tag 借用权限幂等删除组件 Tag。"""
        from apps.repository.models import RepositoryTag
        from utils.provider.exceptions import NotFoundError

        tag_name = (request.data.get("tag_name") or "").strip()
        if not tag_name:
            return error_response(40001, "tag_name 不能为空")
        component, provider = self._provider(request, operation="delete_tag")
        remote_deleted = True
        try:
            provider.delete_tag(component.repository.external_identity, tag_name)
        except NotFoundError:
            remote_deleted = False
        RepositoryTag.objects.filter(repository=component.repository, name=tag_name).delete()
        return success_response({"tag_name": tag_name, "remote_deleted": remote_deleted})


class ProjectMemberViewSet(NestedProjectPermissionMixin, StandardModelViewSet):
    """
    项目成员视图集

    查询（列表/详情）对项目全体成员开放；添加成员全体项目成员均可，
    但可授予的角色按操作者角色收缩（manager 全部 / software_admin 除
    manager 与 software_admin / 其他成员仅 developer、tester）；
    修改角色与移除成员仅项目管理员（含软件管理员）可操作。
    """

    queryset = ProjectMember.objects.all()
    serializer_class = ProjectMemberSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]

    def get_permissions(self):
        """
        读操作项目成员即可；添加成员全体项目成员均可（可授予的角色按操作者
        角色收缩，见 apps.project.services.get_grantable_roles）；
        修改角色 / 移除成员仍需项目管理员。

        Returns:
            权限实例列表
        """
        if self.action in ["update", "partial_update", "destroy"]:
            return [IsAuthenticated(), IsProjectManager()]
        return [IsAuthenticated(), IsProjectMember()]

    def _check_grantable_role(self, request: Request, role: str):
        """校验操作者是否有权授予指定角色，无权时返回错误响应，有权返回 None。"""
        from apps.project.services import get_grantable_roles

        project = self.get_parent_project()
        if role not in get_grantable_roles(project, request.user):
            return error_response(40301, "当前角色无权授予该成员角色", status_code=403)
        return None

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
            # 先由序列化器校验角色合法性（400），再校验操作者是否有权授予（403）
            denied = self._check_grantable_role(
                request, serializer.validated_data.get("role", "developer")
            )
            if denied is not None:
                return denied
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
        denied = self._check_grantable_role(request, role)
        if denied is not None:
            return denied

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
        """更新成员角色（目标角色同样受操作者可授予角色集合约束）"""
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        # 先由序列化器校验角色合法性（400），再校验操作者是否有权授予（403）
        role = serializer.validated_data.get("role")
        if role is not None:
            denied = self._check_grantable_role(request, role)
            if denied is not None:
                return denied
        self.perform_update(serializer)
        return success_response(serializer.data, "更新成功")

    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        """部分更新成员"""
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """移除成员。仓库所有者仍关联在本产品时不能移除。"""
        instance = self.get_object()
        from apps.project.models import ProductComponent
        from apps.project.services import repository_owner

        owned_names: list[str] = []
        components = ProductComponent.objects.filter(
            project=instance.project, is_active=True,
        ).select_related("repository", "repository__created_by", "repository__credential")
        for component in components:
            owner = repository_owner(component.repository)
            if owner is not None and str(owner.id) == str(instance.user_id):
                owned_names.append(component.display_name or component.repository.name)
        if owned_names:
            return error_response(
                40901,
                f"该成员是已关联仓库的所有者（{'、'.join(owned_names)}），请先停用或移除这些仓库关联",
                status_code=status.HTTP_409_CONFLICT,
            )
        self.perform_destroy(instance)
        return success_response(None, "移除成功")

    def perform_create(self, serializer):
        """
        创建成员时自动关联到当前项目

        Args:
            serializer: 已校验的成员序列化器
        """
        serializer.save(project=self.get_parent_project())
