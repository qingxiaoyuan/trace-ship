"""
全局聚合搜索服务

供工作台命令面板调用（GET /api/search/?q=），按关键词分组搜索
项目 / 仓库 / 发布 / 审批单 / 打包任务，每组最多返回 5 条。
"""
from __future__ import annotations

import uuid

from django.db.models import Count, Q

from apps.workflow.services import visible_workflow_instances


class GlobalSearchService:
    """
    全局聚合搜索

    数据可见范围与各业务列表页同口径：超管全量；其他用户仅可见
    有显式 ProjectMember 记录的项目，仓库按 ProjectComponent 组件
    关联单路径判断。审批单额外包含「本人是审批人」的实例，
    以便指定人员即使不是项目成员也能搜到并打开深链。
    """

    PER_GROUP_LIMIT = 5

    @classmethod
    def search(cls, user, q: str) -> dict[str, list[dict]]:
        """
        聚合搜索入口

        Args:
            user: 当前登录用户
            q: 搜索关键词，长度不足 1 时各组返回空数组

        Returns:
            {projects, repositories, releases, workflows, packages} 五组结果，
            每条为 {id, name, subtitle, path}
        """
        q = (q or "").strip()
        empty: dict[str, list[dict]] = {
            "projects": [],
            "repositories": [],
            "releases": [],
            "workflows": [],
            "packages": [],
        }
        if len(q) < 1:
            return empty

        from apps.project.services import visible_project_ids, visible_repository_ids

        project_ids = None if user.is_superuser else visible_project_ids(user)
        repo_ids = None if user.is_superuser else visible_repository_ids(user)

        return {
            "projects": cls._search_projects(q, project_ids),
            "repositories": cls._search_repositories(q, repo_ids),
            "releases": cls._search_releases(q, project_ids),
            "workflows": cls._search_workflows(user, q),
            "packages": cls._search_packages(q, project_ids),
        }

    @classmethod
    def _search_projects(cls, q: str, project_ids) -> list[dict]:
        """项目：名称模糊匹配，副标题为「N 个仓库 · N 名成员」"""
        from apps.project.models import Project

        queryset = (
            Project.objects.filter(name__icontains=q)
            .annotate(
                repo_count=Count("project_components", filter=Q(project_components__is_active=True), distinct=True),
                member_count=Count("members", distinct=True),
            )
            .order_by("name")
        )
        if project_ids is not None:
            queryset = queryset.filter(id__in=project_ids)
        return [
            {
                "id": str(project.id),
                "name": project.name,
                "subtitle": f"{project.repo_count} 个仓库 · {project.member_count} 名成员",
                "path": f"/projects/{project.id}",
            }
            for project in queryset[: cls.PER_GROUP_LIMIT]
        ]

    @classmethod
    def _search_repositories(cls, q: str, repo_ids) -> list[dict]:
        """仓库：名称 / 地址模糊匹配，副标题为「平台 · 默认分支」"""
        from apps.repository.models import Repository

        queryset = Repository.objects.filter(Q(name__icontains=q) | Q(url__icontains=q)).order_by("name")
        if repo_ids is not None:
            queryset = queryset.filter(id__in=repo_ids)
        return [
            {
                "id": str(repo.id),
                "name": repo.name,
                "subtitle": f"{repo.get_vendor_display()} · {repo.default_branch}",
                "path": f"/repositories/{repo.id}",
            }
            for repo in queryset[: cls.PER_GROUP_LIMIT]
        ]

    @classmethod
    def _search_releases(cls, q: str, project_ids) -> list[dict]:
        """发布：版本号 / Tag 模糊匹配，副标题为「项目 / 仓库 · 状态」"""
        from apps.release.models import ReleaseRecord

        queryset = (
            ReleaseRecord.objects.select_related("project", "repository")
            .filter(Q(version__icontains=q) | Q(tag_name__icontains=q))
            .order_by("-created_at")
        )
        if project_ids is not None:
            queryset = queryset.filter(project_id__in=project_ids)
        return [
            {
                "id": str(release.id),
                "name": f"{release.version}（{release.get_release_type_display()}）",
                "subtitle": f"{release.project.name} / {release.repository.name} · {release.get_status_display()}",
                "path": f"/releases/{release.id}",
            }
            for release in queryset[: cls.PER_GROUP_LIMIT]
        ]

    @classmethod
    def _search_workflows(cls, user, q: str) -> list[dict]:
        """审批单：按关联发布的版本号匹配；一次查出发布映射，避免逐条回查。"""
        from apps.release.models import ReleaseRecord

        release_rows = list(
            ReleaseRecord.objects.filter(Q(version__icontains=q) | Q(tag_name__icontains=q))
            .values_list("id", "version")[:500]
        )
        if not release_rows:
            return []

        version_by_id = {str(pk): version for pk, version in release_rows}
        release_ids = list(version_by_id.keys())

        queryset = (
            visible_workflow_instances(user)
            .select_related("definition")
            .prefetch_related("tasks")
            .filter(biz_type="release", biz_id__in=release_ids)
            .order_by("-created_at")
        )

        results = []
        for instance in queryset[: cls.PER_GROUP_LIMIT]:
            version = version_by_id.get(str(instance.biz_id))
            pending_task = next((t for t in instance.tasks.all() if t.status == "pending"), None)
            current_node = pending_task.node_name if pending_task else instance.current_node_id
            results.append(
                {
                    "id": str(instance.id),
                    "name": f"审批发布 {version}" if version else instance.definition.name,
                    "subtitle": f"{instance.get_status_display()} · 当前节点 {current_node}",
                    "path": f"/workflows/{instance.id}",
                }
            )
        return results

    @classmethod
    def _search_packages(cls, q: str, project_ids) -> list[dict]:
        """打包任务：任务名 / 配置名 / 任务 ID 匹配，副标题为「仓库 · 状态」"""
        from apps.package.models import PackageTask

        condition = Q(name__icontains=q) | Q(config__name__icontains=q)
        try:
            condition |= Q(id=uuid.UUID(q))
        except (ValueError, AttributeError):
            pass

        queryset = (
            PackageTask.objects.select_related("config", "repository")
            .filter(condition)
            .order_by("-created_at")
        )
        if project_ids is not None:
            queryset = queryset.filter(project_id__in=project_ids)
        return [
            {
                "id": str(task.id),
                "name": task.name,
                "subtitle": f"{task.repository.name if task.repository else '-'} · {task.get_status_display()}",
                "path": f"/packages/{task.id}",
            }
            for task in queryset[: cls.PER_GROUP_LIMIT]
        ]
