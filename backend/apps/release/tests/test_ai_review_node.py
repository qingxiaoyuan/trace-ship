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
    from apps.system.tests.review_helpers import configure_review
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
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
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow.models import WorkflowInstance

    definition = _definition(project, repository, user)
    release = _draft(project, repository, user)
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(release.id),
        source_project=project, created_by=user, node_config_snapshot=definition.node_config)
    config = configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
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
    from apps.system.tests.review_helpers import configure_review
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
    config = configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
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
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    def fail(*args):
        raise ValueError("模型输出截断")
    monkeypatch.setattr(ai_review_model, "_ask", fail)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=True):
        response = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert response.status_code == 200, response.data
    release.refresh_from_db()
    run = release.workflow_instance.ai_reviews.get()
    assert run.status == "failed" and any("截断" in warning for warning in run.coverage["warnings"])
    assert release.workflow_instance.current_node_id == "ai"
    assert not release.workflow_instance.tasks.exists()


def test_stale_result_after_termination_does_not_advance(api_client, project, repository, user,
                                                          patched_provider, monkeypatch,
                                                          django_capture_on_commit_callbacks):
    from apps.system.tests.review_helpers import configure_review
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
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
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
        headers = {}
        def __init__(self):
            self.raw = self
            self.chunks = iter([b'{"choices":[{"finish_reason":"length","message":{"content":"{}"}}]}', b''])
        def read1(self, *args, **kwargs):
            return next(self.chunks)
        def close(self):
            pass
    monkeypatch.setattr("apps.workflow.ai_review_model._ModelSession.post", lambda *args, **kwargs: Response())
    config = SimpleNamespace(endpoint="https://model.example/v1", model="review", protocol="openai", encrypted_api_key="")
    with pytest.raises(ValueError, match="截断"):
        _ask(config, [{"role": "user", "content": "x"}])


def test_unavailable_human_after_ai_is_recorded_as_recoverable_failure(api_client, project, repository, user,
                                                                        patched_provider, monkeypatch,
                                                                        django_capture_on_commit_callbacks):
    from apps.system.tests.review_helpers import configure_review
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
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
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

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow.ai_review import execute_review

    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
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
    assert run.history[0]["token"] == str(old_token)
    assert run.history[0]["status"] == "failed" and "超时" in run.history[0]["summary"]
    assert run.instance.tasks.filter(node_id="human", status="pending").count() == 1


def test_requirement_mark_requires_real_input_and_is_snapshotted(api_client, project, repository, user,
                                                                 patched_provider, monkeypatch,
                                                                 django_capture_on_commit_callbacks):
    from apps.system.tests.review_helpers import configure_review
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
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    with django_capture_on_commit_callbacks(execute=True):
        result = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert result.status_code == 200, result.data
    release.refresh_from_db()
    assert release.workflow_instance.review_scope.context_is_requirement is True
    assert "需求符合性" in release.workflow_instance.ai_reviews.get().dimensions


def test_rollback_cannot_reenter_completed_ai_node(api_client, project, repository, user,
                                                  patched_provider, django_capture_on_commit_callbacks):
    from apps.system.tests.review_helpers import configure_review

    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
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
    from apps.system.tests.review_helpers import configure_review
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
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
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
        def close(self):
            pass
    def send(*args, **kwargs):
        calls.append(kwargs)
        return Response()
    monkeypatch.setattr("apps.workflow.ai_review_model._ModelSession.post", send)
    config = SimpleNamespace(endpoint="https://model.example", model="review", protocol="anthropic", encrypted_api_key="")
    with pytest.raises(ValueError, match="模型请求失败"):
        _ask(config, [{"role": "user", "content": "私有源码"}])
    assert len(calls) == 1 and calls[0]["allow_redirects"] is False


def test_settings_change_after_submit_does_not_change_review_snapshot(api_client, project, repository, user,
                                                                        patched_provider, monkeypatch,
                                                                        django_capture_on_commit_callbacks):
    from apps.system.tests.review_helpers import configure_review
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
    configure_review({"endpoint": "https://model.example/v1", "model": "first", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    configure_review({"endpoint": "https://model.example/v1", "model": "second", "protocol": "openai", "skill": "code-review-expert"})
    release.refresh_from_db()
    execute_review(release.workflow_instance_id, "ai")
    assert models == ["first"]
    assert release.workflow_instance.ai_reviews.get().settings_version.model == "first"


def test_partial_review_keeps_coverage_paths_and_does_not_advance(api_client, project, repository, user,
                                                                  patched_provider, monkeypatch,
                                                                  django_capture_on_commit_callbacks):
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": p, "new_path": p, "diff": "@@ -1 +1 @@\n-a\n+b"} for p in ("a.py", "b.py")],
        "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review_model, "_ask", lambda *args: ({"action": "finish",
        "dimensions": ["安全"], "reviewed_files": ["a.py"], "findings": []}, "{}"))
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
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
    from apps.system.tests.review_helpers import configure_review
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
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
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


