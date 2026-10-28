"""工作流异步任务。"""
from celery import shared_task


@shared_task
def execute_ai_review(instance_id: str, node_id: str, expected_token: str | None = None) -> None:
    from apps.workflow.ai_review import execute_review

    if expected_token is None:
        # 兼容升级前已投递的任务，但不能让旧消息接管已经重试的节点。
        from apps.workflow.models import AIReviewRun

        run = AIReviewRun.objects.filter(instance_id=instance_id, node_id=node_id).first()
        if not run or run.history:
            return
        expected_token = str(run.token)
    execute_review(instance_id, node_id, expected_token)
