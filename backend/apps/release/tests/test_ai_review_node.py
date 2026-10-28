"""通过发布与审批接口验证 AI 节点的固定范围与人工放行。"""
import pytest

from apps.release.models import ReleaseRecord
from apps.workflow.models import AIReviewRun, WorkflowDefinition

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client(user):
    from rest_framework.test import APIClient
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def patched_provider(monkeypatch, mock_git_provider):
    from apps.release.services import ReleaseService
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda *args, **kwargs: mock_git_provider)
    return mock_git_provider


def _draft(project, repository, user):
    return ReleaseRecord.objects.create(project=project, repository=repository, publisher=user,
        release_type="rc", status="draft", version="VA.1.0.2-rc", tag_name="VA.1.0.2-rc",
        branch="develop", git_hash="b" * 40, release_doc="有效说明")


def _definition(project, repository, user):
    return WorkflowDefinition.objects.create(project=project, repository=repository, name="AI 审批",
        biz_type="release", release_type="rc", is_active=True, created_by=user,
        node_config=[{"node_id": "ai", "node_name": "代码审查", "node_type": "ai_review"},
                     {"node_id": "human", "node_name": "人工审批", "approvers": [{"type": "leader"}]}])


def test_submit_without_review_configuration_does_not_start(api_client, project, repository, user, patched_provider):
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    response = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert response.status_code == 400
    release.refresh_from_db()
    assert release.status == "draft" and release.workflow_instance_id is None
    assert not AIReviewRun.objects.exists()


def test_first_release_skips_ai_but_still_requires_human(api_client, project, repository, user,
                                                         patched_provider, django_capture_on_commit_callbacks):
    from apps.system.review_settings import save_settings
    save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert response.status_code == 200, response.data
    release.refresh_from_db()
    instance = release.workflow_instance
    assert release.status == "pending"
    assert instance.current_node_id == "human"
    assert instance.ai_reviews.get().status == "first_release"
    assert instance.tasks.filter(node_id="human", status="pending").count() == 1


def test_ai_review_api_separates_summary_from_full_findings(api_client, project, repository, user):
    from rest_framework.test import APIClient

    from apps.account.models import User
    from apps.project.models import ProjectMember
    from apps.system.review_settings import save_settings
    from apps.workflow.models import WorkflowInstance

    definition = _definition(project, repository, user)
    release = _draft(project, repository, user)
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(release.id),
        source_project=project, created_by=user, node_config_snapshot=definition.node_config)
    config = save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    AIReviewRun.objects.create(instance=instance, node_id="ai", settings_version=config, status="completed",
        summary="审查完成", dimensions=["安全"], coverage={"total_files": 1, "reviewed_files": 1, "warnings": []},
        findings=[{"reason": "私有源码", "severity": "P1"}])
    url = f"/api/workflow/instances/{instance.id}/ai-review/"
    assert api_client.get(url).data["data"]["reviews"][0]["findings"][0]["reason"] == "私有源码"
    viewer = User.objects.create_user(username="ai-viewer", password="testpass")
    ProjectMember.objects.create(project=project, user=viewer, role="maintainer")
    client = APIClient()
    client.force_authenticate(viewer)
    response = client.get(url)
    assert response.status_code == 200
    assert "私有源码" not in str(response.data)
    assert "findings" not in response.data["data"]["reviews"][0]
    outsider = User.objects.create_user(username="ai-outsider", password="testpass")
    client.force_authenticate(outsider)
    assert client.get(url).status_code == 404
    from apps.workflow.models import WorkflowTask
    task = WorkflowTask.objects.create(instance=instance, node_id="human", node_name="审批", approver=outsider)
    assert client.get(url).data["data"]["reviews"][0]["findings"]
    ProjectMember.objects.create(project=project, user=outsider, role="maintainer")
    assert "findings" not in client.get(url).data["data"]["reviews"][0]
    task.delete()
    ProjectMember.objects.filter(project=project, user=outsider).delete()
    assert client.get(url).status_code == 404


