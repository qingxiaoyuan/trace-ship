"""审批列表状态展示的隔离样本，不执行审批或外部发布。"""


def create_workflow_status_samples(project, repository, owner) -> list[dict]:
    """覆盖流程终态、运行中的人工/AI 节点及个人已办。"""
    from django.utils import timezone

    from apps.account.models import User
    from apps.project.models import ProjectMember
    from apps.release.models import ReleaseRecord
    from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask

    definition = WorkflowDefinition.objects.get(repository=repository, release_type="formal")
    samples = []
    now = timezone.now()
    for index, (state, name) in enumerate([
        ("completed", "已完成"), ("rejected", "已驳回"), ("revoked", "已终止"),
        ("returned", "已退回修改"), ("running", "审批中"), ("running", "审批中"),
    ], start=1):
        version = f"VA.76.0.{index}"
        release = ReleaseRecord.objects.create(
            project=project, repository=repository, publisher=owner, release_type="formal",
            version=version, tag_name=version + "_status", branch="main", git_hash="c" * 40,
            status={"completed": "released", "rejected": "rejected", "running": "pending"}.get(state, "draft"),
            release_doc="审批列表虚构状态样本",
        )
        node_id = f"approval_internal_{index}"
        node_name = "AI 代码审查" if index == 6 else "技术负责人审批"
        instance = WorkflowInstance.objects.create(
            definition=definition, biz_type="release", biz_id=str(release.id), source_project=project,
            created_by=owner, status=state, current_node_id=node_id,
            node_config_snapshot=[{"node_id": node_id, "node_name": node_name,
                                   "node_type": "ai_review" if index == 6 else "approval",
                                   "approvers": [{"type": "user", "user_id": str(owner.id)}]}],
        )
        if state in ("completed", "rejected", "running"):
            release.workflow_instance = instance
            release.save(update_fields=["workflow_instance"])
        if index != 6:
            WorkflowTask.objects.create(
                instance=instance, node_id=node_id, node_name=node_name, approver=owner,
                status={"completed": "approved", "rejected": "rejected", "running": "pending"}.get(state, state),
                action_time=now if state != "running" else None,
            )
        if state == "completed":
            for number, nickname in enumerate(["审核负责人", "测试软件管理员", "软件质量验证负责人及专项测试审批人员"]):
                reviewer = User.objects.create_user(username=f"smoke_reviewer_{number}", nickname=nickname)
                ProjectMember.objects.create(project=project, user=reviewer, role="tester")
                comment = "" if number != 2 else (
                    "同意发布。\n请在发布后关注服务运行情况，并核对审批中的配置说明。"
                    "回归验证已完成，详细记录：review-check-" + "a" * 100
                )
                WorkflowTask.objects.create(
                    instance=instance, node_id=node_id, node_name=node_name, approver=reviewer,
                    status="approved", comment=comment, action_time=now,
                )
        samples.append({"id": str(instance.id), "release_id": str(release.id), "version": version, "title": f"审批发布 {version}", "state": state,
                        "label": name, "node": node_name if state == "running" else ""})
    return samples
