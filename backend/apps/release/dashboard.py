"""维保工作台只读摘要，所有聚合限定在显式可见项目内。"""

import re
from collections import Counter
from datetime import timedelta
from html import unescape
from typing import Any

from django.db.models import Count, Q
from django.utils import timezone
from django.utils.html import strip_tags

from apps.account.models import User
from apps.package.models import PackageTask
from apps.project.models import Project, ProjectComponent
from apps.project.services import visible_project_ids
from apps.release.models import ReleaseRecord
from utils.markdown_table import table_newlines_to_br


def release_update_summary(release: ReleaseRecord) -> str:
    """从保存的说明提取更新段落；仅压缩列表预览，完整文档保持原样。"""
    doc = release.release_doc or ""
    lines = []
    collecting = False
    for line in table_newlines_to_br(doc).splitlines():
        row = re.match(r"^\s*\|\s*([^|]+?)\s*\|(.*)$", line)
        if row:
            collecting = any(word in row[1] for word in ("更新内容", "变更内容", "功能更新", "修复内容"))
            if collecting:
                lines.append(re.sub(r"(?<!\\)\|\s*$", "", row[2]))
        elif collecting:
            # 人工编辑可能把更新值首行留空，仍按已有表格的续行语义读取。
            lines.append(re.sub(r"(?<!\\)\|\s*$", "", line))
    if not lines:
        lines = [str(item.get("content", "")) for item in release.updates or [] if isinstance(item, dict)]
    if not any(lines):
        lines = [line for line in doc.splitlines() if line.strip() and not line.lstrip().startswith(("#", "|"))]
    text = re.sub(r"<br\s*/?>", "；", "；".join(lines), flags=re.IGNORECASE)
    text = unescape(strip_tags(text))
    text = re.sub(r"!?\[([^\]]+)\]\([^)]*\)", r"\1", text)
    return re.sub(r"\s+", " ", text.replace("**", "").replace("`", "").replace("\\|", "|")).strip("； ")[:300]


def release_package_summary(release: ReleaseRecord) -> dict[str, Any]:
    """分别取每份配置的最近任务，失败配置不能被其他配置的成功掩盖。"""
    latest = {}
    tasks = sorted(release.package_tasks.all(), key=lambda item: (item.created_at, str(item.id)), reverse=True)
    for task in tasks:
        if task.project_id != release.project_id or task.repository_id != release.repository_id:
            continue
        latest.setdefault(str(task.config_id or (task.config_snapshot or {}).get("config_id") or task.id), task)
    counts = dict(Counter(task.status for task in latest.values()))
    status = next((state for state in ("failure", "running", "queued", "success", "canceled") if counts.get(state)), "none")
    target = next((task for task in latest.values() if task.status == status), None)
    return {"status": status, "counts": counts, "config_count": len(latest), "task_id": str(target.id) if target else None}


class MaintainerDashboardService:
    """为首页提供不受主列表筛选影响的所属项目总览。"""

    @staticmethod
    def summary(user: User) -> dict[str, Any]:
        projects = list(Project.objects.filter(id__in=visible_project_ids(user)).order_by("name", "id"))
        project_ids = [project.id for project in projects]
        releases = ReleaseRecord.objects.filter(project_id__in=project_ids, status="released")
        tasks = PackageTask.objects.filter(project_id__in=project_ids)
        now = timezone.now()
        since = now - timedelta(days=30)
        samples = tasks.filter(created_at__gte=since, created_at__lte=now, status__in=("success", "failure", "canceled"))
        counts = samples.aggregate(total=Count("id"), success=Count("id", filter=Q(status="success")))
        release_counts = {(row["project_id"], row["repository_id"]): row["count"] for row in releases.order_by()
                          .values("project_id", "repository_id").annotate(count=Count("id"))}
        names = {}
        software = {project.id: [] for project in projects}
        for component in ProjectComponent.objects.filter(project_id__in=project_ids).select_related("repository").order_by("sort_order", "created_at", "id"):
            key = (component.project_id, component.repository_id)
            if key in names:
                continue
            names[key] = component.display_name or component.repository.name
            software[component.project_id].append({"id": str(component.repository_id), "name": names[key],
                                                   "release_count": release_counts.get(key, 0)})

        def task_data(task: PackageTask) -> dict[str, Any]:
            return {"id": str(task.id), "name": task.name, "project": str(task.project_id),
                    "project_name": task.project.name, "component_name": names.get((task.project_id, task.repository_id), task.repository.name),
                    "version": task.version, "status": task.status, "status_display": task.get_status_display(),
                    "created_at": task.created_at, "started_at": task.started_at, "finished_at": task.finished_at,
                    "duration": task.duration, "error_message": task.error_message,
                    "artifact_count": len(task.artifact_info or []),
                    "trigger_source": (task.config_snapshot or {}).get("trigger_source", ""),
                    }

        ordered_tasks = tasks.select_related("project", "repository").order_by("-created_at", "-id")
        return {
            "stats": {"days": 30, "since": since, "until": now,
                      "released_count": releases.filter(released_at__gte=since, released_at__lte=now).count(),
                      "failed_task_count": tasks.filter(status="failure").count(),
                      "package_total": counts["total"], "package_success": counts["success"],
                      "package_success_rate": round(counts["success"] / counts["total"] * 100, 1) if counts["total"] else None},
            "projects": [{"id": str(project.id), "name": project.name, "software": software[project.id],
                          "release_count": sum(value for (project_id, _), value in release_counts.items() if project_id == project.id)}
                         for project in projects],
            "software_count": len(names),
            "recent_tasks": [task_data(task) for task in ordered_tasks[:3]],
        }
