"""工作流异步任务。"""
from celery import shared_task


@shared_task
def execute_ai_review(instance_id: str, node_id: str) -> None:
    from apps.workflow.ai_review import execute_review

    execute_review(instance_id, node_id)
