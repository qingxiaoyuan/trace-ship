"""从公开审批接口验证 AI 意见的人工整改闭环。"""
import uuid

import pytest
from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord
from apps.system.tests.review_helpers import configure_review
from apps.workflow.models import AIReviewRun, WorkflowDefinition, WorkflowInstance, WorkflowTask

pytestmark = pytest.mark.django_db


@pytest.fixture
def case(project, repository, user):
    definition = WorkflowDefinition.objects.create(project=project, repository=repository, name="审查", biz_type="release", release_type="rc", created_by=user)
    release = ReleaseRecord.objects.create(project=project, repository=repository, publisher=user, release_type="rc", status="pending", version="VA.1.0.2-rc", tag_name="VA.1.0.2-rc", git_hash="b" * 40, release_doc="说明")
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(release.id), source_project=project, created_by=user, status="running", current_node_id="human", node_config_snapshot=[{"node_id":"human", "node_name":"审批", "approvers":[{"type":"user", "user_id":str(user.id)}]}])
    release.workflow_instance = instance
    release.save(update_fields=["workflow_instance"])
    from apps.release.models import ReleaseReviewScope
    ReleaseReviewScope.objects.create(instance=instance, head_git_hash=release.git_hash, status="ready")
    task = WorkflowTask.objects.create(instance=instance, node_id="human", node_name="审批", approver=user, status="pending")
    config = configure_review({"endpoint":"https://model.example/v1", "model":"test", "protocol":"openai", "skill":"code-review-expert"})
    finding = {"id":str(uuid.uuid4()), "severity":"P1", "title":"缺少校验", "reason":"参数未校验", "suggestion":"添加校验", "path":"app.py", "side":"new", "line_start":1, "line_end":1}
    AIReviewRun.objects.create(instance=instance, node_id="ai", settings_version=config, status="completed", findings=[finding])
    client = APIClient()
    client.force_authenticate(user)
    return client, release, instance, task, finding


def test_adopt_blocks_approval_until_fix_is_reviewed(case):
    client, release, instance, task, finding = case
    url = f"/api/workflow/instances/{instance.id}/remediations/"
    adopted = client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json")
    assert adopted.status_code == 200, adopted.data
    item = adopted.data["data"]["item"]
    assert item["status"] == "pending_fix" and item["finding"]["reason"] == "参数未校验"
    assert client.post(f"/api/workflow/tasks/{task.id}/approve/", {}, format="json").status_code == 400
    assert client.post(url, {"action":"fix", "id":item["id"], "comment":"尚未退回"}, format="json").status_code == 400
    instance.status = "returned"
    instance.save(update_fields=["status"])
    task.status = "returned"
    task.save(update_fields=["status"])
    release.status, release.workflow_instance = "draft", None
    release.save(update_fields=["status", "workflow_instance"])
    fixed = client.post(url, {"action":"fix", "id":item["id"], "comment":"  添加参数校验\n保留换行  "}, format="json")
    assert fixed.status_code == 200 and fixed.data["data"]["item"]["status"] == "pending_review"
    assert fixed.data["data"]["item"]["fix_note"] == "  添加参数校验\n保留换行  "
    new = WorkflowInstance.objects.create(definition=instance.definition, biz_type="release", biz_id=str(release.id), source_project=release.project, created_by=release.publisher, status="running", current_node_id="next")
    WorkflowTask.objects.create(instance=new, node_id="next", node_name="复核", approver=release.publisher, status="pending")
    release.status, release.workflow_instance = "pending", new
    release.save(update_fields=["status", "workflow_instance"])
    assert client.post(url, {"action":"resolve", "id":item["id"], "comment":"未更新提交"}, format="json").status_code == 400
    release.git_hash = "c" * 40
    release.save(update_fields=["git_hash"])
    resolved = client.post(url, {"action":"resolve", "id":item["id"], "comment":"已核对"}, format="json")
    assert resolved.status_code == 200 and resolved.data["data"]["item"]["status"] == "resolved"
    again = client.get(url)
    history = again.data["data"]["items"][0]["history"]
    assert [h["action"] for h in history] == ["adopt", "fix", "resolve"]
    assert history[-1]["instance_id"] == str(new.id) and history[-1]["node_id"] == "next"
    assert history[-1]["git_hash"] == "c" * 40 and history[-1]["task_id"]