def test_completed_review_waits_for_human_and_validates_lines(api_client, project, repository, user,
                                                             patched_provider, monkeypatch,
                                                             django_capture_on_commit_callbacks):
    from apps.system.review_settings import save_settings
    from apps.workflow import ai_review_model
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "app.py", "new_path": "app.py", "diff": "@@ -1,2 +1,2 @@\n---old\n+++new\n-x\n+y"}],
        "complete": True, "warnings": []}, raising=False)
    captured = []
    def ask(config, messages):
        captured.append(messages[0]["content"])
        return ({"action": "finish", "dimensions": ["安全", "需求符合性"], "reviewed_files": ["app.py"],
                 "findings": [{"severity": "P1", "title": "问题", "reason": "缺失校验", "suggestion": "增加校验",
                               "path": "app.py", "side": "new", "line_start": 99, "line_end": 99},
                              {"severity": "P2", "title": "第二行", "reason": "错误", "suggestion": "修复",
                               "path": "app.py", "side": "new", "line_start": 2, "line_end": 2}]}, "{}")
    monkeypatch.setattr(ai_review_model, "_ask", ask)
    config = save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert response.status_code == 200, response.data
    release.refresh_from_db()
    instance = release.workflow_instance
    run = instance.ai_reviews.get()
    assert run.settings_version_id == config.id and run.status == "completed"
    assert "SKILL.md" in captured[0] and "references/security-checklist.md" in captured[0]
    assert instance.current_node_id == "human" and release.status == "pending"
    finding = run.findings[0]
    assert finding["id"] and finding["path"] == "app.py" and "line_start" not in finding
    assert run.findings[1]["line_start"] == 2 and run.findings[1]["side"] == "new"
    assert "需求符合性" not in run.dimensions
    data = api_client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]
    assert data["reviews"][0]["findings"][0]["id"] == finding["id"]


def test_truncated_or_failed_model_cannot_advance(api_client, project, repository, user,
                                                   patched_provider, monkeypatch,
                                                   django_capture_on_commit_callbacks):
    from apps.system.review_settings import save_settings
    from apps.workflow import ai_review_model
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    def fail(*args):
        raise ValueError("模型输出截断")
    monkeypatch.setattr(ai_review_model, "_ask", fail)
    save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert response.status_code == 200, response.data
    release.refresh_from_db()
    assert release.workflow_instance.ai_reviews.get().status == "failed"
    assert release.workflow_instance.current_node_id == "ai"
    assert not release.workflow_instance.tasks.exists()


def test_stale_result_after_termination_does_not_advance(api_client, project, repository, user,
                                                          patched_provider, monkeypatch,
                                                          django_capture_on_commit_callbacks):
    from apps.system.review_settings import save_settings
    from apps.workflow import ai_review_model
    from apps.workflow.services import WorkflowEngine
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    def late(*args):
        run = AIReviewRun.objects.get()
        WorkflowEngine.revoke_instance(run.instance, user)
        return ({"action": "finish", "dimensions": ["安全"], "reviewed_files": ["a.py"], "findings": []}, "{}")
    monkeypatch.setattr(ai_review_model, "_ask", late)
    save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert response.status_code == 200, response.data
    release.refresh_from_db()
    run = AIReviewRun.objects.get()
    assert release.status == "draft" and release.workflow_instance_id is None
    assert run.instance.status == "revoked" and not run.instance.tasks.exists()
    assert run.status != "completed"


def test_model_truncation_is_rejected_even_with_nonempty_text(monkeypatch):
    from types import SimpleNamespace

    from apps.workflow.ai_review_model import _ask

    class Response:
        status_code = 200
        def json(self):
            return {"choices": [{"finish_reason": "length", "message": {"content": '{"action":"finish"}'}}]}
    monkeypatch.setattr("apps.workflow.ai_review_model.requests.post", lambda *args, **kwargs: Response())
    config = SimpleNamespace(endpoint="https://model.example/v1", model="review", protocol="openai", encrypted_api_key="")
    with pytest.raises(ValueError, match="截断"):
        _ask(config, [{"role": "user", "content": "x"}])


def test_unavailable_human_after_ai_is_recorded_as_recoverable_failure(api_client, project, repository, user,
                                                                        patched_provider, monkeypatch,
                                                                        django_capture_on_commit_callbacks):
    from apps.system.review_settings import save_settings
    from apps.workflow import ai_review_model
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    def finish(*args):
        user.is_active = False
        user.save(update_fields=["is_active"])
        return ({"action": "finish", "dimensions": ["安全"], "reviewed_files": ["a.py"], "findings": []}, "{}")
    monkeypatch.setattr(ai_review_model, "_ask", finish)
    save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert response.status_code == 200
    release.refresh_from_db()
    run = release.workflow_instance.ai_reviews.get()
    assert run.status == "failed" and "人工审批节点不可用" in run.summary
    assert release.workflow_instance.current_node_id == "ai" and not release.workflow_instance.tasks.exists()


def test_renamed_old_side_and_missing_evidence_positions():
    from apps.workflow.ai_review_model import _safe_findings

    diffs = [{"old_path": "before.py", "new_path": "after.py", "diff": "@@ -1,2 +1,2 @@\n---old\n+++new\n-x\n+y"}]
    finding = {"severity": "P1", "title": "旧文件", "reason": "错误", "suggestion": "修复",
               "path": "before.py", "side": "old", "line_start": 2, "line_end": 2}
    result = _safe_findings([finding], diffs)[0]
    assert result["path"] == "before.py" and result["side"] == "old" and result["line_start"] == 2
    finding["side"] = "new"
    result = _safe_findings([finding], diffs)[0]
    assert result["path"] == "before.py" and "line_start" not in result


