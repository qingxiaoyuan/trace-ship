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


def visible_project_ids(user):
    """
    用户可见的项目 ID 查询集

    项目成员或项目负责人（leader 视为隐含成员）均可见，
    供各业务视图的 get_queryset 统一过滤使用。

    Args:
        user: 当前请求用户

    Returns:
        可见项目的 id 子查询集
    """
    member_ids = ProjectMember.objects.filter(user=user).values("project_id")
    return Project.objects.filter(Q(leader=user) | Q(id__in=member_ids)).values("id")