def test_failed_review_can_be_retried_with_original_configuration_and_history(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from apps.workflow.ai_review import execute_review
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    original = configure_review({"endpoint": "https://model.example/v1", "model": "first", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    run = release.workflow_instance.ai_reviews.get()
    run.status = "incomplete"
    run.summary = "部分完成"
    run.coverage = {"total_files": 1, "reviewed_files": 0, "warnings": ["缺口"]}
    run.save(update_fields=["status", "summary", "coverage", "updated_at"])
    old_token = str(run.token)
    configure_review({"endpoint": "https://model.example/v1", "model": "second", "protocol": "openai", "skill": "code-review-expert"})
    seen = []
    monkeypatch.setattr(ai_review_model, "_ask", lambda config, messages: (seen.append(config.model) or {
        "action": "finish", "dimensions": ["安全"], "reviewed_files": ["a.py"], "findings": []}, "{}"))
    url = f"/api/workflow/instances/{release.workflow_instance_id}/ai-review-retry/"
    with django_capture_on_commit_callbacks(execute=False):
        response = api_client.post(url, {"node_id": "ai"}, format="json")
    assert response.status_code == 200, response.data
    run.refresh_from_db()
    assert run.status == "queued" and str(run.token) != old_token
    assert run.settings_version_id == original.id
    assert run.history[0]["status"] == "incomplete" and run.history[0]["coverage"]["warnings"] == ["缺口"]
    assert api_client.post(url, {"node_id": "ai"}, format="json").status_code == 400
    execute_review(release.workflow_instance_id, "ai")
    run.refresh_from_db()
    assert seen == ["first"] and run.status == "completed"
    assert run.instance.tasks.filter(node_id="human", status="pending").count() == 1


def test_skip_requires_manager_reason_and_preserves_human_approval(
    api_client, project, repository, user, patched_provider, django_capture_on_commit_callbacks,
):
    from rest_framework.test import APIClient

    from apps.account.models import User
    from apps.project.models import ProjectMember
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow.ai_review import execute_review

    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    run = instance.ai_reviews.get()
    run.status, run.summary = "failed", "模型失败"
    run.coverage = {"total_files": 1, "reviewed_files": 0, "warnings": ["未覆盖"]}
    run.save(update_fields=["status", "summary", "coverage", "updated_at"])
    old_token = str(run.token)
    url = f"/api/workflow/instances/{instance.id}/ai-review-skip/"
    assert api_client.post(url, {"node_id": "ai", "reason": "  "}, format="json").status_code == 400
    for role in ("developer", "tester", "auditor", "viewer", "maintainer"):
        person = User.objects.create_user(username=f"skip-{role}", password="testpass")
        ProjectMember.objects.create(project=project, user=person, role=role)
        client = APIClient()
        client.force_authenticate(person)
        assert client.post(url, {"node_id": "ai", "reason": "网络故障"}, format="json").status_code == 403
    with django_capture_on_commit_callbacks(execute=False):
        response = api_client.post(url, {"node_id": "ai", "reason": " 网络故障 "}, format="json")
    assert response.status_code == 200, response.data
    run.refresh_from_db()
    instance.refresh_from_db()
    assert run.status == "skipped" and run.skip_reason == "网络故障"
    assert run.skipped_by_id == user.id and run.skipped_at
    assert run.history[0]["coverage"]["warnings"] == ["未覆盖"]
    assert instance.current_node_id == "human" and instance.node_status["ai"] == "skipped"
    assert instance.tasks.filter(node_id="human", status="pending").count() == 1
    execute_review(instance.id, "ai", old_token)
    assert instance.tasks.filter(node_id="human", status="pending").count() == 1
    assert api_client.post(url, {"node_id": "ai", "reason": "再次跳过"}, format="json").status_code == 400
    report = api_client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]
    assert report["status"] == "skipped" and report["skip_reason"] == "网络故障"


def test_stale_queued_delivery_cannot_execute_new_retry(api_client, project, repository, user, patched_provider,
                                                        monkeypatch, django_capture_on_commit_callbacks):
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from apps.workflow.ai_review import execute_review
    from apps.workflow.tasks import execute_ai_review
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    run = instance.ai_reviews.get()
    old_token = str(run.token)
    run.status = "failed"
    run.save(update_fields=["status", "updated_at"])
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/workflow/instances/{instance.id}/ai-review-retry/", {"node_id": "ai"}, format="json").status_code == 200
    called = []
    monkeypatch.setattr(ai_review_model, "_ask", lambda *args: (called.append(True) or {
        "action": "finish", "dimensions": ["安全"], "reviewed_files": ["a.py"], "findings": []}, "{}"))
    execute_review(instance.id, "ai", old_token)
    execute_ai_review.run(str(instance.id), "ai")
    run.refresh_from_db()
    assert run.status == "queued" and not called and not instance.tasks.exists()


def test_recovery_checks_current_project_role_and_revoked_round(api_client, project, repository, user, patched_provider,
                                                                django_capture_on_commit_callbacks):
    from rest_framework.test import APIClient

    from apps.account.models import User
    from apps.project.models import ProjectMember
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow.services import WorkflowEngine

    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    run = instance.ai_reviews.get()
    run.status = "failed"
    run.save(update_fields=["status", "updated_at"])
    retry = f"/api/workflow/instances/{instance.id}/ai-review-retry/"
    skip = f"/api/workflow/instances/{instance.id}/ai-review-skip/"
    software = User.objects.create_user(username="software-admin-recovery", password="testpass")
    member = ProjectMember.objects.create(project=project, user=software, role="software_admin")
    client = APIClient()
    client.force_authenticate(software)
    assert client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]["can_recover"] is True
    member.role = "developer"
    member.save(update_fields=["role"])
    assert client.post(retry, {"node_id": "ai"}, format="json").status_code == 403
    assert client.post(skip, {"node_id": "ai", "reason": "故障"}, format="json").status_code == 403
    admin = User.objects.create_superuser(username="admin-recovery", password="testpass")
    client.force_authenticate(admin)
    with django_capture_on_commit_callbacks(execute=False):
        assert client.post(retry, {"node_id": "ai"}, format="json").status_code == 200
    run.refresh_from_db()
    run.status = "incomplete"
    run.save(update_fields=["status", "updated_at"])
    WorkflowEngine.revoke_instance(instance, user)
    assert client.post(skip, {"node_id": "ai", "reason": "故障"}, format="json").status_code == 400
    assert client.post(retry, {"node_id": "ai"}, format="json").status_code == 400


def test_skip_refuses_corrupt_flow_without_later_human(api_client, project, repository, user, patched_provider,
                                                      django_capture_on_commit_callbacks):
    from apps.system.tests.review_helpers import configure_review

    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    run = instance.ai_reviews.get()
    run.status = "failed"
    run.save(update_fields=["status", "updated_at"])
    instance.node_config_snapshot = [instance.node_config_snapshot[0]]
    instance.save(update_fields=["node_config_snapshot"])
    response = api_client.post(f"/api/workflow/instances/{instance.id}/ai-review-skip/", {"node_id": "ai", "reason": "故障"}, format="json")
    assert response.status_code == 400
    run.refresh_from_db()
    instance.refresh_from_db()
    assert run.status == "failed" and instance.status == "running"


def test_recovery_and_worker_reject_changed_business_identity(api_client, project, repository, user, patched_provider,
                                                              monkeypatch, django_capture_on_commit_callbacks):
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow.ai_review import execute_review
    from apps.workflow.models import WorkflowInstance
    from apps.workflow.services import WorkflowEngine

    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    run = instance.ai_reviews.get()
    run.status = "failed"
    run.save(update_fields=["status", "updated_at"])
    retry = f"/api/workflow/instances/{instance.id}/ai-review-retry/"
    skip = f"/api/workflow/instances/{instance.id}/ai-review-skip/"
    WorkflowInstance.objects.filter(pk=instance.id).update(source_biz_id="错误的发布身份")
    assert api_client.post(retry, {"node_id": "ai"}, format="json").status_code == 400
    assert api_client.post(skip, {"node_id": "ai", "reason": "故障"}, format="json").status_code == 400
    execute_review(instance.id, "ai", run.token)
    run.refresh_from_db()
    assert run.status == "failed" and not instance.tasks.exists()

    WorkflowInstance.objects.filter(pk=instance.id).update(source_biz_id=instance.biz_id)
    real_lock = WorkflowEngine._lock_instance
    def changed_during_lock(source):
        locked = real_lock(source)
        locked.source_biz_id = "锁等待期间变更"
        return locked
    monkeypatch.setattr(WorkflowEngine, "_lock_instance", changed_during_lock)
    assert api_client.post(retry, {"node_id": "ai"}, format="json").status_code == 400
    run.refresh_from_db()
    assert run.status == "failed" and not run.history


def test_expired_worker_is_archived_and_late_result_cannot_replace_retry(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    from datetime import timedelta

    from django.utils import timezone

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from apps.workflow.ai_review import execute_review
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    original = instance.ai_reviews.get()
    old_token = str(original.token)
    calls = []
    def finish(config, messages):
        calls.append(True)
        if len(calls) == 1:
            AIReviewRun.objects.filter(pk=original.pk).update(updated_at=timezone.now() - timedelta(hours=2))
            execute_review(instance.id, "ai", old_token)
            title = "迟到意见"
        else:
            title = "新执行意见"
        return ({"action": "finish", "dimensions": ["安全"], "reviewed_files": ["a.py"], "findings": [
            {"severity": "P1", "title": title, "reason": "理由", "suggestion": "修改"}]}, "{}")
    monkeypatch.setattr(ai_review_model, "_ask", finish)
    execute_review(instance.id, "ai", old_token)
    original.refresh_from_db()
    assert original.status == "completed" and original.findings[0]["title"] == "新执行意见"
    assert original.history[0]["token"] == old_token and original.history[0]["status"] == "failed"
    assert instance.tasks.filter(node_id="human", status="pending").count() == 1


@pytest.mark.django_db(transaction=True)
def test_large_review_resumes_only_unfinished_batches_without_losing_findings(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    import json

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from apps.workflow.ai_review import execute_review
    from utils.provider.base import TagInfo

    monkeypatch.setattr("apps.workflow.ai_review.queue_review", lambda *args: None)
    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    diffs = [{"old_path": name, "new_path": name, "diff": "@@ -1 +1 @@\n-old\n+" + "x" * 7500}
             for name in ("first.py", "second.py", "third.py")]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": diffs, "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review_model, "MAX_INPUT", 50000)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    calls = []

    def ask(config, messages):
        names = [item["new_path"] for item in json.loads(messages[0]["content"])["diffs"]]
        calls.append(names)
        if names == ["second.py"] and calls.count(names) == 1:
            raise ValueError("模拟批次失败")
        return ({"action": "finish", "dimensions": ["安全"], "reviewed_files": names,
                 "findings": [{"severity": "P1", "title": names[0], "reason": "缺少检查", "suggestion": "补充检查", "path": names[0]}]}, "{}")

    monkeypatch.setattr(ai_review_model, "_ask", ask)
    execute_review(instance.id, "ai")
    report = api_client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]
    assert report["status"] == "incomplete"
    assert "first.py" in report["coverage"]["reviewed_paths"]
    assert "second.py" in report["coverage"]["unreviewed_paths"]
    before_reviewed = set(report["coverage"]["reviewed_paths"])
    original_id = next(item["id"] for item in report["findings"] if item["title"] == "first.py")
    original_token = str(instance.ai_reviews.get().token)
    assert not instance.tasks.exists()
    # 后续部署改变分批容量时，仍沿用本轮已经固定的计划和完成证据。
    monkeypatch.setattr(ai_review_model, "MAX_INPUT", 40000)

    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/workflow/instances/{instance.id}/ai-review-retry/", {"node_id": "ai"}, format="json").status_code == 200
    execute_review(instance.id, "ai")
    report = api_client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]
    assert report["status"] == "completed"
    assert report["coverage"]["reviewed_paths"] == ["first.py", "second.py", "third.py"]
    assert [finding["title"] for finding in report["findings"]] == ["first.py", "second.py", "third.py"]
    assert next(item["id"] for item in report["findings"] if item["title"] == "first.py") == original_id
    adopted = api_client.post(f"/api/workflow/instances/{instance.id}/remediations/", {
        "action": "adopt", "node_id": "ai", "finding_id": original_id,
    }, format="json")
    assert adopted.status_code == 200, adopted.data
    assert adopted.data["data"]["item"]["source_token"] == original_token
    assert calls.count(["second.py"]) == 2
    assert all(calls.count([name]) == 1 for name in before_reviewed)
    assert calls.count(["third.py"]) == 1
    assert instance.tasks.filter(node_id="human", status="pending").count() == 1