def test_original_finding_survives_new_round_and_requires_current_approver(case):
    from apps.account.models import User
    from apps.project.models import ProjectMember

    client, release, original, task, finding = case
    old_url = f"/api/workflow/instances/{original.id}/remediations/"
    adopted = client.post(old_url, {"action": "adopt", "node_id": "ai", "finding_id": finding["id"]}, format="json")
    item_id = adopted.data["data"]["item"]["id"]
    original.status = "returned"
    original.save(update_fields=["status"])
    task.status = "returned"
    task.save(update_fields=["status"])
    release.status = "draft"
    release.workflow_instance = None
    release.save(update_fields=["status", "workflow_instance"])
    assert client.post(old_url, {"action": "adopt", "node_id": "ai", "finding_id": finding["id"]}, format="json").status_code in (400, 403)
    assert client.post(old_url, {"action": "fix", "id": item_id, "comment": "新提交修复"}, format="json").status_code == 200
    other = User.objects.create_user(username="next-reviewer", password="testpass")
    ProjectMember.objects.create(project=release.project, user=other, role="auditor")
    new = WorkflowInstance.objects.create(definition=original.definition, biz_type="release", biz_id=str(release.id), source_project=release.project, created_by=release.publisher, status="running", current_node_id="next")
    next_task = WorkflowTask.objects.create(instance=new, node_id="next", node_name="复核", approver=other, status="pending")
    release.status, release.workflow_instance, release.git_hash = "pending", new, "c" * 40
    release.save(update_fields=["status", "workflow_instance", "git_hash"])
    url = f"/api/workflow/instances/{new.id}/remediations/"
    data = client.get(url).data["data"]["items"][0]
    assert data["instance_id"] == str(original.id) and data["finding"]["id"] == finding["id"]
    assert client.post(url, {"action":"resolve", "id":item_id}, format="json").status_code == 403
    client.force_authenticate(other)
    assert client.post(f"/api/workflow/tasks/{next_task.id}/approve/", {}, format="json").status_code == 400
    assert client.post(url, {"action":"resolve", "id":item_id}, format="json").status_code == 200


def test_read_and_actions_recheck_project_roles(case):
    from apps.account.models import User
    from apps.project.models import ProjectMember

    client, release, instance, task, finding = case
    url = f"/api/workflow/instances/{instance.id}/remediations/"
    viewer = User.objects.create_user(username="readonly-remediation", password="testpass")
    membership = ProjectMember.objects.create(project=release.project, user=viewer, role="viewer")
    assigned = WorkflowTask.objects.create(instance=instance, node_id="human", node_name="审批", approver=viewer, status="pending")
    client.force_authenticate(viewer)
    assert client.get(url).status_code == 403
    assert client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json").status_code == 403
    membership.role = "auditor"
    membership.save(update_fields=["role"])
    assert client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json").status_code == 200
    membership.delete()
    assert client.get(url).status_code == 200  # 本单当前指定审批人
    assigned.status = "revoked"
    assigned.save(update_fields=["status"])
    assert client.get(url).status_code == 403


def test_remediation_survives_retry_and_rejects_fabricated_findings(case):
    client, release, instance, task, finding = case
    run = instance.ai_reviews.get()
    run.history = [{"token":"old", "findings":[finding]}]
    run.findings = []
    run.save(update_fields=["history", "findings"])
    url = f"/api/workflow/instances/{instance.id}/remediations/"
    assert client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":str(uuid.uuid4())}, format="json").status_code == 400
    data = client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json")
    assert data.status_code == 200
    assert data.data["data"]["item"]["source_token"] == "old"
    assert data.data["data"]["item"]["source_git_hash"] == "b" * 40
    assert client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json").status_code == 400
    item_id = data.data["data"]["item"]["id"]
    assert client.post(url, {"action":"dismiss", "id":item_id, "comment":" "}, format="json").status_code == 400
    assert client.post(url, {"action":"dismiss", "id":item_id, "comment":"证据不成立"}, format="json").status_code == 200


