"""
项目业务服务

封装项目创建者自动加入项目等逻辑。
"""
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.project.models import Project, ProjectMember


class ProjectService:
    """
    项目相关业务规则服务
    """

    @staticmethod
    def generate_project_code() -> str:
        """
        自动生成项目编码

        格式：PROJ + 年月日 + 4位自增序号，如 PROJ202506250001。
        使用 select_for_update 保证并发安全。

        Returns:
            新生成的项目编码
        """
        prefix = "PROJ"
        today = timezone.now().strftime("%Y%m%d")
        base_code = f"{prefix}{today}"

        with transaction.atomic():
            latest = (
                Project.objects.select_for_update()
                .filter(code__startswith=base_code)
                .order_by("-code")
                .first()
            )
            if latest and len(latest.code) >= len(base_code) + 4:
                seq_str = latest.code[-4:]
                try:
                    seq = int(seq_str) + 1
                except ValueError:
                    seq = 1
            else:
                seq = 1

            return f"{base_code}{seq:04d}"

    @staticmethod
    def add_creator_as_manager(project, user) -> None:
        """
        将项目创建者自动添加为项目管理员

        Args:
            project: 新创建的项目实例
            user: 创建者用户
        """
        ProjectMember.objects.get_or_create(
            project=project,
            user=user,
            defaults={"role": "manager"},
        )


# 全部可授予的项目角色
ALL_GRANTABLE_ROLES = [role for role, _ in ProjectMember.ROLE_CHOICES]
# 软件管理员可授予的角色（除项目负责人、软件管理员）
SOFTWARE_ADMIN_GRANTABLE_ROLES = [
    role for role in ALL_GRANTABLE_ROLES if role not in ("manager", "software_admin")
]
# 普通成员拉人进项目时可授予的角色（仅开发 / 测试）
MEMBER_GRANTABLE_ROLES = ["developer", "tester"]


def get_grantable_roles(project, user) -> list[str]:
    """
    按操作者在项目中的有效角色返回其可授予的成员角色集合

    规则：超管 / 项目负责人（leader）/ manager 可授全部角色；
    software_admin 可授除 manager、software_admin 之外的角色；
    其余成员角色（developer/tester/auditor/viewer）拉人进项目仅能授 developer/tester；
    非项目成员返回空列表。

    Args:
        project: 项目实例
        user: 操作者用户

    Returns:
        可授予的角色值列表
    """
    if user.is_superuser:
        return ALL_GRANTABLE_ROLES
    from utils.permissions import ProjectRolePermission

    role = ProjectRolePermission._effective_role(project, user)
    if role == "manager":
        return ALL_GRANTABLE_ROLES
    if role == "software_admin":
        return SOFTWARE_ADMIN_GRANTABLE_ROLES
    if role is None:
        return []
    return MEMBER_GRANTABLE_ROLES


def visible_project_ids(user):
    """
    用户可见的项目 ID 查询集

    项目成员或项目负责人（leader 视为隐含成员）均可见，
    供各业务视图的 get_queryset 统一过滤使用。
    拥有 release.audit 权限的审查员可查看全部项目（跨项目审查需要）。

    审查员权限判断在单次请求内缓存到 user 对象上，避免多个接口重复查询。

    Args:
        user: 当前请求用户

    Returns:
        可见项目的 id 子查询集
    """
    # 审查员（拥有 release.audit 权限）可查看全部项目（单次请求内缓存）
    if not hasattr(user, "_is_auditor"):
        user._is_auditor = user.user_roles.filter(
            role__permissions__code="release.audit"
        ).exists()
    if user._is_auditor:
        return Project.objects.values("id")
    member_ids = ProjectMember.objects.filter(user=user).values("project_id")
    return Project.objects.filter(Q(leader=user) | Q(id__in=member_ids)).values("id")
