from rest_framework import permissions


class IsSuperUser(permissions.BasePermission):
    """超级管理员权限"""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_superuser)


class HasPermission(permissions.BasePermission):
    """功能权限检查"""

    def __init__(self, permission_code):
        self.permission_code = permission_code

    def has_permission(self, request, view):
        if request.user.is_superuser:
            return True
        return request.user.user_roles.filter(
            role__permissions__code=self.permission_code
        ).exists()


class IsProjectMember(permissions.BasePermission):
    """检查用户是否为项目成员"""

    def has_object_permission(self, request, view, obj):
        if request.user.is_superuser:
            return True
        from apps.project.models import ProjectMember

        project = obj if hasattr(obj, "members") else getattr(obj, "project", None)
        if not project:
            return False
        return ProjectMember.objects.filter(project=project, user=request.user).exists()


class IsProjectManager(permissions.BasePermission):
    """检查用户是否为项目管理员"""

    def has_object_permission(self, request, view, obj):
        if request.user.is_superuser:
            return True
        from apps.project.models import ProjectMember

        project = obj if hasattr(obj, "members") else getattr(obj, "project", None)
        if not project:
            return False
        return ProjectMember.objects.filter(
            project=project, user=request.user, role="manager"
        ).exists()


class ProjectRolePermission(permissions.BasePermission):
    """项目角色权限检查"""

    required_roles = []

    def has_permission(self, request, view):
        # 项目角色权限主要在对象级别判断，视图级别默认放行
        return True

    def has_object_permission(self, request, view, obj):
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
    """项目管理员"""
    required_roles = ["manager"]


class IsProjectDeveloper(ProjectRolePermission):
    """项目开发者"""
    required_roles = ["manager", "developer"]


class IsProjectTester(ProjectRolePermission):
    """项目测试人员"""
    required_roles = ["manager", "tester"]


class IsProjectAuditor(ProjectRolePermission):
    """项目审计人员"""
    required_roles = ["manager", "auditor"]
