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
    """检查用户是否为项目成员"""

    def has_object_permission(self, request, view, obj) -> bool:
        """对象级权限检查"""
        if request.user.is_superuser:
            return True
        from apps.project.models import ProjectMember

        project = obj if hasattr(obj, "members") else getattr(obj, "project", None)
        if not project:
            return False
        return ProjectMember.objects.filter(project=project, user=request.user).exists()


class ProjectRolePermission(permissions.BasePermission):
    """项目角色权限检查基类"""

    required_roles = []

    def has_permission(self, request, view) -> bool:
        # 项目角色权限主要在对象级别判断，视图级别默认放行
        return True

    def has_object_permission(self, request, view, obj) -> bool:
        """对象级权限检查"""
        if request.user.is_superuser:
            return True
        from apps.project.models import ProjectMember

        project = obj if hasattr(obj, "members") else getattr(obj, "project", None)
        if not project:
            return False

        member = ProjectMember.objects.filter(project=project, user=request.user).first()
        if not member:
            return False
        if not self.required_roles:
            return True
        return member.role in self.required_roles


class IsProjectManager(ProjectRolePermission):
    """项目管理员权限"""
    required_roles = ["manager"]


class IsProjectDeveloper(ProjectRolePermission):
    """项目开发者权限（含管理员）"""
    required_roles = ["manager", "developer"]


class IsProjectTester(ProjectRolePermission):
    """项目测试人员权限（含管理员）"""
    required_roles = ["manager", "tester"]


class IsProjectAuditor(ProjectRolePermission):
    """项目审计人员权限（含管理员）"""
    required_roles = ["manager", "auditor"]


class IsProjectLeader(permissions.BasePermission):
    """项目负责人权限

    校验当前用户是否为项目 leader。create 时从请求体读取 project，
    update/destroy 时从对象上读取 project。
    """

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        project_id = request.data.get("project")
        if not project_id:
            return False
        from apps.project.models import Project

        return Project.objects.filter(id=project_id, leader=request.user).exists()

    def has_object_permission(self, request, view, obj) -> bool:
        if request.user.is_superuser:
            return True
        project = obj if hasattr(obj, "members") else getattr(obj, "project", None)
        if not project:
            return False
        return str(project.leader_id) == str(request.user.id)
