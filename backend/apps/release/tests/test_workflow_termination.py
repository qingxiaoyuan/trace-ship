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


def test_submitted_workflow_keeps_approvers_and_nodes_after_definition_edit(flow):
    """已提交的流程使用提交时审批链；后续修改仅影响下次提审。"""
    definition = flow.instance.definition
    definition.node_config = [{
        "node_id": "replacement", "node_name": "新的审批", "mode": "any",
        "approvers": [{"type": "user", "user_id": str(flow.user.id)}],
    }]
    definition.save(update_fields=["node_config"])
    approve_next(flow)
    second = flow.instance.tasks.get(status="pending")
    assert second.node_id == "approval_2"
    assert second.approver_id == flow.reviewer.id
    approve_next(flow)
    third = flow.instance.tasks.get(status="pending")
    assert third.node_id == "approval_3"
    approve_next(flow)
    flow.release.refresh_from_db()
    assert flow.release.status == "released"


def test_release_workflow_history_distinguishes_current_and_restricts_visibility(flow):
    """重提后同一申请的当前与历史流程可追溯，项目外人员不可查看。"""
    assert flow.api.post(f"/api/workflow/instances/{flow.instance.id}/revoke/").status_code == 200
    assert flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/").status_code == 200
    flow.release.refresh_from_db()
    params = {"biz_type": "release", "biz_id": str(flow.release.id)}
    history = flow.api.get("/api/workflow/instances/", params).data["data"]["results"]
    by_id = {item["id"]: item for item in history}
    assert by_id[str(flow.instance.id)]["is_current"] is False
    assert by_id[str(flow.release.workflow_instance_id)]["is_current"] is True
    assert by_id[str(flow.instance.id)]["status"] == "revoked"
    outsider = User.objects.create_user(username="history_outsider")
    flow.api.force_authenticate(outsider)
    assert flow.api.get("/api/workflow/instances/", params).data["data"]["results"] == []
    assert flow.api.get(f"/api/workflow/instances/{flow.instance.id}/").status_code == 404


def test_resubmitted_workflow_uses_new_definition(flow):
    """终止后重新提交使用届时配置，原审批历史仍保留。"""
    definition = flow.instance.definition
    definition.node_config = [{
        "node_id": "new", "node_name": "新审批", "mode": "any",
        "approvers": [{"type": "user", "user_id": str(flow.user.id)}],
    }]
    definition.save(update_fields=["node_config"])
    assert flow.api.post(f"/api/workflow/instances/{flow.instance.id}/revoke/").status_code == 200
    assert flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/").status_code == 200
    flow.release.refresh_from_db()
    new = flow.release.workflow_instance
    assert new.id != flow.instance.id
    task = new.tasks.get(status="pending")
    assert task.node_id == "new" and task.approver_id == flow.user.id
    assert flow.instance.tasks.filter(status="revoked").exists()


def test_submitted_workflow_keeps_resolved_role_approver_after_membership_change(flow):
    """提审时解析角色成员，后续成员变动不会悄悄改变本轮审批人。"""
    assert flow.api.post(f"/api/workflow/instances/{flow.instance.id}/revoke/").status_code == 200
    definition = flow.instance.definition
    definition.node_config = [{
        "node_id": f"role_{index}", "node_name": f"角色审批 {index}", "mode": "any",
        "approvers": [{"type": "role", "role": "developer"}],
    } for index in (1, 2)]
    definition.save(update_fields=["node_config"])
    assert flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/").status_code == 200
    flow.release.refresh_from_db()
    new = flow.release.workflow_instance
    assert new.tasks.get(status="pending").approver_id == flow.reviewer.id
    ProjectMember.objects.filter(project=flow.project, user=flow.reviewer).delete()
    flow.api.force_authenticate(flow.reviewer)
    first = new.tasks.get(status="pending")
    assert flow.api.post(f"/api/workflow/tasks/{first.id}/approve/").status_code == 200
    assert new.tasks.get(status="pending").approver_id == flow.reviewer.id


