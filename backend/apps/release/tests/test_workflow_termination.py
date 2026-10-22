"""发布发起人任意运行节点终止、权限与审批并发回归。"""
from types import SimpleNamespace

import pytest
from rest_framework import serializers
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import ProjectMember
from apps.release.models import ReleaseRecord
from apps.system.models import OperationLog
from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask
from apps.workflow.services import WorkflowEngine
from utils.provider.base import TagInfo

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def flow(user, project, repository, mock_git_provider, monkeypatch):
    """使用生产创建/生成/提审接口，只替换 GitLab 外部边界。"""
    reviewer = User.objects.create_user(username="termination_reviewer")
    ProjectMember.objects.create(project=project, user=reviewer, role="developer")
    remote = mock_git_provider
    commits = remote.list_commits(repository.external_identity, "develop")
    commits[0].hash = "a" * 40
    monkeypatch.setattr(remote, "list_commits", lambda *args, **kwargs: commits)

    def create_tag(repo_identity, tag_name, commit_hash, message=""):
        tag = TagInfo(name=tag_name, commit_hash=commit_hash, message=message)
        remote.tags.append(tag)
        return tag

    monkeypatch.setattr(remote, "create_tag", create_tag)
    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: remote)
    WorkflowDefinition.objects.create(
        project=project, repository=repository, name="多节点正式审批", release_type="formal",
        node_config=[{
            "node_id": f"approval_{index}", "node_name": f"第 {index} 轮确认", "mode": "any",
            "approvers": [{"type": "user", "user_id": str(reviewer.id)}],
        } for index in range(1, 4)],
    )
    api = APIClient()
    api.force_authenticate(user)
    created = api.post("/api/releases/", {
        "project": str(project.id), "repository": str(repository.id), "release_type": "formal",
        "branch": "develop", "package_config_ids": [],
    }, format="json")
    assert created.status_code == 201, created.data
    release = ReleaseRecord.objects.get(pk=created.data["data"]["id"])
    assert api.post(f"/api/releases/{release.id}/generate-doc/").status_code == 200
    submitted = api.post(f"/api/releases/{release.id}/submit-audit/")
    assert submitted.status_code == 200, submitted.data
    release.refresh_from_db()
    return SimpleNamespace(api=api, user=user, reviewer=reviewer, project=project, release=release,
                           instance=release.workflow_instance, remote=remote)


def approve_next(flow):
    """审批当前真实待办，不伪造节点状态。"""
    task = WorkflowTask.objects.get(instance=flow.instance, status="pending")
    flow.api.force_authenticate(flow.reviewer)
    response = flow.api.post(f"/api/workflow/tasks/{task.id}/approve/", {"comment": "确认"}, format="json")
    assert response.status_code == 200, response.data


@pytest.mark.parametrize("approved_nodes", [0, 1, 2])
def test_initiator_terminates_at_any_running_node(flow, approved_nodes):
    for _ in range(approved_nodes):
        approve_next(flow)
    stale_task = WorkflowTask.objects.select_related("instance").get(instance=flow.instance, status="pending")
    approved_ids = set(flow.instance.tasks.filter(status="approved").values_list("id", flat=True))
    flow.api.force_authenticate(flow.user)
    detail = flow.api.get(f"/api/workflow/instances/{flow.instance.id}/")
    assert detail.data["data"]["can_revoke"] is True
    response = flow.api.post(f"/api/workflow/instances/{flow.instance.id}/revoke/")
    assert response.status_code == 200, response.data
    assert response.data["data"]["status"] == "revoked"
    assert response.data["data"]["can_revoke"] is False
    assert not any(task["can_act"] for task in response.data["data"]["tasks"])
    flow.release.refresh_from_db()
    assert flow.release.status == "draft" and flow.release.workflow_instance is None
    assert not flow.release.version_claims.exists()
    assert not flow.instance.tasks.filter(status="pending").exists()
    assert set(flow.instance.tasks.filter(status="approved").values_list("id", flat=True)) == approved_ids
    assert flow.instance.tasks.filter(status="revoked").count() == 1
    assert OperationLog.objects.filter(action="revoke", resource_id=str(flow.instance.id), user=flow.user).exists()
    assert not flow.remote.tags
    with pytest.raises(serializers.ValidationError, match="已处理|已结束"):
        WorkflowEngine.process_task(stale_task, "approve")
    flow.api.force_authenticate(flow.reviewer)
    assert flow.api.get("/api/workflow/tasks/todo/").data["data"]["total"] == 0
    flow.api.force_authenticate(flow.user)
    assert flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/").status_code == 200
    flow.release.refresh_from_db()
    assert flow.release.workflow_instance_id != flow.instance.id
    assert WorkflowInstance.objects.get(pk=flow.instance.id).status == "revoked"


