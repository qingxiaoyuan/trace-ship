"""验证固定差异接口的轮次隔离和逐次授权。"""

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import ProjectMember
from apps.release.models import ReleaseRecord, ReleaseReviewScope
from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask

pytestmark = pytest.mark.django_db


@pytest.fixture
def filtered_round(user, project, repository):
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from apps.workflow.models import AIReviewRun

    definition = WorkflowDefinition.objects.create(repository=repository, release_type="rc", name="过滤展示")
    release = ReleaseRecord.objects.create(project=project, repository=repository, publisher=user,
        release_type="rc", version="VA.1.0.2", tag_name="VA.1.0.2-rc", git_hash="b" * 40)
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(release.id),
        source_project=project, created_by=user)
    paths = ["vendor/pkg.py", "config/app.yaml", "src/large.py", "src/service.py", "src/moved.py"]
    diffs = [{"old_path": path, "new_path": path, "diff": "@@ -1 +1 @@\n-old\n+new"} for path in paths]
    diffs[2].update(diff="", too_large=True)
    diffs[4].update(old_path="vendor/moved.py", renamed_file=True)
    scope = ReleaseReviewScope.objects.create(instance=instance, base_git_hash="a" * 40, head_git_hash="b" * 40,
        status="incomplete", manifest_complete=True, diffs=diffs, warnings=[
            "文件 vendor/pkg.py 的差异不可完整读取", "文件 src/large.py 的差异不可完整读取", "远端清单提示",
        ])
    config = configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    run = AIReviewRun.objects.create(instance=instance, node_id="ai", settings_version=config, status="partial")
    names, plan, blocked = ai_review_model._batch_plan(run, scope)
    run.batch_results = {"__plan__": ai_review_model._save_plan(scope, names, plan, blocked)}
    run.coverage = ai_review_model._batch_outcome(scope, names, plan, blocked, {})["coverage"]
    run.save()
    client = APIClient()
    client.force_authenticate(user)
    return client, scope, run


@pytest.mark.parametrize("queued", [False, True])
def test_default_diff_hides_policy_files_but_keeps_real_gaps(filtered_round, queued):
    client, scope, run = filtered_round
    if queued:
        run.status, run.batch_results = "queued", {}
        run.coverage = {"total_files": len(scope.diffs), "reviewed_files": 0, "warnings": scope.warnings}
        run.save()
    for endpoint in ("review-diff", "review-scope"):
        result = client.get(f"/api/workflow/instances/{scope.instance_id}/{endpoint}/").data["data"]
        assert [item["new_path"] for item in result["diffs"]] == ["src/large.py", "src/service.py", "src/moved.py"]
        assert result["excluded_files"] == 2
        assert result["manifest_complete"] is True
        assert result["diffs"][-1]["old_path"] == "vendor/moved.py"
        assert result["warnings"] == ["文件 src/large.py 的差异不可完整读取", "远端清单提示"]
    scope.refresh_from_db()
    assert len(scope.diffs) == 5


@pytest.mark.parametrize("complete", [True, False, None])
def test_diff_api_keeps_manifest_evidence_independent_of_body_status(filtered_round, complete):
    client, scope, _ = filtered_round
    scope.manifest_complete = complete
    scope.save(update_fields=["manifest_complete"])
    for endpoint in ("review-diff", "review-scope"):
        result = client.get(f"/api/workflow/instances/{scope.instance_id}/{endpoint}/").data["data"]
        assert result["status"] == "incomplete"
        assert result["manifest_complete"] is complete


def test_retry_queue_uses_saved_exclusions_even_when_current_summary_is_cleared(
    filtered_round, user, django_capture_on_commit_callbacks, monkeypatch,
):
    client, scope, run = filtered_round
    instance = scope.instance
    instance.status, instance.current_node_id = "running", "ai"
    instance.save()
    ReleaseRecord.objects.filter(pk=instance.biz_id).update(status="pending", workflow_instance=instance)
    run.status = "incomplete"
    run.save()
    with django_capture_on_commit_callbacks(execute=False):
        response = client.post(f"/api/workflow/instances/{instance.id}/ai-review-retry/", {"node_id": "ai"}, format="json")
    assert response.status_code == 200, response.data
    run.refresh_from_db()
    assert run.status == "queued" and run.coverage == {} and run.history
    # 重试展示不受之后发布的策略影响，只读取本轮保存的排除依据。
    monkeypatch.setattr("apps.workflow.ai_review_presentation.diff_exclusion", lambda _: None)
    for endpoint in ("review-diff", "review-scope"):
        result = client.get(f"/api/workflow/instances/{instance.id}/{endpoint}/").data["data"]
        assert result["excluded_files"] == 2
        assert [item["new_path"] for item in result["diffs"]] == ["src/large.py", "src/service.py", "src/moved.py"]


