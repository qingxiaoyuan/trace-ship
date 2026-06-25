"""
项目业务服务

封装项目创建者自动加入项目等逻辑。
"""
from django.db import transaction
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
