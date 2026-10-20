"""
打包配置收藏：切换收藏与收藏列表聚合
"""
from typing import TYPE_CHECKING

from django.db import transaction
from django.db.models import OuterRef, Subquery
from rest_framework.exceptions import PermissionDenied

from apps.package.models import PackageConfig, PackageConfigFavorite, PackageTask
from apps.project.services import visible_project_ids

if TYPE_CHECKING:
    from apps.account.models import User


class FavoriteMixin:
    """打包配置收藏相关方法。"""

    @staticmethod
    @transaction.atomic
    def toggle_favorite(config: PackageConfig, user: "User") -> bool:
        """切换收藏状态：已收藏则取消，未收藏则创建。

        Returns:
            切换后的收藏状态（True 表示已收藏）
        """
        from utils.permissions import ProjectRolePermission

        # 配置可能在视图验权后改归属；读取当前配置并锁住，按当前有效角色再次授权。
        config = PackageConfig.objects.select_for_update().get(pk=config.pk)
        project = config.project_component.project
        permission = ProjectRolePermission()
        if not permission._check(project, user) or (
            not user.is_superuser and permission._effective_role(project, user) == "maintainer"
        ):
            raise PermissionDenied("维保人员或非项目成员不能切换打包配置收藏")
        favorite, created = PackageConfigFavorite.objects.get_or_create(user=user, config=config)
        if not created:
            favorite.delete()
        return created

    @staticmethod
    def list_favorite_configs(user) -> list[dict]:
        """当前用户收藏的打包配置列表（按收藏时间倒序）。

        收藏保留个人偏好，读取仍要求项目可见；配置删除后收藏级联消失。
        每条附带该配置最近一次任务（last_task，无任务时为 None）。
        通过 Subquery 取最近任务 id 后一次性回表，避免 N+1。
        """
        last_task_id_sq = Subquery(
            PackageTask.objects.filter(config_id=OuterRef("config_id"), project_id__in=visible_project_ids(user))
            # 次级排序键保证相同 created_at 时结果确定
            .order_by("-created_at", "-id")
            .values("id")[:1]
        )
        favorites = (
            PackageConfigFavorite.objects.filter(user=user, config__project_component__project_id__in=visible_project_ids(user))
            .select_related(
                "config__project_component__project",
                "config__project_component__repository",
                "config__image",
                "config__node",
            )
            .annotate(_last_task_id=last_task_id_sq)
            .order_by("-created_at")
        )
        task_ids = [fav._last_task_id for fav in favorites if fav._last_task_id]
        task_map = {task.id: task for task in PackageTask.objects.filter(id__in=task_ids)}

        items: list[dict] = []
        for fav in favorites:
            config = fav.config
            task = task_map.get(fav._last_task_id)
            component = config.project_component
            items.append({
                "id": str(config.id),
                "name": config.name,
                "project_id": str(component.project_id),
                "project_name": component.project.name if component.project else "",
                "repository_id": str(component.repository_id),
                "repository_name": component.repository.name if component.repository else "",
                "executor_type": config.executor_type,
                "executor_type_display": config.get_executor_type_display(),
                "image_name": config.image.name if config.image else "",
                "node_name": config.node.name if config.node else "",
                "favorited_at": fav.created_at,
                "last_task": {
                    "id": str(task.id),
                    "status": task.status,
                    "status_display": task.get_status_display(),
                    "version": task.version,
                    "finished_at": task.finished_at,
                    "duration": task.duration,
                } if task else None,
            })
        return items