def test_expired_execution_reclaims_token_and_creates_one_human_task(api_client, project, repository, user,
                                                                   patched_provider, django_capture_on_commit_callbacks):
    from datetime import timedelta

    from django.utils import timezone

    from apps.system.review_settings import save_settings
    from apps.workflow.ai_review import execute_review

    save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        response = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert response.status_code == 200
    release.refresh_from_db()
    run = release.workflow_instance.ai_reviews.get()
    old_token = run.token
    AIReviewRun.objects.filter(pk=run.pk).update(status="running", updated_at=timezone.now() - timedelta(hours=2))
    data = api_client.get(f"/api/workflow/instances/{release.workflow_instance_id}/ai-review/").data["data"]
    assert data["reviews"][0]["status"] == "failed"
    execute_review(release.workflow_instance_id, "ai")
    execute_review(release.workflow_instance_id, "ai")
    run.refresh_from_db()
    assert run.token != old_token and run.status == "first_release"
    assert run.instance.tasks.filter(node_id="human", status="pending").count() == 1


def test_requirement_mark_requires_real_input_and_is_snapshotted(api_client, project, repository, user,
                                                                 patched_provider, monkeypatch,
                                                                 django_capture_on_commit_callbacks):
    from apps.system.review_settings import save_settings
    from apps.workflow import ai_review_model
    from utils.provider.base import TagInfo

    _definition(project, repository, user)
    release = _draft(project, repository, user)
    url = f"/api/releases/{release.id}/"
    assert api_client.patch(url, {"review_context_is_requirement": True}, format="json").status_code == 400
    assert api_client.patch(url, {"review_context": "需求：只有管理员可以删除",
                                  "review_context_is_requirement": True}, format="json").status_code == 200
    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review_model, "_ask", lambda *args: ({"action": "finish",
        "dimensions": ["安全", "需求符合性"], "reviewed_files": ["a.py"], "findings": []}, "{}"))
    save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    with django_capture_on_commit_callbacks(execute=True):
        result = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert result.status_code == 200, result.data
    release.refresh_from_db()
    assert release.workflow_instance.review_scope.context_is_requirement is True
    assert "需求符合性" in release.workflow_instance.ai_reviews.get().dimensions


def test_rollback_cannot_reenter_completed_ai_node(api_client, project, repository, user,
                                                  patched_provider, django_capture_on_commit_callbacks):
    from apps.system.review_settings import save_settings

    save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    definition = _definition(project, repository, user)
    definition.node_config = [
        {"node_id": "a", "node_name": "审批 A", "approvers": [{"type": "leader"}]},
        {"node_id": "b", "node_name": "审批 B", "approvers": [{"type": "leader"}]},
        {"node_id": "ai", "node_name": "审查", "node_type": "ai_review"},
        {"node_id": "c", "node_name": "审批 C", "approvers": [{"type": "leader"}]},
    ]
    definition.save(update_fields=["node_config"])
    release = _draft(project, repository, user)
    assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    task_a = release.workflow_instance.tasks.get(node_id="a")
    assert api_client.post(f"/api/workflow/tasks/{task_a.id}/approve/", {}, format="json").status_code == 200
    task_b = release.workflow_instance.tasks.get(node_id="b")
    with django_capture_on_commit_callbacks(execute=True):
        assert api_client.post(f"/api/workflow/tasks/{task_b.id}/approve/", {}, format="json").status_code == 200
    task_c = release.workflow_instance.tasks.get(node_id="c")
    url = f"/api/workflow/tasks/{task_c.id}/rollback/"
    assert api_client.post(url, {"comment": "重审", "rollback_target": "ai"}, format="json").status_code == 400
    assert api_client.post(url, {"comment": "重审", "rollback_target": "b"}, format="json").status_code == 400
    task_c.refresh_from_db()
    assert task_c.status == "pending"


def test_model_read_and_search_only_use_fixed_head(api_client, project, repository, user,
                                                  patched_provider, monkeypatch,
                                                  django_capture_on_commit_callbacks):
    from apps.system.review_settings import save_settings
    from apps.workflow import ai_review_model
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    reads = []
    def read(identity, path, ref):
        reads.append((path, ref))
        return "secret = 1\nvalue = 2"
    monkeypatch.setattr(patched_provider, "get_file_raw", read, raising=False)
    actions = iter([
        {"action": "read", "path": "a.py"}, {"action": "search", "path": "a.py", "query": "value"},
        {"action": "finish", "dimensions": ["安全"], "reviewed_files": ["a.py"], "findings": []},
    ])
    monkeypatch.setattr(ai_review_model, "_ask", lambda *args: (next(actions), "{}"))
    save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=True):
        result = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert result.status_code == 200
    release.refresh_from_db()
    assert reads == [("a.py", "b" * 40), ("a.py", "b" * 40)]
    assert release.workflow_instance.ai_reviews.get().status == "completed"