def test_disabled_snapshot_approver_cannot_be_silently_skipped(flow):
    """后续会签人员停用时阻止推进，不得缩减原审批人数。"""
    assert flow.api.post(f"/api/workflow/instances/{flow.instance.id}/revoke/").status_code == 200
    second = User.objects.create_user(username="snapshot_second")
    definition = flow.instance.definition
    definition.node_config = [
        {"node_id": "one", "node_name": "第一节点", "mode": "any",
         "approvers": [{"type": "user", "user_id": str(flow.reviewer.id)}]},
        {"node_id": "two", "node_name": "第二节点", "mode": "all",
         "approvers": [{"type": "user", "user_id": str(flow.reviewer.id)},
                       {"type": "user", "user_id": str(second.id)}]},
    ]
    definition.save(update_fields=["node_config"])
    assert flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/").status_code == 200
    flow.release.refresh_from_db()
    new = flow.release.workflow_instance
    second.is_active = False
    second.save(update_fields=["is_active"])
    flow.api.force_authenticate(flow.reviewer)
    first = new.tasks.get(status="pending")
    response = flow.api.post(f"/api/workflow/tasks/{first.id}/approve/")
    assert response.status_code == 400, response.data
    assert "审批人" in response.data["message"]
    new.refresh_from_db()
    first.refresh_from_db()
    assert new.status == "running" and new.current_node_id == "one" and first.status == "pending"


def test_deleted_draft_history_retains_project_visibility(flow):
    """删除草稿后历史仍可读取，不会因共享仓库扩大到其他项目。"""
    from apps.project.models import Project, ProjectComponent

    assert flow.api.post(f"/api/workflow/instances/{flow.instance.id}/revoke/").status_code == 200
    flow.instance.definition.project = None
    flow.instance.definition.save(update_fields=["project"])
    assert flow.api.delete(f"/api/releases/{flow.release.id}/").status_code == 200
    detail = flow.api.get(f"/api/workflow/instances/{flow.instance.id}/")
    assert detail.status_code == 200
    assert detail.data["data"]["project_name"] == flow.project.name
    other = User.objects.create_user(username="other_project_member")
    project = Project.objects.create(code="OTHER_HISTORY", name="其他项目", leader=other, status=1)
    ProjectMember.objects.create(project=project, user=other, role="developer")
    ProjectComponent.objects.create(project=project, repository=flow.release.repository, component_code="shared")
    flow.api.force_authenticate(other)
    assert flow.api.get(f"/api/workflow/instances/{flow.instance.id}/").status_code == 404
    assert flow.api.get("/api/workflow/instances/").status_code == 200


def test_release_history_filter_accepts_legacy_uuid_representation(flow):
    """规范发布 ID 可查询旧数据中无连字符或大写的业务 ID。"""
    WorkflowInstance.objects.filter(pk=flow.instance.pk).update(biz_id=str(flow.release.id).replace("-", "").upper())
    response = flow.api.get("/api/workflow/instances/", {"biz_type": "release", "biz_id": str(flow.release.id)})
    assert response.status_code == 200
    assert str(flow.instance.id) in [item["id"] for item in response.data["data"]["results"]]


def test_legacy_history_does_not_leak_after_release_deleted(flow):
    """没有真实来源的旧记录不回退到共享仓库授权。"""
    from apps.project.models import Project, ProjectComponent

    WorkflowInstance.objects.filter(pk=flow.instance.pk).update(node_config_snapshot=None, source_project=None)
    assert flow.api.post(f"/api/workflow/instances/{flow.instance.id}/revoke/").status_code == 200
    assert flow.api.delete(f"/api/releases/{flow.release.id}/").status_code == 200
    other = User.objects.create_user(username="other_legacy_member")
    project = Project.objects.create(code="OTHER_LEGACY", name="其他项目", leader=other, status=1)
    ProjectMember.objects.create(project=project, user=other, role="developer")
    ProjectComponent.objects.create(project=project, repository=flow.release.repository, component_code="shared")
    flow.api.force_authenticate(other)
    assert flow.api.get(f"/api/workflow/instances/{flow.instance.id}/").status_code == 404


