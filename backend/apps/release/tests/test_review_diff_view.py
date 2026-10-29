"""验证固定差异接口的轮次隔离和逐次授权。"""

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import ProjectMember
from apps.release.models import ReleaseRecord, ReleaseReviewScope
from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask

pytestmark = pytest.mark.django_db


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
