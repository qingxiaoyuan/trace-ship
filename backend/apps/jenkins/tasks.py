"""
Jenkins Celery 任务

提供异步轮询 Jenkins 构建状态的任务。
"""
from celery import shared_task

from apps.jenkins.models import JenkinsBuild
from apps.jenkins.services import JenkinsService


@shared_task(bind=True, max_retries=360, default_retry_delay=10)
def poll_jenkins_build(self, build_id: str) -> dict:
    """
    轮询 Jenkins 构建状态

    每 10 秒查询一次，最多持续约 1 小时。构建结束后回写 ReleaseRecord 状态。

    Args:
        self: Celery task 实例
        build_id: JenkinsBuild UUID 字符串

    Returns:
        最终状态字典
    """
    try:
        build = JenkinsBuild.objects.get(id=build_id)
    except JenkinsBuild.DoesNotExist:
        return {"status": "not_found"}

    if build.is_finished:
        return {"status": build.status}

    JenkinsService.refresh_build_status(build)
    build.refresh_from_db()

    if build.is_finished:
        return {"status": build.status}

    # 未结束则继续轮询
    raise self.retry(countdown=10)