def test_old_nonmember_approver_cannot_read_current_release_through_history(flow):
    """旧审批分配仅授权历史实例，不能读取后来修改的申请内容。"""
    old_task = flow.instance.tasks.get(status="pending")
    assert flow.api.post(f"/api/workflow/instances/{flow.instance.id}/revoke/").status_code == 200
    ProjectMember.objects.filter(project=flow.project, user=flow.reviewer).delete()
    flow.release.release_doc = "新一轮专属发布说明"
    flow.release.branch = "private-new-branch"
    flow.release.save(update_fields=["release_doc", "branch"])
    flow.api.force_authenticate(flow.reviewer)
    detail = flow.api.get(f"/api/workflow/instances/{flow.instance.id}/")
    assert detail.status_code == 200
    assert detail.data["data"]["release_doc"] == ""
    assert detail.data["data"]["branch"] == ""
    assert detail.data["data"]["git_hash"] == ""
    task = flow.api.get(f"/api/workflow/tasks/{old_task.id}/")
    assert task.status_code == 200
    assert task.data["data"]["branch"] == ""


def test_legacy_workflow_uses_saved_graph_if_definition_changed(flow):
    """旧实例无节点快照时，使用实际保留的实例图而非篡改后的定义。"""
    WorkflowInstance.objects.filter(pk=flow.instance.pk).update(node_config_snapshot=None)
    definition = flow.instance.definition
    definition.node_config = []
    definition.save(update_fields=["node_config"])
    approve_next(flow)
    second = flow.instance.tasks.get(status="pending")
    assert second.node_id == "approval_2" and second.approver_id == flow.reviewer.id


def _legacy_graph(reviewer):
    """按早期 LogicFlow 格式构造乱序节点与有序边。"""
    return {
        "nodes": [
            {"id": "approval_2", "type": "approval-node", "text": {"value": "旧第二节点"},
             "properties": {"approver_type": "user", "user_id": str(reviewer.id)}},
            {"id": "end", "type": "end-node"},
            {"id": "approval_1", "type": "approval-node", "text": "旧第一节点",
             "properties": {"approver_type": "user", "user_id": str(reviewer.id)}},
            {"id": "start", "type": "start-node"},
        ],
        "edges": [
            {"source": "start", "target": "approval_1"},
            {"sourceNodeId": "approval_1", "targetNodeId": "approval_2"},
            {"source": "approval_2", "target": "end"},
        ],
    }


@pytest.mark.parametrize("style", ["early", "modern"])
def test_legacy_graph_edges_prevent_skipping_removed_approval_node(flow, style):
    """旧图按边恢复审批顺序，现行定义缩短不能让发布跳过旧节点。"""
    graph = _legacy_graph(flow.reviewer)
    if style == "modern":
        for node in graph["nodes"]:
            if node["type"] == "approval-node":
                node["properties"] = {"mode": "all", "_approvers": [
                    {"type": "user", "user_id": str(flow.reviewer.id)},
                ]}
    definition = flow.instance.definition
    definition.node_config = definition.node_config[:1]
    definition.save(update_fields=["node_config"])
    WorkflowInstance.objects.filter(pk=flow.instance.pk).update(
        node_config_snapshot=None, graph_data=graph,
    )
    approve_next(flow)
    flow.release.refresh_from_db()
    second = flow.instance.tasks.get(status="pending")
    assert second.node_id == "approval_2" and second.approver_id == flow.reviewer.id
    assert second.node_name == "旧第二节点" and second.mode == ("any" if style == "early" else "all")
    assert flow.release.status == "pending" and not flow.remote.tags
    approve_next(flow)
    flow.release.refresh_from_db()
    assert flow.release.status == "released" and len(flow.remote.tags) == 1


@pytest.mark.parametrize("damage", ["missing_end", "branch", "cycle", "disconnected", "duplicate_id", "missing_approver",
                                    "missing_graph", "malformed_edge", "mixed_alias", "malformed_properties", "null_approvers", "mixed_approvers"])
