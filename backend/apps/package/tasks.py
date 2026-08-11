"""
系统内置打包 Celery 任务
"""
from celery import shared_task

from apps.package.models import PackageTask
from apps.package.services import PackageService


@shared_task(bind=True)
def run_package_task(self, task_id: str) -> dict:
    """执行单个打包任务（经节点并发闸门，槽位不足时排队重投）。"""
    try:
        task = PackageTask.objects.select_related(
            "config", "release", "project", "repository", "triggered_by",
        ).get(id=task_id)
    except PackageTask.DoesNotExist:
        return {"status": "not_found"}

    PackageService.run_task_with_gate(task)
    task.refresh_from_db()
    return {"status": task.status}

