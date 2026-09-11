"""
自定义权限类

提供超管、功能权限、项目角色等多维度权限控制。
"""
from rest_framework import permissions


class IsSuperUser(permissions.BasePermission):
    """超级管理员权限"""

    def has_permission(self, request, view) -> bool:
        """检查当前用户是否为超管"""
        return bool(request.user and request.user.is_superuser)


class HasPermission(permissions.BasePermission):
    """功能权限检查"""

    def __init__(self, permission_code: str):
        """
        Args:
            permission_code: 权限编码，如 "project.view"
        """
        self.permission_code = permission_code
        self.message = "没有执行该操作的权限，请联系管理员分配对应角色"

    def has_permission(self, request, view) -> bool:
        """检查用户是否拥有指定功能权限"""
        if request.user.is_superuser:
            return True
        return request.user.user_roles.filter(
            role__permissions__code=self.permission_code
        ).exists()


class IsProjectMember(permissions.BasePermission):
    """检查用户是否为项目成员（项目负责人视为隐含成员）"""

    def has_object_permission(self, request, view, obj) -> bool:
        """对象级权限检查"""
        if request.user.is_superuser:
            return True
        from apps.project.models import ProductComponent, Project, ProjectMember

        project = obj if hasattr(obj, "members") else getattr(obj, "project", None)
        if project:
            if str(getattr(project, "leader_id", "")) == str(request.user.id):
                return True
            if ProjectMember.objects.filter(project=project, user=request.user).exists():
                return True
        from apps.repository.models import Repository

        if not isinstance(obj, Repository):
            return False
        product_ids = ProductComponent.objects.filter(
            repository=obj, is_active=True,
        ).values_list("project_id", flat=True)
        if Project.objects.filter(id__in=product_ids, leader=request.user).exists():
            return True
        return ProjectMember.objects.filter(
            project_id__in=product_ids, user=request.user,
        ).exists()


class ProjectRolePermission(permissions.BasePermission):
    """项目角色权限检查基类（项目负责人在角色判断上视同 manager）"""

    required_roles = []

    @staticmethod
    def _effective_role(project, user) -> str | None:
        """
        计算用户在项目中的有效角色

        成员记录为 software_admin 时优先生效（软件管理员高于负责人/管理员）；
        项目负责人（leader）否则视同 manager；其余取成员记录的角色，
        非成员返回 None。
        """
        if project is None:
            return None
        from apps.project.models import ProjectMember

        member = ProjectMember.objects.filter(project=project, user=user).first()
        if member and member.role == "software_admin":
            return "software_admin"
        if str(getattr(project, "leader_id", "")) == str(user.id):
            return "manager"
        return member.role if member else None

    def _check(self, project, user) -> bool:
        """按有效角色校验"""
        role = self._effective_role(project, user)
        if role is None:
            return False
        # 软件管理员拥有项目内全部操作权限（仓库、发布、打包、成员管理等）
        if role == "software_admin":
            return True
        if not self.required_roles:
            return True
        return role in self.required_roles

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        # create 等无对象阶段，从请求体 project 或 product_component 做角色预检；
        # 两者都不在请求体时（如 project 由 URL/服务端推断的嵌套资源）
        # 此处放行，须由对象级检查（如 NestedProjectPermissionMixin）兜底
        project_id = request.data.get("project") if hasattr(request, "data") else None
        if not project_id and hasattr(request, "data"):
            component_id = request.data.get("product_component")
            if component_id:
                from apps.project.models import ProductComponent

                component = ProductComponent.objects.filter(id=component_id).only("project_id").first()
                project_id = component.project_id if component else None
        if not project_id:
            return True
        from apps.project.models import Project

        project = Project.objects.filter(id=project_id).first()
        return self._check(project, request.user)

    def has_object_permission(self, request, view, obj) -> bool:
        """对象级权限检查。

        仓库对象按任一已关联产品上的角色判断，兼容共享仓库与
        ``Repository.project`` 为空的全局登记仓库。
        """
        if request.user.is_superuser:
            return True
        project = obj if hasattr(obj, "members") else getattr(obj, "project", None)
        if project and self._check(project, request.user):
            return True
        from apps.project.models import ProductComponent, Project
        from apps.repository.models import Repository

        if not isinstance(obj, Repository):
            return False
        for linked in Project.objects.filter(
            id__in=ProductComponent.objects.filter(
                repository=obj, is_active=True,
            ).values("project_id")
        ):
            if self._check(linked, request.user):
                return True
        return False


class IsProjectManager(ProjectRolePermission):
    """项目管理员权限"""
    required_roles = ["manager"]


class IsRepositoryWorkflowEditor(permissions.BasePermission):
    """仓库创建者可编辑该仓库的审批流程；超管放行。"""

    message = "只有仓库创建者可以编辑审批流程"

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj) -> bool:
        if request.user.is_superuser:
            return True
        repository = getattr(obj, "repository", None)
        if repository and repository.created_by_id:
            return str(repository.created_by_id) == str(request.user.id)
        # 未绑定仓库的存量流程仍按产品管理员处理
        project = getattr(obj, "project", None)
        if project:
            return IsProjectManager()._check(project, request.user)
        return False


class IsProjectPackageAdmin(ProjectRolePermission):
    """项目打包配置维护权限（项目管理员 / 软件管理员）"""
    required_roles = ["manager", "software_admin"]


class IsProjectDeveloper(ProjectRolePermission):
    """项目开发者权限（含管理员）"""
    required_roles = ["manager", "developer"]


class IsProjectTester(ProjectRolePermission):
    """项目测试人员权限（含管理员）"""
    required_roles = ["manager", "tester"]


class IsProjectAuditor(ProjectRolePermission):
    """项目审计人员权限（含管理员）"""
    required_roles = ["manager", "auditor"]


class IsProjectPackager(ProjectRolePermission):
    """项目打包触发权限（管理员/开发/测试）"""
    required_roles = ["manager", "developer", "tester"]


class HasAccessTokenScope(permissions.BasePermission):
    """
    开放接口 Access Token 权限

    视图需声明 open_scope 类属性（OPEN_API_SCOPES 中的编码）。
    校验：request.auth 为 AccessToken 实例、请求方法只读、
    视图 open_scope 在 token 的 scopes 内，缺一不可。
    """

    message = "访问令牌无效或未授权访问该接口"

    def has_permission(self, request, view) -> bool:
        """校验 token 身份、只读方法与 scope 授权"""
        from apps.system.models import AccessToken

        if not isinstance(request.auth, AccessToken):
            return False
        if request.method not in permissions.SAFE_METHODS:
            return False
        open_scope = getattr(view, "open_scope", None)
        if not open_scope:
            return False
        return open_scope in (request.auth.scopes or [])