def test_ambiguous_legacy_graph_cannot_advance(flow, damage):
    """旧图残缺、分叉、环或审批人不明时不能依赖现行定义推断放行。"""
    graph = _legacy_graph(flow.reviewer)
    if damage == "missing_end":
        graph["edges"].pop()
    elif damage == "branch":
        graph["edges"].append({"source": "approval_1", "target": "end"})
    elif damage == "cycle":
        graph["edges"][-1] = {"source": "approval_2", "target": "approval_1"}
    elif damage == "disconnected":
        graph["nodes"].append({"id": "other", "type": "approval-node", "properties": {"approver_type": "self"}})
    elif damage == "duplicate_id":
        graph["nodes"].append({"id": "approval_2", "type": "approval-node", "properties": {"approver_type": "self"}})
    elif damage == "missing_approver":
        graph["nodes"][0]["properties"] = {"approver_type": "user"}
    elif damage == "missing_graph":
        graph = {}
    elif damage == "malformed_edge":
        graph["edges"][0]["source"] = []
    elif damage == "mixed_alias":
        graph["edges"][0]["sourceNodeId"] = "approval_1"
    elif damage == "malformed_properties":
        graph["nodes"][0]["properties"] = []
    elif damage == "null_approvers":
        graph["nodes"][0]["properties"] = {"_approvers": None}
    elif damage == "mixed_approvers":
        graph["nodes"][0]["properties"]["_approvers"] = [{"type": "self"}]
    definition = flow.instance.definition
    definition.node_config = definition.node_config[:1]
    definition.save(update_fields=["node_config"])
    WorkflowInstance.objects.filter(pk=flow.instance.pk).update(node_config_snapshot=None, graph_data=graph)
    task = flow.instance.tasks.get(status="pending")
    flow.api.force_authenticate(flow.reviewer)
    result = flow.api.post(f"/api/workflow/tasks/{task.id}/approve/")
    assert result.status_code == 400, result.data
    assert "流程" in result.data["message"]
    task.refresh_from_db()
    flow.release.refresh_from_db()
    assert task.status == "pending" and flow.release.status == "pending" and not flow.remote.tags


def test_first_approver_returns_release_for_revision(flow):
    """首节点可退回原申请，已处理记录保留且旧待办失效。"""
    task = flow.instance.tasks.get(status="pending")
    flow.api.force_authenticate(flow.reviewer)
    result = flow.api.post(f"/api/workflow/tasks/{task.id}/return-for-revision/", {"comment": "请修复"}, format="json")
    assert result.status_code == 200, result.data
    task.refresh_from_db()
    flow.instance.refresh_from_db()
    flow.release.refresh_from_db()
    assert task.status == "returned" and task.comment == "请修复"
    assert flow.instance.status == "returned" and flow.instance.returned_by_id == flow.reviewer.id
    assert flow.release.status == "draft" and flow.release.workflow_instance_id is None
    assert flow.release.doc_needs_regeneration and flow.release.has_revision_history
    assert not flow.release.version_claims.exists()
    assert flow.api.post(f"/api/workflow/tasks/{task.id}/approve/").status_code == 400
    assert not flow.remote.tags


def test_return_preserves_approved_history_and_protects_expired_draft(flow, monkeypatch):
    """退回后旧申请与审批历史不被定时清理；重提须先重新生成说明。"""
    from django.utils import timezone

    from apps.release.tasks import cleanup_draft_releases

    approve_next(flow)
    task = flow.instance.tasks.get(status="pending")
    result = flow.api.post(f"/api/workflow/tasks/{task.id}/return-for-revision/", {"comment": "需要修改"}, format="json")
    assert result.status_code == 200, result.data
    ReleaseRecord.objects.filter(pk=flow.release.pk).update(created_at=timezone.now() - timezone.timedelta(hours=2))
    cleanup_draft_releases()
    assert ReleaseRecord.objects.filter(pk=flow.release.pk).exists()
    assert flow.instance.tasks.filter(status="approved").count() == 1
    flow.api.force_authenticate(flow.user)
    rejected = flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/")
    assert rejected.status_code == 400
    assert flow.api.post(f"/api/releases/{flow.release.id}/generate-doc/").status_code == 200
    assert flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/").status_code == 400
    commits = flow.remote.list_commits(flow.release.repository.external_identity, flow.release.branch)
    commits[0].hash = "b" * 40
    monkeypatch.setattr(flow.remote, "list_commits", lambda *args, **kwargs: commits)
    monkeypatch.setattr(flow.remote, "compare_diff", lambda *args: [], raising=False)
    preview = flow.api.get(f"/api/releases/{flow.release.id}/branch-update/")
    assert preview.status_code == 200, preview.data
    changed = flow.api.post(f"/api/releases/{flow.release.id}/branch-update/", {
        "old_hash": "a" * 40, "new_hash": "b" * 40,
    }, format="json")
    assert changed.status_code == 200, changed.data
    assert flow.api.post(f"/api/releases/{flow.release.id}/generate-doc/").status_code == 200
    submitted = flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/")
    assert submitted.status_code == 200, submitted.data
    flow.release.refresh_from_db()
    assert flow.release.workflow_instance_id != flow.instance.id
    assert flow.release.workflow_instance.tasks.get(status="pending").node_id == "approval_1"
    flow.instance.refresh_from_db()
    assert flow.instance.status == "returned"


