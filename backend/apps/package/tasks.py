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


@shared_task
def cleanup_expired_package_artifacts() -> dict:
    """每天 8:00 删除超过保留天数的打包产物（仅 artifacts，日志保留）。"""
    from apps.package.services.cleanup import cleanup_expired_artifacts

    return cleanup_expired_artifacts()


@shared_task
def cleanup_remote_node_workspaces() -> dict:
    """每天 0:00 清理远程 Windows 节点上残留的打包任务目录（跳过运行中任务）。"""
    from apps.package.services.cleanup import cleanup_remote_node_workspaces

    return cleanup_remote_node_workspaces()