def test_open_remediation_blocks_direct_tag_and_identity_tampering(case, monkeypatch):
    from rest_framework import serializers

    from apps.release.services import ReleaseService

    client, release, instance, task, finding = case
    url = f"/api/workflow/instances/{instance.id}/remediations/"
    adopted = client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json")
    assert adopted.status_code == 200
    release.workflow_instance = None
    release.save(update_fields=["workflow_instance"])
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda *args, **kwargs: pytest.fail("不得访问 GitLab"))
    with pytest.raises(serializers.ValidationError, match="人工复核"):
        ReleaseService.push_tag(release)
    WorkflowInstance.objects.filter(pk=instance.pk).update(biz_id=str(uuid.uuid4()))
    assert client.get(url).status_code == 400
    assert client.post(url, {"action":"fix", "id":adopted.data["data"]["item"]["id"], "comment":"test"}, format="json").status_code == 400


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("first", ["adopt", "approve"])
def test_postgresql_adoption_and_approval_are_serialized(case, monkeypatch, mock_git_provider, first):
    """采纳与最终批准只能按仓库、发布、实例锁顺序串行生效。"""
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, current_thread

    from django.db import close_old_connections, connection

    from apps.release.services import ReleaseService
    from apps.workflow.services import WorkflowEngine

    if connection.vendor != "postgresql":
        pytest.skip("采纳与审批竞争需要 PostgreSQL 行锁")
    _, release, instance, task, finding = case
    user = release.publisher
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda *args, **kwargs: mock_git_provider)
    locked, resume, started, finished = Event(), Event(), Event(), Event()
    original = WorkflowEngine._lock_instance

    def pause(source):
        result = original(source)
        if current_thread().name.startswith("remediation-first"):
            locked.set()
            assert resume.wait(10)
        return result

    monkeypatch.setattr(WorkflowEngine, "_lock_instance", staticmethod(pause))

    def request(action, second=False):
        close_old_connections()
        api = APIClient()
        api.force_authenticate(user)
        try:
            if second:
                started.set()
            if action == "adopt":
                return api.post(f"/api/workflow/instances/{instance.id}/remediations/", {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json")
            return api.post(f"/api/workflow/tasks/{task.id}/approve/", {}, format="json")
        finally:
            if second:
                finished.set()
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="remediation-first") as leading, ThreadPoolExecutor(max_workers=1) as trailing:
        earlier = leading.submit(request, first)
        try:
            assert locked.wait(10)
            later = trailing.submit(request, "approve" if first == "adopt" else "adopt", True)
            assert started.wait(10) and not finished.wait(0.5)
        finally:
            resume.set()
        assert earlier.result(timeout=20).status_code == 200
        assert later.result(timeout=20).status_code in (400, 403)
    release.refresh_from_db()
    assert release.ai_remediations.count() == (1 if first == "adopt" else 0)


def test_ai_approval_rejects_tampered_workflow_identity(case):
    client, release, instance, task, finding = case
    WorkflowInstance.objects.filter(pk=instance.pk).update(biz_id=str(uuid.uuid4()))
    response = client.post(f"/api/workflow/tasks/{task.id}/approve/", {}, format="json")
    assert response.status_code == 400
    task.refresh_from_db()
    assert task.status == "pending"


def test_rejection_requires_new_application_and_keeps_old_remediation_history(user, project, repository, monkeypatch, mock_git_provider, django_capture_on_commit_callbacks):
    """驳回后新建申请重新审查，旧报告和整改保留且不混入新申请。"""
    from types import SimpleNamespace

    from apps.release.services import ReleaseService
    from apps.workflow import ai_review_model
    from utils.provider.base import TagInfo

    provider = mock_git_provider
    provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda *args, **kwargs: provider)
    monkeypatch.setattr(provider, "review_diff", lambda *args: {"diffs":[{"old_path":"app.py", "new_path":"app.py", "diff":"@@ -1 +1 @@\n-a\n+b"}], "warnings":[], "complete":True}, raising=False)
    responses = iter([
        {"action":"finish", "dimensions":["安全"], "reviewed_files":["app.py"], "findings":[{"severity":"P1", "title":"缺少校验", "reason":"错误", "suggestion":"修复", "path":"app.py", "side":"new", "line_start":1, "line_end":1}]},
        {"action":"finish", "dimensions":["安全"], "reviewed_files":["app.py"], "findings":[]},
    ])
    monkeypatch.setattr(ai_review_model, "_ask", lambda *args: (next(responses), "{}"))
    configure_review({"endpoint":"https://model.example/v1", "model":"test", "protocol":"openai", "skill":"code-review-expert"})
    WorkflowDefinition.objects.create(project=project, repository=repository, name="审查", biz_type="release", release_type="rc", created_by=user, is_active=True,
        node_config=[{"node_id":"ai", "node_name":"AI", "node_type":"ai_review"}, {"node_id":"human", "node_name":"审批", "approvers":[{"type":"user", "user_id":str(user.id)}]}])
    release = ReleaseRecord.objects.create(project=project, repository=repository, publisher=user, release_type="rc", status="draft", version="VA.1.0.2-rc", tag_name="VA.1.0.2-rc", branch="develop", git_hash="b" * 40, release_doc="说明")
    client = APIClient()
    client.force_authenticate(user)
    with django_capture_on_commit_callbacks(execute=True):
        assert client.post(f"/api/releases/{release.id}/submit-audit/").status_code == 200
    release.refresh_from_db()
    original = release.workflow_instance
    task = original.tasks.get(status="pending")
    finding = original.ai_reviews.get().findings[0]
    old_url = f"/api/workflow/instances/{original.id}/remediations/"
    adopted = client.post(old_url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json")
    assert adopted.status_code == 200, adopted.data
    item_id = adopted.data["data"]["item"]["id"]
    assert client.post(f"/api/workflow/tasks/{task.id}/return-for-revision/", {"comment":"修复"}, format="json").status_code == 200
    assert client.post(old_url, {"action":"fix", "id":item_id, "comment":"已添加校验"}, format="json").status_code == 403
    assert client.post(f"/api/releases/{release.id}/submit-audit/").status_code == 400
    monkeypatch.setattr(provider, "get_branch", lambda *args: SimpleNamespace(name="develop", last_commit_hash="c" * 40))
    created = client.post("/api/releases/", {"project": str(project.id), "repository": str(repository.id),
        "release_type": "rc", "version": release.version, "branch": "develop", "package_config_ids": []}, format="json")
    assert created.status_code == 201, created.data
    new_id = created.data["data"]["id"]
    assert str(new_id) != str(release.id)
    assert client.post(f"/api/releases/{new_id}/generate-doc/").status_code == 200
    with django_capture_on_commit_callbacks(execute=True):
        submitted = client.post(f"/api/releases/{new_id}/submit-audit/")
    assert submitted.status_code == 200, submitted.data
    fresh = ReleaseRecord.objects.get(pk=new_id)
    new = fresh.workflow_instance
    assert new.id != original.id and new.ai_reviews.get().findings == []
    assert client.get(f"/api/workflow/instances/{new.id}/remediations/").data["data"]["items"] == []
    assert client.post(f"/api/workflow/tasks/{new.tasks.get(status='pending').id}/approve/", {}, format="json").status_code == 200
    release.refresh_from_db()
    assert release.status == "rejected" and release.workflow_instance_id == original.id
    assert client.get(old_url).data["data"]["items"][0]["status"] == "pending_fix"


def test_creating_same_version_does_not_clean_returned_remediation(case, monkeypatch, mock_git_provider):
    from apps.release.services import ReleaseService

    client, release, instance, task, finding = case
    url = f"/api/workflow/instances/{instance.id}/remediations/"
    assert client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json").status_code == 200
    assert client.post(f"/api/workflow/tasks/{task.id}/return-for-revision/", {"comment":"修复"}, format="json").status_code == 200
    release.refresh_from_db()
    release.release_doc = ""
    release.save(update_fields=["release_doc"])
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda *args, **kwargs: mock_git_provider)
    response = client.post("/api/releases/", {"project":str(release.project_id), "repository":str(release.repository_id),
        "release_type":"rc", "version":release.version, "branch":"develop", "package_config_ids":[]}, format="json")
    assert response.status_code == 201, response.data
    assert ReleaseRecord.objects.filter(pk=release.id).exists()
    assert client.get(url).data["data"]["items"][0]["status"] == "pending_fix"