def test_return_requires_active_current_approver_and_respects_project_role(flow):
    """非审批人、维保及只读成员不能通过直连 API 退回。"""
    task = flow.instance.tasks.get(status="pending")
    path = f"/api/workflow/tasks/{task.id}/return-for-revision/"
    flow.api.force_authenticate(flow.user)
    assert flow.api.post(path, {"comment": "越权"}, format="json").status_code == 404
    flow.api.force_authenticate(flow.reviewer)
    member = ProjectMember.objects.get(project=flow.project, user=flow.reviewer)
    for role in ("maintainer", "viewer"):
        member.role = role
        member.save(update_fields=["role"])
        result = flow.api.post(path, {"comment": "越权"}, format="json")
        assert result.status_code in (400, 403), result.data
        detail = flow.api.get(f"/api/workflow/tasks/{task.id}/")
        assert detail.data["data"]["can_return_for_revision"] is False
    member.delete()
    # 实际指定审批人不必是项目成员。
    assert flow.api.post(path, {"comment": "修复"}, format="json").status_code == 200


def test_return_cancels_unfinished_ai_and_keeps_completed_report(flow):
    """失效执行不能推进新流程，旧轮已完成报告仍可追溯。"""
    import uuid

    from apps.system.review_settings import save_settings
    from apps.workflow.ai_review import execute_review
    from apps.workflow.models import AIReviewRun

    config = save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    report = AIReviewRun.objects.create(instance=flow.instance, node_id="done-ai", settings_version=config,
        status="completed", summary="已完成", findings=[{"id": "old-finding", "reason": "证据"}])
    old_token = uuid.uuid4()
    pending = AIReviewRun.objects.create(instance=flow.instance, node_id="future-ai", settings_version=config,
        status="queued", token=old_token)
    task = flow.instance.tasks.get(status="pending")
    flow.api.force_authenticate(flow.reviewer)
    assert flow.api.post(f"/api/workflow/tasks/{task.id}/return-for-revision/", {"comment": "修复"}, format="json").status_code == 200
    pending.refresh_from_db()
    report.refresh_from_db()
    assert pending.status == "canceled" and pending.token != old_token
    assert pending.history[-1]["token"] == str(old_token) and pending.history[-1]["status"] == "queued"
    assert report.status == "completed" and report.findings[0]["id"] == "old-finding"
    execute_review(flow.instance.id, "future-ai")
    pending.refresh_from_db()
    assert pending.status == "canceled"
    flow.api.force_authenticate(flow.user)
    retry = flow.api.post(f"/api/workflow/instances/{flow.instance.id}/ai-review-retry/", {"node_id": "future-ai"}, format="json")
    skipped = flow.api.post(f"/api/workflow/instances/{flow.instance.id}/ai-review-skip/", {"node_id": "future-ai", "reason": "故障"}, format="json")
    assert retry.status_code == 400 and skipped.status_code == 400


def test_return_marks_only_actor_and_preserves_peer_approval_history(flow):
    """会签退回只记录真实操作人，其他待办作废而不伪装成审批。"""
    peer = User.objects.create_user(username="return_peer")
    WorkflowTask.objects.create(instance=flow.instance, node_id="approval_1", node_name="第一节点", approver=peer, mode="all")
    task = flow.instance.tasks.get(approver=flow.reviewer, status="pending")
    flow.api.force_authenticate(flow.reviewer)
    assert flow.api.post(f"/api/workflow/tasks/{task.id}/return-for-revision/", {"comment": "修复"}, format="json").status_code == 200
    assert flow.instance.tasks.get(approver=peer).status == "revoked"
    assert flow.instance.tasks.get(approver=flow.reviewer).status == "returned"