def test_model_redirect_does_not_forward_credentials_or_source(monkeypatch):
    from types import SimpleNamespace

    from apps.workflow.ai_review_model import _ask

    calls = []
    class Response:
        status_code = 307
    def send(*args, **kwargs):
        calls.append(kwargs)
        return Response()
    monkeypatch.setattr("apps.workflow.ai_review_model.requests.post", send)
    config = SimpleNamespace(endpoint="https://model.example", model="review", protocol="anthropic", encrypted_api_key="")
    with pytest.raises(ValueError, match="模型请求失败"):
        _ask(config, [{"role": "user", "content": "私有源码"}])
    assert len(calls) == 1 and calls[0]["allow_redirects"] is False


def test_settings_change_after_submit_does_not_change_review_snapshot(api_client, project, repository, user,
                                                                        patched_provider, monkeypatch,
                                                                        django_capture_on_commit_callbacks):
    from apps.system.review_settings import save_settings
    from apps.workflow import ai_review_model
    from apps.workflow.ai_review import execute_review
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    models = []
    def finish(config, messages):
        models.append(config.model)
        return ({"action": "finish", "dimensions": ["安全"], "reviewed_files": ["a.py"], "findings": []}, "{}")
    monkeypatch.setattr(ai_review_model, "_ask", finish)
    save_settings({"endpoint": "https://model.example/v1", "model": "first", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    save_settings({"endpoint": "https://model.example/v1", "model": "second", "protocol": "openai", "skill": "code-review-expert"})
    release.refresh_from_db()
    execute_review(release.workflow_instance_id, "ai")
    assert models == ["first"]
    assert release.workflow_instance.ai_reviews.get().settings_version.model == "first"


def test_partial_review_keeps_coverage_paths_and_does_not_advance(api_client, project, repository, user,
                                                                  patched_provider, monkeypatch,
                                                                  django_capture_on_commit_callbacks):
    from apps.system.review_settings import save_settings
    from apps.workflow import ai_review_model
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": p, "new_path": p, "diff": "@@ -1 +1 @@\n-a\n+b"} for p in ("a.py", "b.py")],
        "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review_model, "_ask", lambda *args: ({"action": "finish",
        "dimensions": ["安全"], "reviewed_files": ["a.py"], "findings": []}, "{}"))
    save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert response.status_code == 200
    release.refresh_from_db()
    run = release.workflow_instance.ai_reviews.get()
    assert run.status == "incomplete" and run.coverage["reviewed_paths"] == ["a.py"]
    assert run.coverage["unreviewed_paths"] == ["b.py"]
    assert release.workflow_instance.current_node_id == "ai" and not release.workflow_instance.tasks.exists()


def test_model_controlled_missing_path_never_leaks_in_readonly_summary(api_client, project, repository, user,
                                                                        patched_provider, monkeypatch,
                                                                        django_capture_on_commit_callbacks):
    from rest_framework.test import APIClient

    from apps.account.models import User
    from apps.project.models import ProjectMember
    from apps.system.review_settings import save_settings
    from apps.workflow import ai_review_model
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    secret = "私有源码标记\n第二行"
    monkeypatch.setattr(patched_provider, "get_file_raw", lambda *args, **kwargs: None, raising=False)
    actions = iter([
        {"action": "read", "path": secret},
        {"action": "finish", "dimensions": ["安全"], "reviewed_files": ["a.py"], "findings": []},
    ])
    monkeypatch.setattr(ai_review_model, "_ask", lambda *args: (next(actions), "{}"))
    save_settings({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=True):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    url = f"/api/workflow/instances/{release.workflow_instance_id}/ai-review/"
    full_warnings = api_client.get(url).data["data"]["reviews"][0]["coverage"]["warnings"]
    assert any(secret in warning for warning in full_warnings)
    # 即便未来的执行器把模型内容写入其他完整报告字段，低权限摘要也不能泄漏。
    run = release.workflow_instance.ai_reviews.get()
    run.summary = secret
    run.dimensions = [secret]
    run.findings = [{"reason": secret}]
    run.coverage["reviewed_paths"] = [secret]
    run.save(update_fields=["summary", "dimensions", "findings", "coverage"])
    for role in ("maintainer", "viewer"):
        reader = User.objects.create_user(username=f"ai-summary-{role}", password="testpass")
        ProjectMember.objects.create(project=project, user=reader, role=role)
        client = APIClient()
        client.force_authenticate(reader)
        response = client.get(url)
        assert response.status_code == 200
        assert "私有源码标记" not in str(response.data) and "第二行" not in str(response.data)
        assert response.data["data"]["reviews"][0]["coverage"]["warnings"] == ["审查存在提示或未覆盖内容"]