def test_revoked_release_with_adopted_finding_survives_timed_cleanup(case):
    from datetime import timedelta

    from django.utils import timezone

    from apps.release.tasks import cleanup_draft_releases

    client, release, instance, task, finding = case
    url = f"/api/workflow/instances/{instance.id}/remediations/"
    assert client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json").status_code == 200
    assert client.post(f"/api/workflow/instances/{instance.id}/revoke/").status_code == 200
    ReleaseRecord.objects.filter(pk=release.pk).update(created_at=timezone.now() - timedelta(hours=2))
    cleanup_draft_releases()
    assert ReleaseRecord.objects.filter(pk=release.pk).exists()
    assert client.get(url).data["data"]["items"][0]["status"] == "pending_fix"


def test_adopt_requires_matching_fixed_scope(case):
    client, release, instance, task, finding = case
    url = f"/api/workflow/instances/{instance.id}/remediations/"
    instance.review_scope.delete()
    response = client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json")
    assert response.status_code == 400
    assert not release.ai_remediations.exists()


def test_revoked_adoption_requires_ai_and_new_commit_to_resubmit(case):
    client, release, instance, task, finding = case
    url = f"/api/workflow/instances/{instance.id}/remediations/"
    assert client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json").status_code == 200
    assert client.post(f"/api/workflow/instances/{instance.id}/revoke/").status_code == 200
    release.refresh_from_db()
    definition = instance.definition
    definition.node_config = [{"node_id":"human", "node_name":"审批", "approvers":[{"type":"user", "user_id":str(release.publisher_id)}]}]
    definition.save(update_fields=["node_config"])
    response = client.post(f"/api/releases/{release.id}/submit-audit/")
    assert response.status_code == 400 and "AI" in response.data["message"]
    definition.node_config.insert(0, {"node_id":"ai", "node_name":"审查", "node_type":"ai_review"})
    definition.save(update_fields=["node_config"])
    response = client.post(f"/api/releases/{release.id}/submit-audit/")
    assert response.status_code == 400 and "更新" in response.data["message"]
    release.refresh_from_db()
    assert release.status == "draft" and release.workflow_instance_id is None