@pytest.mark.parametrize("first", ["approve", "return"])
def test_postgresql_final_approval_and_return_are_serialized(flow, monkeypatch, first):
    """最后审批与退回竞争只允许先持锁的一方决定终态。"""
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, current_thread

    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("审批与退回竞争需要 PostgreSQL 行锁")
    approve_next(flow)
    approve_next(flow)
    task = flow.instance.tasks.get(status="pending")
    locked, resume, started, finished = Event(), Event(), Event(), Event()
    original = WorkflowEngine._lock_instance

    def pause(instance):
        instance = original(instance)
        if current_thread().name.startswith("return-race-first"):
            locked.set()
            assert resume.wait(10)
        return instance

    monkeypatch.setattr(WorkflowEngine, "_lock_instance", staticmethod(pause))

    def request(action, second=False):
        close_old_connections()
        api = APIClient()
        api.force_authenticate(flow.reviewer)
        try:
            if second:
                started.set()
            endpoint = "approve" if action == "approve" else "return-for-revision"
            return api.post(f"/api/workflow/tasks/{task.id}/{endpoint}/", {"comment": "竞争"}, format="json")
        finally:
            if second:
                finished.set()
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="return-race-first") as leading, ThreadPoolExecutor(max_workers=1) as trailing:
        earlier = leading.submit(request, first)
        try:
            assert locked.wait(10)
            later = trailing.submit(request, "return" if first == "approve" else "approve", True)
            assert started.wait(10) and not finished.wait(0.5)
        finally:
            resume.set()
        assert earlier.result(timeout=15).status_code == 200
        assert later.result(timeout=15).status_code == 400
    flow.release.refresh_from_db()
    flow.instance.refresh_from_db()
    assert flow.release.status == ("released" if first == "approve" else "draft")
    assert flow.instance.status == ("completed" if first == "approve" else "returned")
    assert len(flow.remote.tags) == (1 if first == "approve" else 0)


def test_return_rejects_rebound_cross_project_instance(flow):
    """批量改业务 ID 后不得把旧审批任务用于共享仓库的其他项目发布。"""
    from apps.project.models import Project, ProjectComponent

    other = User.objects.create_user(username="other_return_project")
    project = Project.objects.create(code="RETURN_OTHER", name="其他项目", leader=other, status=1)
    ProjectMember.objects.create(project=project, user=other, role="developer")
    ProjectComponent.objects.create(project=project, repository=flow.release.repository, component_code="shared")
    target = ReleaseRecord.objects.create(project=project, repository=flow.release.repository,
        publisher=other, version="VA.3.0.0", tag_name="VA.3.0.0", release_type="formal", branch="develop",
        git_hash="b" * 40, status="pending", workflow_instance=flow.instance, release_doc="其他项目")
    ReleaseRecord.objects.filter(pk=flow.release.pk).update(workflow_instance=None)
    WorkflowInstance.objects.filter(pk=flow.instance.pk).update(biz_id=str(target.pk))
    task = flow.instance.tasks.get(status="pending")
    flow.api.force_authenticate(flow.reviewer)
    detail = flow.api.get(f"/api/workflow/tasks/{task.id}/")
    assert detail.data["data"]["can_return_for_revision"] is False
    result = flow.api.post(f"/api/workflow/tasks/{task.id}/return-for-revision/", {"comment": "越权"}, format="json")
    assert result.status_code == 400, result.data
    target.refresh_from_db()
    flow.instance.refresh_from_db()
    assert target.status == "pending" and target.workflow_instance_id == flow.instance.id
    assert flow.instance.status == "running" and task.status == "pending"


def test_return_comment_in_ai_history_not_exposed_to_readonly_member(flow):
    """审查轮的退回说明可能包含源码，维保和只读成员只看安全摘要。"""
    from apps.system.review_settings import save_settings
    from apps.workflow.models import AIReviewRun

    config = save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    AIReviewRun.objects.create(instance=flow.instance, node_id="past-ai", settings_version=config, status="completed")
    task = flow.instance.tasks.get(status="pending")
    flow.api.force_authenticate(flow.reviewer)
    assert flow.api.post(f"/api/workflow/tasks/{task.id}/return-for-revision/", {"comment": "私有源码 secret"}, format="json").status_code == 200
    viewer = User.objects.create_user(username="readonly_return_history")
    member = ProjectMember.objects.create(project=flow.project, user=viewer, role="viewer")
    flow.api.force_authenticate(viewer)
    for role in ("viewer", "maintainer"):
        member.role = role
        member.save(update_fields=["role"])
        detail = flow.api.get(f"/api/workflow/instances/{flow.instance.id}/")
        assert detail.status_code == 200, detail.data
        assert "私有源码 secret" not in str(detail.data)
        release = flow.api.get(f"/api/releases/{flow.release.id}/")
        assert "私有源码 secret" not in str(release.data)