def test_reports_only_expose_skip_counts_and_preserve_audit_evidence(filtered_round):
    client, scope, run = filtered_round
    run.history = [{"token": "previous", "status": "partial", "coverage": run.coverage, "findings": []}]
    run.save()
    result = client.get(f"/api/workflow/instances/{scope.instance_id}/ai-review/").data["data"]["reviews"][0]
    for coverage in (result["coverage"], result["history"][0]["coverage"]):
        assert coverage["excluded_files"] == 2 and "excluded_paths" not in coverage
        assert "src/large.py" in coverage["unreviewed_paths"]
        assert "vendor/pkg.py" not in str(coverage)
    run.refresh_from_db()
    assert len(run.coverage["excluded_paths"]) == len(run.history[0]["coverage"]["excluded_paths"]) == 2


def test_policy_context_warnings_are_summarized_without_hiding_execution_gaps(filtered_round):
    client, scope, run = filtered_round
    run.coverage["warnings"] = [
        "请求的上下文未读取：vendor/pkg.py（第三方依赖目录）", "补充文档按策略跳过：config/reference.yaml",
        "请求的上下文未读取：src/large.py（单文件差异超出容量）", "补充文档按策略跳过：src/large.py",
        "上下文未完整读取：src/dependency.py（源码行 1–100）",
    ]
    run.history = [{"coverage": run.coverage, "findings": []}]
    run.save()
    result = client.get(f"/api/workflow/instances/{scope.instance_id}/ai-review/").data["data"]["reviews"][0]
    for coverage in (result["coverage"], result["history"][0]["coverage"]):
        assert coverage["warnings"] == [*run.coverage["warnings"][2:], "2 个补充上下文按策略跳过，未纳入本轮审查"]
    run.refresh_from_db()
    assert len(run.coverage["warnings"]) == 5


@pytest.mark.parametrize("case", ["old_report", "old_plan", "other_node", "historical_finding", "historical_gap"])
def test_existing_review_evidence_is_not_hidden_by_current_policy(filtered_round, case, monkeypatch):
    from apps.workflow import ai_review_model
    from apps.workflow.models import AIReviewRun

    client, scope, run = filtered_round
    if case == "old_report":
        run.batch_results, run.coverage = {}, {"total_files": 5, "reviewed_files": 5}
    elif case == "old_plan":
        monkeypatch.setattr(ai_review_model, "diff_exclusion", lambda item: None)
        names, plan, blocked = ai_review_model._batch_plan(run, scope)
        manifest = ai_review_model._save_plan(scope, names, plan, blocked)
        manifest.update(version=2)
        manifest.pop("policy_version")
        run.batch_results = {"__plan__": manifest}
        run.coverage = {}
    elif case == "other_node":
        AIReviewRun.objects.create(instance=scope.instance, node_id="old", settings_version=run.settings_version,
            status="completed", coverage={"reviewed_paths": ["vendor/pkg.py"]})
    elif case == "historical_finding":
        run.history = [{"findings": [{"path": "vendor/pkg.py", "title": "历史意见"}]}]
    else:
        run.history = [{"coverage": {"unreviewed_fragments": [{"path": "vendor/pkg.py", "reason": "历史读取失败"}]}}]
    run.save()
    result = client.get(f"/api/workflow/instances/{scope.instance_id}/review-diff/").data["data"]
    assert "vendor/pkg.py" in [item["new_path"] for item in result["diffs"]]
    assert result["excluded_files"] == (1 if case.startswith("historical") else 0)


def test_review_diff_requires_current_full_access_and_uses_round_snapshot(user, project, repository):
    definition = WorkflowDefinition.objects.create(repository=repository, release_type="rc", name="审批")
    release = ReleaseRecord.objects.create(project=project, repository=repository, publisher=user,
        release_type="rc", status="draft", version="VA.1.0.2", tag_name="VA.1.0.2-rc", git_hash="b" * 40)
    def make_round(content):
        instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(release.id),
            source_project=project, created_by=user)
        ReleaseReviewScope.objects.create(instance=instance, base_git_hash="a" * 40, head_git_hash="b" * 40,
            status="ready", warnings=["文件 私有源码 的差异不可完整读取"],
            diffs=[{"old_path": "same.py", "new_path": "same.py", "diff": content}])
        return instance
    old = make_round("@@ -1 +1 @@\n-old secret\n+old result")
    new = make_round("@@ -1 +1 @@\n-new secret\n+new result")
    client = APIClient()
    client.force_authenticate(user)
    old_url = f"/api/workflow/instances/{old.id}/review-diff/"
    new_url = f"/api/workflow/instances/{new.id}/review-diff/"
    assert client.get(old_url).data["data"]["diffs"][0]["diff"].endswith("+old result")
    assert client.get(new_url).data["data"]["diffs"][0]["diff"].endswith("+new result")

    viewer = User.objects.create_user(username="diff-viewer", password="testpass")
    membership = ProjectMember.objects.create(project=project, user=viewer, role="maintainer")
    task = WorkflowTask.objects.create(instance=old, node_id="human", node_name="审批", approver=viewer)
    client.force_authenticate(viewer)
    assert client.get(old_url).status_code == 404
    summary = client.get(f"/api/workflow/instances/{old.id}/review-scope/")
    assert "私有源码" not in str(summary.data)
    membership.role = "viewer"
    membership.save()
    assert client.get(old_url).status_code == 404
    membership.role = "developer"
    membership.save()
    assert client.get(old_url).status_code == 200
    membership.delete()
    assert client.get(old_url).status_code == 200
    assert client.get(new_url).status_code == 404
    task.delete()
    assert client.get(old_url).status_code == 404

    from apps.project.models import Project
    other = Project.objects.create(code="DIFF-OTHER", name="其他项目", leader=viewer, status=1)
    ProjectMember.objects.create(project=other, user=viewer, role="manager")
    assert client.get(old_url).status_code == 404

    # 现有发布的真实项目与被篡改的项目快照不一致，不能跨项目开放。
    WorkflowInstance.objects.filter(pk=old.pk).update(source_project=other)
    for suffix in ("review-diff", "review-scope", "ai-review"):
        assert client.get(f"/api/workflow/instances/{old.id}/{suffix}/").status_code == 404
    WorkflowInstance.objects.filter(pk=old.pk).update(source_project=project)

    # 删除发布后仍可按保留的原项目和本轮审批分配读取固定历史。
    WorkflowTask.objects.create(instance=old, node_id="human", node_name="审批", approver=viewer)
    release_id = str(release.id)
    release.delete()
    assert client.get(old_url).status_code == 200
    client.force_authenticate(user)
    assert client.get(old_url).status_code == 200

    # 直接批量修改业务身份不能沿用原发布项目快照获得源码访问。
    WorkflowInstance.objects.filter(pk=old.pk).update(biz_id=release_id.replace("-", ""))
    for actor in (user, viewer):
        client.force_authenticate(actor)
        for suffix in ("review-diff", "review-scope", "ai-review"):
            assert client.get(f"/api/workflow/instances/{old.id}/{suffix}/").status_code == 404