def test_batch_review_discloses_unreadable_file_and_keeps_workflow_waiting(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    import json

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from apps.workflow.ai_review import execute_review
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "source.py", "new_path": "source.py", "diff": "@@ -1 +1 @@\n-a\n+b"},
                  {"old_path": "asset.bin", "new_path": "asset.bin", "diff": "", "binary": True}],
        "complete": False, "warnings": ["二进制差异不可读取"]}, raising=False)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    def ask(config, messages):
        names = [item["new_path"] for item in json.loads(messages[0]["content"])["diffs"]]
        return ({"action": "finish", "dimensions": ["安全"], "reviewed_files": names, "findings": []}, "{}")
    monkeypatch.setattr(ai_review_model, "_ask", ask)
    execute_review(instance.id, "ai")
    report = api_client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]
    assert report["status"] == "incomplete"
    assert report["coverage"]["reviewed_paths"] == ["source.py"]
    assert report["coverage"]["unreviewed_paths"] == ["asset.bin"]
    assert any("二进制" in warning for warning in report["coverage"]["warnings"])
    assert report["coverage"]["manifest_complete"] is False
    from rest_framework.test import APIClient

    from apps.account.models import User
    from apps.project.models import ProjectMember
    viewer = User.objects.create_user(username="batch-viewer", password="testpass")
    ProjectMember.objects.create(project=project, user=viewer, role="viewer")
    client = APIClient()
    client.force_authenticate(viewer)
    limited = client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]
    assert limited["coverage"]["manifest_complete"] is False
    assert "source.py" not in str(limited) and "asset.bin" not in str(limited)
    assert not instance.tasks.exists()


