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
        from apps.project.models import ProjectMember

        project = obj if hasattr(obj, "members") else getattr(obj, "project", None)
        if not project:
            return False
        if str(getattr(project, "leader_id", "")) == str(request.user.id):
            return True
        return ProjectMember.objects.filter(project=project, user=request.user).exists()


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
        # create 等无对象阶段，从请求体 project 字段做角色预检；
        # project 不在请求体时（如 project 由 URL/服务端推断的嵌套资源）
        # 此处放行，须由对象级检查（如 NestedProjectPermissionMixin）兜底
        project_id = request.data.get("project") if hasattr(request, "data") else None
        if not project_id:
            return True
        from apps.project.models import Project

        project = Project.objects.filter(id=project_id).first()
        return self._check(project, request.user)

    def has_object_permission(self, request, view, obj) -> bool:
        """对象级权限检查"""
        if request.user.is_superuser:
            return True
        project = obj if hasattr(obj, "members") else getattr(obj, "project", None)
        if not project:
            return False
        return self._check(project, request.user)


class IsProjectManager(ProjectRolePermission):
    """项目管理员权限"""
    required_roles = ["manager"]


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

