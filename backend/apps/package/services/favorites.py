"""
打包配置收藏：切换收藏与收藏列表聚合
"""
from django.db.models import OuterRef, Subquery

from apps.package.models import PackageConfig, PackageConfigFavorite, PackageTask


class FavoriteMixin:
    """打包配置收藏相关方法。"""

    @staticmethod
    def toggle_favorite(config: PackageConfig, user) -> bool:
        """切换收藏状态：已收藏则取消，未收藏则创建。

        Returns:
            切换后的收藏状态（True 表示已收藏）
        """
        favorite, created = PackageConfigFavorite.objects.get_or_create(user=user, config=config)
        # 竞态说明：双击并发时 create/delete 不在同一事务，最终状态可能与先返回的响应相反；
        # 概率极低且仅影响星标状态（前端以最后一次响应为准），接受该竞态
        if not created:
            favorite.delete()
        return created

    @staticmethod
    def list_favorite_configs(user) -> list[dict]:
        """当前用户收藏的打包配置列表（按收藏时间倒序）。

        收藏即授权入口，不再按配置项目可见性过滤；配置删除后收藏级联消失。
        每条附带该配置最近一次任务（last_task，无任务时为 None）。
        通过 Subquery 取最近任务 id 后一次性回表，避免 N+1。
        """
        last_task_id_sq = Subquery(
            PackageTask.objects.filter(config_id=OuterRef("config_id"))
            # 次级排序键保证相同 created_at 时结果确定
            .order_by("-created_at", "-id")
            .values("id")[:1]
        )
        favorites = (
            PackageConfigFavorite.objects.filter(user=user)
            .select_related("config__project", "config__repository", "config__image", "config__node")
            .annotate(_last_task_id=last_task_id_sq)
            .order_by("-created_at")
        )
        task_ids = [fav._last_task_id for fav in favorites if fav._last_task_id]
        task_map = {task.id: task for task in PackageTask.objects.filter(id__in=task_ids)}

        items: list[dict] = []
        for fav in favorites:
            config = fav.config
            task = task_map.get(fav._last_task_id)
            items.append({
                "id": str(config.id),
                "name": config.name,
                "project_id": str(config.project_id),
                "project_name": config.project.name if config.project else "",
                "repository_id": str(config.repository_id),
                "repository_name": config.repository.name if config.repository else "",
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