def test_malformed_or_oversized_diff_is_disclosed_and_never_approved(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from apps.workflow.ai_review import execute_review
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "bad.py", "new_path": "bad.py", "diff": "@@ -1,2 +1,2 @@\n-a\n+b"},
                  {"old_path": "large.py", "new_path": "large.py", "diff": "@@ -1 +1 @@\n-a\n+" + "x" * 150000},
                  {"old_path": "overlap.py", "new_path": "overlap.py", "diff": "@@ -1 +1 @@\n-a\n+b\n@@ -1 +1 @@\n-c\n+d"}],
        "complete": True, "warnings": []}, raising=False)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    called = []
    monkeypatch.setattr(ai_review_model, "_ask", lambda *args: called.append(True))
    execute_review(instance.id, "ai")
    report = api_client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]
    assert report["status"] == "incomplete"
    assert report["coverage"]["unreviewed_paths"] == ["bad.py", "large.py", "overlap.py"]
    assert any("行数不一致" in warning for warning in report["coverage"]["warnings"])
    assert any("超过审查容量" in warning for warning in report["coverage"]["warnings"])
    assert not called and not instance.tasks.exists()


@pytest.mark.django_db(transaction=True)
def test_canceled_review_cannot_save_late_batch_or_advance(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    import json
    import threading

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review, ai_review_model
    from apps.workflow.ai_review import execute_review
    from apps.workflow.services import WorkflowEngine
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    diffs = [{"old_path": name, "new_path": name, "diff": "@@ -1 +1 @@\n-a\n+" + "x" * 7500}
             for name in ("first.py", "second.py")]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {"diffs": diffs, "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review_model, "MAX_INPUT", 50000)
    monkeypatch.setattr(ai_review, "queue_review", lambda *args: None)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    saved_first = threading.Event()
    original_checkpoint = ai_review._checkpoint

    def checkpoint(instance_id, node_id, token, results, outcome):
        saved = original_checkpoint(instance_id, node_id, token, results, outcome)
        if saved and "first.py" in outcome["coverage"].get("reviewed_paths", []):
            saved_first.set()
        return saved

    monkeypatch.setattr(ai_review, "_checkpoint", checkpoint)

    def ask(config, messages):
        names = [item["new_path"] for item in json.loads(messages[0]["content"])["diffs"]]
        if names == ["second.py"]:
            assert saved_first.wait(timeout=5)
            WorkflowEngine.revoke_instance(instance, user)
        return ({"action": "finish", "dimensions": ["安全"], "reviewed_files": names,
                 "findings": [{"severity": "P1", "title": names[0], "reason": "原因", "suggestion": "修复"}]}, "{}")
    monkeypatch.setattr(ai_review_model, "_ask", ask)
    execute_review(instance.id, "ai")
    run = instance.ai_reviews.get()
    assert [finding["title"] for finding in run.findings] == ["first.py"]
    assert run.coverage["unreviewed_paths"] == ["second.py"]
    assert len(run.batch_results) == 2  # 批次计划与已完成的首批
    assert not instance.tasks.exists()
    release.refresh_from_db()
    assert release.status == "draft" and release.workflow_instance_id is None


@pytest.mark.django_db(transaction=True)
def test_batch_can_read_another_batchs_fixed_diff_and_report_its_own_coverage(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    import json

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from apps.workflow.ai_review import execute_review
    from utils.provider.base import TagInfo

    monkeypatch.setattr("apps.workflow.ai_review.queue_review", lambda *args: None)
    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    diffs = [{"old_path": name, "new_path": name, "diff": "@@ -1 +1 @@\n-old\n+" + marker * 7500}
             for name, marker in (("api.py", "a"), ("caller.py", "b"))]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {"diffs": diffs, "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review_model, "MAX_INPUT", 50000)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    batches = []
    def ask(config, messages):
        first = json.loads(messages[0]["content"])
        names = [item["new_path"] for item in first["diffs"]]
        assert first["all_files"] == ["api.py", "caller.py"]
        if names == ["api.py"] and len(messages) == 1:
            return ({"action": "diff", "path": "caller.py"}, '{"action":"diff","path":"caller.py"}')
        if names == ["api.py"]:
            queried = json.loads(messages[-1]["content"])["diffs"]
            assert queried[0]["new_path"] == "caller.py" and queried[0]["diff"] == diffs[1]["diff"]
        batches.append(names)
        findings = [{"severity": "P1", "title": "跨批不兼容", "reason": "调用方不兼容", "suggestion": "同步修改",
                     "path": "caller.py", "side": "new", "line_start": 1, "line_end": 1}] if names == ["api.py"] else []
        return ({"action": "finish", "dimensions": ["安全"] if names == ["api.py"] else ["性能"],
                 "reviewed_files": names, "findings": findings}, "{}")
    monkeypatch.setattr(ai_review_model, "_ask", ask)
    execute_review(instance.id, "ai")
    report = api_client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]
    assert report["status"] == "completed" and {tuple(batch) for batch in batches} == {("api.py",), ("caller.py",)}
    assert report["dimensions"] == []
    assert report["findings"][0]["path"] == "caller.py" and report["findings"][0]["line_start"] == 1
    assert [item["dimensions"] for item in report["coverage"]["batches"]] == [["安全"], ["性能"]]
    assert instance.tasks.filter(node_id="human", status="pending").count() == 1


def test_partial_batch_retry_preserves_identical_finding_identity(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from apps.workflow.ai_review import execute_review
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    diffs = [{"old_path": name, "new_path": name, "diff": "@@ -1 +1 @@\n-old\n+new"}
             for name in ("first.py", "second.py")]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {"diffs": diffs, "complete": True, "warnings": []}, raising=False)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    calls = []
    def ask(config, messages):
        calls.append(True)
        return ({"action": "finish", "dimensions": ["安全"], "reviewed_files": ["first.py"] if len(calls) == 1 else ["first.py", "second.py"],
                 "findings": [{"severity": "P1", "title": "问题", "reason": "原因", "suggestion": "修复", "path": "first.py"}]}, "{}")
    monkeypatch.setattr(ai_review_model, "_ask", ask)
    execute_review(instance.id, "ai")
    before = api_client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]
    assert before["status"] == "incomplete"
    prior_id = before["findings"][0]["id"]
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/workflow/instances/{instance.id}/ai-review-retry/", {"node_id": "ai"}, format="json").status_code == 200
    execute_review(instance.id, "ai")
    after = api_client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]
    assert after["status"] == "completed"
    assert after["findings"][0]["id"] == prior_id == after["history"][0]["findings"][0]["id"]
    adopted = api_client.post(f"/api/workflow/instances/{instance.id}/remediations/", {
        "action": "adopt", "node_id": "ai", "finding_id": prior_id,
    }, format="json")
    assert adopted.status_code == 200, adopted.data
    assert adopted.data["data"]["item"]["finding_id"] == prior_id
    assert adopted.data["data"]["item"]["source_token"] == after["history"][0]["token"]


@pytest.mark.django_db(transaction=True)
def test_large_file_manifest_is_pageable_without_blocking_batches(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    import json

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from apps.workflow.ai_review import execute_review
    from utils.provider.base import TagInfo

    monkeypatch.setattr("apps.workflow.ai_review.queue_review", lambda *args: None)
    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    names = [f"dir/{index:04d}-{'x' * 180}.py" for index in range(1001)]
    diffs = [{"old_path": name, "new_path": name, "diff": "@@ -1 +1 @@\n-a\n+b"} for name in names]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {"diffs": diffs, "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review_model, "MAX_INPUT", 50000)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    def ask(config, messages):
        initial = json.loads(messages[0]["content"])
        assert initial["all_files_total"] == len(names)
        offset = initial["all_files_next"]
        assert isinstance(offset, int) and initial["all_files"] == names[:offset]
        if len(messages) == 1:
            return ({"action": "list_files", "offset": offset}, json.dumps({"action": "list_files", "offset": offset}))
        page = json.loads(messages[-1]["content"])
        if len(messages) == 3:
            end = page["next_offset"] if page["next_offset"] is not None else len(names)
            assert page["files"] == names[offset:end]
            return ({"action": "search_files", "query": "1000-", "offset": 0},
                    json.dumps({"action": "search_files", "query": "1000-", "offset": 0}))
        assert page["files"] == [names[-1]] and page["total"] == 1
        return ({"action": "finish", "dimensions": ["安全"],
                 "reviewed_files": [item["new_path"] for item in initial["diffs"]], "findings": []}, "{}")
    monkeypatch.setattr(ai_review_model, "_ask", ask)
    execute_review(instance.id, "ai")
    report = api_client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]
    assert report["status"] == "completed"
    assert report["coverage"]["reviewed_paths"] == names
    assert len(report["coverage"]["batches"]) > 1


def test_report_exposes_original_configuration_only_to_full_access(api_client, project, repository, user):
    """设置变更后，本轮报告仍展示原模型和技能版本，只读角色不获配置。"""
    from rest_framework.test import APIClient

    from apps.account.models import User
    from apps.project.models import ProjectMember
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow.models import WorkflowInstance

    original = configure_review({"endpoint": "https://model.example/v1", "model": "first-model", "protocol": "openai",
                              "api_key": "private-key", "skill": "code-review-expert"})
    definition = _definition(project, repository, user)
    release = _draft(project, repository, user)
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(release.id),
        source_project=project, created_by=user, node_config_snapshot=definition.node_config)
    AIReviewRun.objects.create(instance=instance, node_id="ai", settings_version=original, status="completed")
    configure_review({"endpoint": "https://other.example/v1", "model": "new-model", "protocol": "anthropic",
                   "api_key": "new-secret", "skill": "code-review-expert"})
    url = f"/api/workflow/instances/{instance.id}/ai-review/"
    response = api_client.get(url)
    data = response.data["data"]["reviews"][0]["configuration"]
    assert data["version_id"] == str(original.id)
    assert data["model"] == "first-model" and data["protocol"] == "openai"
    assert data["skill"]["name"] == "code-review-expert"
    assert data["skill"]["revision"] == original.skill_revision
    assert data["skill"]["source"].startswith("https://github.com/")
    assert "private-key" not in str(response.data) and "new-secret" not in str(response.data)
    viewer = User.objects.create_user(username="config-review-viewer", password="testpass")
    ProjectMember.objects.create(project=project, user=viewer, role="viewer")
    client = APIClient()
    client.force_authenticate(viewer)
    limited = client.get(url)
    assert limited.status_code == 200 and "configuration" not in limited.data["data"]["reviews"][0]
    assert "first-model" not in str(limited.data) and "private-key" not in str(limited.data)


@pytest.mark.django_db(transaction=True)
def test_review_batches_execute_concurrently_and_keep_fixed_results(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    """多批审查同时开始，完成后只生成一次人工待办。"""
    import json
    import threading

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from apps.workflow.ai_review import execute_review
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    diffs = [{"old_path": name, "new_path": name, "diff": "@@ -1 +1 @@\n-old\n+" + "x" * 7500}
             for name in ("one.py", "two.py")]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": diffs, "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review_model, "MAX_INPUT", 50000)
    monkeypatch.setattr("apps.workflow.ai_review.queue_review", lambda *args: None)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    barrier = threading.Barrier(2, timeout=2)
    seen = []

    def ask(config, messages):
        names = [item["new_path"] for item in json.loads(messages[0]["content"])["diffs"]]
        seen.append(names)
        barrier.wait()
        return ({"action": "finish", "dimensions": ["安全"], "reviewed_files": names,
                 "findings": [{"severity": "P1", "title": names[0], "reason": "问题", "suggestion": "修复", "path": names[0]}]}, "{}")

    monkeypatch.setattr(ai_review_model, "_ask", ask)
    execute_review(instance.id, "ai")
    report = api_client.get(f"/api/workflow/instances/{instance.id}/ai-review/").data["data"]["reviews"][0]
    assert report["status"] == "completed", (seen, report)
    assert {tuple(names) for names in seen} == {("one.py",), ("two.py",)}
    assert set(report["coverage"]["reviewed_paths"]) == {"one.py", "two.py"}
    assert {item["title"] for item in report["findings"]} == {"one.py", "two.py"}
    assert instance.tasks.filter(node_id="human", status="pending").count() == 1


@pytest.mark.django_db(transaction=True)
def test_parallel_review_revoke_does_not_wait_for_or_save_late_batch(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    """撤销后丢弃并发迟到结果，不等待在途模型请求或生成待办。"""
    import json
    import threading

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review, ai_review_model
    from apps.workflow.services import WorkflowEngine
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    diffs = [{"old_path": name, "new_path": name, "diff": "@@ -1 +1 @@\n-old\n+" + "x" * 7500}
             for name in ("first.py", "slow.py")]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": diffs, "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review_model, "MAX_INPUT", 50000)
    monkeypatch.setattr(ai_review, "queue_review", lambda *args: None)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    slow_started = threading.Event()
    release_slow = threading.Event()
    slow_finished = threading.Event()
    original_checkpoint = ai_review._checkpoint

    def ask(config, messages):
        names = [item["new_path"] for item in json.loads(messages[0]["content"])["diffs"]]
        if names == ["slow.py"]:
            slow_started.set()
            assert release_slow.wait(5)
            slow_finished.set()
        else:
            assert slow_started.wait(5)
        return ({"action": "finish", "dimensions": ["安全"], "reviewed_files": names, "findings": []}, "{}")

    def checkpoint(instance_id, node_id, token, results, outcome):
        if "first.py" in outcome["coverage"].get("reviewed_paths", []):
            WorkflowEngine.revoke_instance(instance, user)
        return original_checkpoint(instance_id, node_id, token, results, outcome)

    monkeypatch.setattr(ai_review_model, "_ask", ask)
    monkeypatch.setattr(ai_review, "_checkpoint", checkpoint)
    try:
        ai_review.execute_review(instance.id, "ai")
        assert not slow_finished.is_set()
        release.refresh_from_db()
        assert release.status == "draft" and release.workflow_instance_id is None
        assert not instance.tasks.exists()
    finally:
        release_slow.set()
    assert slow_finished.wait(5)
    run = instance.ai_reviews.get()
    assert run.status != "completed" and not instance.tasks.exists()


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("action", ["read", "search"])
def test_parallel_revoked_model_response_never_reads_source_or_calls_model_again(
    action, api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    """两个模型请求均在途时撤销，迟到读取指令不能访问仓库或推进流程。"""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review, ai_review_model
    from apps.workflow.services import WorkflowEngine
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    diffs = [{"old_path": name, "new_path": name, "diff": "@@ -1 +1 @@\n-old\n+" + "x" * 7500}
             for name in ("first.py", "second.py")]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": diffs, "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review_model, "MAX_INPUT", 50000)
    monkeypatch.setattr(ai_review_model, "VALIDATION_INTERVAL", 30)
    monkeypatch.setattr(ai_review, "queue_review", lambda *args: None)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    started = threading.Barrier(3, timeout=5)
    resume = threading.Event()
    finished = threading.Barrier(3, timeout=5)
    calls = []
    reads = []
    monkeypatch.setattr(patched_provider, "get_file_raw", lambda *args, **kwargs: reads.append(args), raising=False)

    def ask(*args):
        calls.append(True)
        started.wait()
        assert resume.wait(5)
        return {"action": action, "path": "first.py", "query": "secret"}, "{}"

    original_batch = ai_review_model._review_batch

    def batch(*args, **kwargs):
        try:
            return original_batch(*args, **kwargs)
        finally:
            finished.wait()

    monkeypatch.setattr(ai_review_model, "_ask", ask)
    monkeypatch.setattr(ai_review_model, "_review_batch", batch)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(ai_review.execute_review, instance.id, "ai")
        try:
            started.wait()
            WorkflowEngine.revoke_instance(instance, user)
        finally:
            resume.set()
        finished.wait()
        future.result(timeout=5)
    assert len(calls) == 2 and not reads
    release.refresh_from_db()
    assert release.status == "draft" and release.workflow_instance_id is None
    assert instance.ai_reviews.get().status != "completed" and not instance.tasks.exists()


def test_process_batch_limit_survives_cancellation():
    """多个轮次共享完整批次上限，取消的等待者不会占用名额。"""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from apps.workflow import ai_review_model

    barrier = threading.Barrier(3, timeout=5)
    release = threading.Event()
    canceled = threading.Event()
    count_lock = threading.Lock()
    active = 0
    peak = 0

    def ask(*args):
        nonlocal active, peak
        with count_lock:
            active += 1
            peak = max(peak, active)
        barrier.wait()
        assert release.wait(5)
        with count_lock:
            active -= 1
        return {}, "{}"

    with ThreadPoolExecutor(max_workers=3) as pool:
        one = pool.submit(ai_review_model._limited_batch, ask, None)
        two = pool.submit(ai_review_model._limited_batch, ask, None)
        try:
            barrier.wait()
            canceled.set()
            third = pool.submit(ai_review_model._limited_batch, ask, canceled)
            with pytest.raises(ValueError, match="失效"):
                third.result(timeout=3)
            assert peak == 2
        finally:
            release.set()
        assert one.result(timeout=5) == ({}, "{}")
        assert two.result(timeout=5) == ({}, "{}")
    assert ai_review_model._limited_batch(lambda: ({"ok": True}, "{}"), None)[0] == {"ok": True}


@pytest.mark.django_db(transaction=True)
def test_single_batch_revoked_while_waiting_never_calls_model(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    """单批等待进程名额时被撤销，不得在名额释放后调用模型。"""
    import time
    from concurrent.futures import ThreadPoolExecutor

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review, ai_review_model
    from apps.workflow.services import WorkflowEngine
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "one.py", "new_path": "one.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review, "queue_review", lambda *args: None)
    monkeypatch.setattr(ai_review_model, "VALIDATION_INTERVAL", 0.05)
    called = []
    monkeypatch.setattr(ai_review_model, "_ask", lambda *args: called.append(True))
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    slots = ai_review_model._BATCH_SLOTS
    assert slots.acquire(timeout=2) and slots.acquire(timeout=2)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(ai_review.execute_review, instance.id, "ai")
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline and instance.ai_reviews.get().status != "running":
                time.sleep(0.02)
            assert instance.ai_reviews.get().status == "running"
            WorkflowEngine.revoke_instance(instance, user)
            future.result(timeout=3)
            assert not called
    finally:
        slots.release()
        slots.release()


@pytest.mark.django_db(transaction=True)
def test_single_batch_revoked_during_model_call_stops_before_source_read(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    """单批模型调用期间撤销，返回后不再读取仓库或请求下一轮模型。"""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review, ai_review_model
    from apps.workflow.services import WorkflowEngine
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": [{"old_path": "one.py", "new_path": "one.py", "diff": "@@ -1 +1 @@\n-a\n+b"}],
        "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review, "queue_review", lambda *args: None)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    entered = threading.Event()
    resume = threading.Event()
    calls = []
    reads = []
    monkeypatch.setattr(patched_provider, "get_file_raw", lambda *args, **kwargs: reads.append(args), raising=False)

    def ask(*args):
        calls.append(True)
        entered.set()
        assert resume.wait(5)
        return {"action": "read", "path": "one.py"}, "{}"

    monkeypatch.setattr(ai_review_model, "_ask", ask)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(ai_review.execute_review, instance.id, "ai")
        try:
            assert entered.wait(5)
            WorkflowEngine.revoke_instance(instance, user)
        finally:
            resume.set()
        future.result(timeout=5)
    assert len(calls) == 1
    assert not reads
    assert not instance.tasks.exists()


@pytest.mark.django_db(transaction=True)
def test_waiting_parallel_batches_do_not_extend_expired_lease(
    api_client, project, repository, user, patched_provider, monkeypatch, django_capture_on_commit_callbacks,
):
    """等待外部模型不会刷新租约，接管后旧批次不能写入。"""
    import threading
    import time
    from concurrent.futures import ThreadPoolExecutor
    from datetime import timedelta

    from django.utils import timezone

    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review, ai_review_model
    from utils.provider.base import TagInfo

    patched_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    diffs = [{"old_path": name, "new_path": name, "diff": "@@ -1 +1 @@\n-old\n+" + "x" * 7500}
             for name in ("first.py", "second.py")]
    monkeypatch.setattr(patched_provider, "review_diff", lambda *args: {
        "diffs": diffs, "complete": True, "warnings": []}, raising=False)
    monkeypatch.setattr(ai_review_model, "MAX_INPUT", 50000)
    monkeypatch.setattr(ai_review_model, "VALIDATION_INTERVAL", 0.05)
    monkeypatch.setattr(ai_review, "queue_review", lambda *args: None)
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    _definition(project, repository, user)
    release = _draft(project, repository, user)
    with django_capture_on_commit_callbacks(execute=False):
        assert api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json").status_code == 200
    release.refresh_from_db()
    instance = release.workflow_instance
    old = instance.ai_reviews.get()
    old_token = old.token
    both = threading.Barrier(3, timeout=5)
    resume = threading.Event()

    def ask(*args):
        both.wait()
        assert resume.wait(5)
        return {"action": "finish", "dimensions": ["安全"], "reviewed_files": [], "findings": []}, "{}"

    monkeypatch.setattr(ai_review_model, "_ask", ask)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(ai_review.execute_review, instance.id, "ai")
        try:
            both.wait()
            stale_time = timezone.now() - timedelta(hours=2)
            AIReviewRun.objects.filter(pk=old.pk).update(updated_at=stale_time)
            time.sleep(0.25)
            old.refresh_from_db()
            assert ai_review.lease_expired(old)
            ai_review.recover_review(instance.id, "ai", user)
            future.result(timeout=3)
            old.refresh_from_db()
            assert old.status == "queued" and old.token != old_token
            assert old.history[-1]["token"] == str(old_token)
            assert not instance.tasks.exists()
        finally:
            resume.set()