def test_superuser_return_records_actual_operator(flow):
    """超管代处理时历史展示真实操作者，不冒用原任务审批人。"""
    admin = User.objects.create_superuser(username="return_admin", password="testpass")
    task = flow.instance.tasks.get(status="pending")
    flow.api.force_authenticate(admin)
    result = flow.api.post(f"/api/workflow/tasks/{task.id}/return-for-revision/", {"comment": "请修复"}, format="json")
    assert result.status_code == 200, result.data
    detail = flow.api.get(f"/api/workflow/instances/{flow.instance.id}/")
    assert str(detail.data["data"]["returned_by"]) == str(admin.id)
    assert detail.data["data"]["returned_by_name"] == "return_admin"
    assert detail.data["data"]["tasks"][0]["approver"] == flow.reviewer.id


def _prepare_returned_release_for_resubmission(flow, monkeypatch):
    """经实际退回、更新来源和重新生成说明，准备下一轮审批。"""
    task = flow.instance.tasks.get(status="pending")
    flow.api.force_authenticate(flow.reviewer)
    response = flow.api.post(f"/api/workflow/tasks/{task.id}/return-for-revision/", {"comment": "请修复"}, format="json")
    assert response.status_code == 200, response.data
    commits = flow.remote.list_commits(flow.release.repository.external_identity, flow.release.branch)
    commits[0].hash = "b" * 40
    monkeypatch.setattr(flow.remote, "list_commits", lambda *args, **kwargs: commits)
    monkeypatch.setattr(flow.remote, "compare_diff", lambda *args: [], raising=False)
    flow.api.force_authenticate(flow.user)
    response = flow.api.post(f"/api/releases/{flow.release.id}/branch-update/", {
        "old_hash": "a" * 40, "new_hash": "b" * 40,
    }, format="json")
    assert response.status_code == 200, response.data
    response = flow.api.post(f"/api/releases/{flow.release.id}/generate-doc/")
    assert response.status_code == 200, response.data


def test_returned_release_only_publisher_can_resubmit_and_revoke(flow, monkeypatch):
    """同项目其他开发者不可代重提，原发起人重提后仍可终止。"""
    _prepare_returned_release_for_resubmission(flow, monkeypatch)
    flow.api.force_authenticate(flow.reviewer)
    response = flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/")
    assert response.status_code in (400, 403), response.data
    flow.release.refresh_from_db()
    assert flow.release.status == "draft" and flow.release.workflow_instance_id is None
    assert not flow.release.version_claims.exists()
    flow.api.force_authenticate(flow.user)
    response = flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/")
    assert response.status_code == 200, response.data
    flow.release.refresh_from_db()
    assert flow.release.workflow_instance.created_by_id == flow.user.id
    response = flow.api.post(f"/api/workflow/instances/{flow.release.workflow_instance_id}/revoke/")
    assert response.status_code == 200, response.data


def test_superuser_can_resubmit_returned_release_for_publisher(flow, monkeypatch):
    """超管可代提，流程仍属于原发起人，审计记录实际操作者。"""
    _prepare_returned_release_for_resubmission(flow, monkeypatch)
    admin = User.objects.create_superuser(username="resubmit_admin", password="testpass")
    flow.api.force_authenticate(admin)
    response = flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/")
    assert response.status_code == 200, response.data
    flow.release.refresh_from_db()
    assert flow.release.workflow_instance.created_by_id == flow.user.id
    assert OperationLog.objects.filter(action="submit_audit", resource_id=str(flow.release.id), user=admin).exists()
    flow.api.force_authenticate(flow.user)
    response = flow.api.post(f"/api/workflow/instances/{flow.release.workflow_instance_id}/revoke/")
    assert response.status_code == 200, response.data


def test_other_developer_can_submit_unreturned_draft(flow):
    """没有退回历史的草稿保留原有提审权限。"""
    assert flow.api.post(f"/api/workflow/instances/{flow.instance.id}/revoke/").status_code == 200
    flow.api.force_authenticate(flow.reviewer)
    response = flow.api.post(f"/api/releases/{flow.release.id}/submit-audit/")
    assert response.status_code == 200, response.data
    flow.release.refresh_from_db()
    assert flow.release.workflow_instance.created_by_id == flow.reviewer.id