def test_explicit_reject_and_delete_terminates_original_remediation(case):
    """保留既有显式结束语义，不将其误记为整改完成。"""
    from apps.workflow.models import AIReviewRemediation

    client, release, instance, task, finding = case
    url = f"/api/workflow/instances/{instance.id}/remediations/"
    adopted = client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json")
    assert adopted.status_code == 200
    item_id = adopted.data["data"]["item"]["id"]
    assert client.post(f"/api/workflow/tasks/{task.id}/reject/", {"comment":"终止申请"}, format="json").status_code == 200
    assert AIReviewRemediation.objects.get(pk=item_id).status == "pending_fix"
    assert client.delete(f"/api/releases/{release.id}/").status_code == 200
    assert not AIReviewRemediation.objects.filter(pk=item_id).exists()


def test_adopt_skipped_review_uses_prior_execution_token(case):
    client, release, instance, task, finding = case
    run = instance.ai_reviews.get()
    previous = str(run.token)
    run.history = [{"token":previous, "findings":[finding]}]
    run.token = uuid.uuid4()
    run.status = "skipped"
    run.save(update_fields=["history", "token", "status"])
    url = f"/api/workflow/instances/{instance.id}/remediations/"
    response = client.post(url, {"action":"adopt", "node_id":"ai", "finding_id":finding["id"]}, format="json")
    assert response.status_code == 200
    assert response.data["data"]["item"]["source_token"] == previous