@pytest.mark.parametrize("case", ["ambiguous", "malformed_hunk", "overlapping_hunks"])
def test_unreliable_location_is_not_given_a_fabricated_line(case, user, project, repository, mock_git_provider,
                                                           monkeypatch, django_capture_on_commit_callbacks):
    from apps.release.services import ReleaseService
    from apps.system.tests.review_helpers import configure_review
    from apps.workflow import ai_review_model
    from utils.provider.base import TagInfo

    monkeypatch.setattr(ReleaseService, "_get_provider", lambda *args, **kwargs: mock_git_provider)
    mock_git_provider.tags = [TagInfo(name="VA.1.0.1-rc", commit_hash="a" * 40)]
    diffs = [
        {"old_path": "same.py", "new_path": "rename.py", "diff": "@@ -1 +1 @@\n-old\n+one"},
        {"old_path": "same.py", "new_path": "another.py", "diff": "@@ -1 +1 @@\n-other\n+two"},
    ] if case == "ambiguous" else [{"old_path": "same.py", "new_path": "same.py", "diff": (
        "@@ -1,1 +1,1 @@\n-old\n+new\n+extra" + ("\n@@ -1 +1 @@\n-x\n+y" if case == "overlapping_hunks" else "")
    )}]
    monkeypatch.setattr(mock_git_provider, "review_diff", lambda *args: {"diffs": diffs, "complete": True, "warnings": []}, raising=False)
    side, line = ("old", 1) if case == "ambiguous" else ("new", 1 if case == "overlapping_hunks" else 2)
    monkeypatch.setattr(ai_review_model, "_ask", lambda *args: ({"action": "finish", "dimensions": ["安全"],
        "reviewed_files": [item["new_path"] for item in diffs], "findings": [{"severity": "P1", "title": "问题",
            "reason": "错误", "suggestion": "修复", "path": "same.py", "side": side, "line_start": line, "line_end": line}]}, "{}"))
    configure_review({"endpoint": "https://model.example/v1", "model": "review", "protocol": "openai", "skill": "code-review-expert"})
    WorkflowDefinition.objects.create(project=project, repository=repository, name="AI 审批", biz_type="release",
        release_type="rc", is_active=True, created_by=user,
        node_config=[{"node_id": "ai", "node_type": "ai_review"}, {"node_id": "human", "approvers": [{"type": "leader"}]}])
    release = ReleaseRecord.objects.create(project=project, repository=repository, publisher=user,
        release_type="rc", status="draft", version="VA.1.0.2-rc", tag_name="VA.1.0.2-rc",
        branch="develop", git_hash="b" * 40, release_doc="有效说明")
    client = APIClient()
    client.force_authenticate(user)
    with django_capture_on_commit_callbacks(execute=True):
        response = client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
    assert response.status_code == 200, response.data
    release.refresh_from_db()
    report = client.get(f"/api/workflow/instances/{release.workflow_instance_id}/ai-review/").data["data"]["reviews"][0]
    if case == "ambiguous":
        finding = report["findings"][0]
        assert finding["path"] == "same.py" and "line_start" not in finding and "side" not in finding
    else:
        # 损坏的差异不能声称已审查；未经审查的文件不得生成虚构位置。
        assert report["status"] == "incomplete" and report["findings"] == []
        assert report["coverage"]["unreviewed_paths"] == ["same.py"]