def test_non_initiator_cannot_terminate(flow):
    flow.api.force_authenticate(flow.reviewer)
    assert flow.api.get(f"/api/workflow/instances/{flow.instance.id}/").data["data"]["can_revoke"] is False
    assert flow.api.post(f"/api/workflow/instances/{flow.instance.id}/revoke/").status_code == 400
    flow.release.refresh_from_db()
    assert flow.release.status == "pending"
    assert flow.instance.tasks.filter(status="pending").exists()


@pytest.mark.parametrize("status", ["completed", "rejected", "revoked"])
def test_finished_instances_cannot_terminate(flow, status):
    flow.instance.status = status
    flow.instance.save(update_fields=["status"])
    response = flow.api.post(f"/api/workflow/instances/{flow.instance.id}/revoke/")
    assert response.status_code == 400, response.data
    assert "已结束" in response.data["message"]
    flow.release.refresh_from_db()
    assert flow.release.status == "pending"


@pytest.mark.parametrize("first", ["approve", "terminate"])
def test_postgresql_final_approval_and_termination_are_serialized(flow, monkeypatch, first):
    """最后一名审批人与发起人同时操作，只有先取得锁的一方能决定终态。"""
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, current_thread

    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("审批与终止竞争需要 PostgreSQL 行锁")
    approve_next(flow)
    approve_next(flow)
    task = WorkflowTask.objects.get(instance=flow.instance, status="pending")
    locked, resume, second_started, second_finished = Event(), Event(), Event(), Event()
    original = WorkflowEngine._lock_instance

    def pause(instance):
        instance = original(instance)
        if current_thread().name.startswith("first-action"):
            locked.set()
            assert resume.wait(10), "未恢复首个操作"
        return instance

    monkeypatch.setattr(WorkflowEngine, "_lock_instance", staticmethod(pause))

    def request(action, second=False):
        close_old_connections()
        api = APIClient()
        api.force_authenticate(flow.reviewer if action == "approve" else flow.user)
        try:
            if second:
                second_started.set()
            path = f"tasks/{task.id}/approve" if action == "approve" else f"instances/{flow.instance.id}/revoke"
            return api.post(f"/api/workflow/{path}/")
        finally:
            if second:
                second_finished.set()
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="first-action") as leading, ThreadPoolExecutor(max_workers=1) as trailing:
        earlier = leading.submit(request, first)
        try:
            assert locked.wait(10)
            later = trailing.submit(request, "terminate" if first == "approve" else "approve", True)
            assert second_started.wait(10)
            assert not second_finished.wait(0.5), "后续操作没有等待实例锁"
        finally:
            resume.set()
        assert earlier.result(timeout=15).status_code == 200
        assert later.result(timeout=15).status_code == 400
    flow.release.refresh_from_db()
    flow.instance.refresh_from_db()
    assert flow.release.status == ("released" if first == "approve" else "draft")
    assert flow.instance.status == ("completed" if first == "approve" else "revoked")
    assert len(flow.remote.tags) == (1 if first == "approve" else 0)
