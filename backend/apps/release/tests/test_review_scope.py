"""通过公开接口验证审查上下文与固定范围。"""

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import ProjectMember
from apps.release.models import ReleaseRecord

pytestmark = pytest.mark.django_db
HEAD = "b" * 40


@pytest.fixture
def draft(project, repository, user):
    return ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=user, release_type="rc",
        status="draft", version="VA.1.0.2", tag_name="VA.1.0.2-rc",
        branch="develop", git_hash=HEAD,
    )


def test_draft_review_context_saved_and_retrieved(user, draft):
    client = APIClient()
    client.force_authenticate(user)
    data = {"review_context": "关注鉴权边界", "review_document_paths": ["docs/spec.md", "README.md"]}
    response = client.patch(f"/api/releases/{draft.id}/", data, format="json")
    assert response.status_code == 200, response.data
    result = client.get(f"/api/releases/{draft.id}/")
    assert result.data["data"]["review_context"] == data["review_context"]
    assert result.data["data"]["review_document_paths"] == data["review_document_paths"]


def test_review_context_not_visible_to_maintainer_or_viewer(project, draft):
    draft.review_context = "敏感需求"
    draft.review_document_paths = ["private/spec.md"]
    draft.save()
    client = APIClient()
    for role in ("maintainer", "viewer"):
        user = User.objects.create_user(username=role, password="testpass")
        ProjectMember.objects.create(project=project, user=user, role=role)
        client.force_authenticate(user)
        data = client.get(f"/api/releases/{draft.id}/").data["data"]
        assert "review_context" not in data and "review_document_paths" not in data


def test_review_scope_preserves_fixed_range_and_context(user, project, repository, draft):
    from apps.release.review_scope import capture_review_scope
    from apps.workflow.models import WorkflowDefinition, WorkflowInstance
    from utils.provider.base import TagInfo

    base = "a" * 40
    class Provider:
        def list_tags(self, identity):
            return [TagInfo(name="VA.1.0.1-rc", commit_hash=base)]
        def get_merge_base(self, identity, refs):
            assert refs == [base, HEAD]
            return base
        def get_file_raw(self, identity, path, ref):
            assert path == "docs/spec.md" and ref == HEAD
            return "真实需求"
        def review_diff(self, identity, left, right):
            assert (left, right) == (base, HEAD)
            return {"diffs": [{"old_path": "a.py", "new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}], "complete": True, "warnings": []}
    definition = WorkflowDefinition.objects.create(repository=repository, release_type="rc", name="审批")
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(draft.id), source_project=project, created_by=user)
    draft.review_context = "需求说明"
    draft.review_document_paths = ["docs/spec.md"]
    draft.save()
    scope = capture_review_scope(draft, instance, user, provider=Provider())
    assert scope.base_git_hash == base and scope.head_git_hash == HEAD
    assert scope.documents == {"docs/spec.md": "真实需求"}
    assert scope.context == "需求说明" and scope.status == "ready"
    draft.review_context = "新轮说明"
    draft.save()
    same = capture_review_scope(draft, instance, user, provider=Provider())
    assert same.pk == scope.pk and same.context == "需求说明"
    client = APIClient()
    client.force_authenticate(user)
    response = client.get(f"/api/workflow/instances/{instance.id}/review-scope/")
    assert response.status_code == 200, response.data
    assert response.data["data"]["documents"]["docs/spec.md"] == "真实需求"


@pytest.mark.parametrize("case", ["first", "same", "fork", "missing", "incomplete"])
def test_review_scope_boundaries_are_explicit(case, user, project, repository, draft):
    from rest_framework.exceptions import ValidationError

    from apps.release.review_scope import capture_review_scope
    from apps.workflow.models import WorkflowDefinition, WorkflowInstance
    from utils.provider.base import TagInfo

    base = HEAD if case == "same" else "a" * 40
    class Provider:
        def list_tags(self, identity):
            return [] if case == "first" else [TagInfo(name="VA.1.0.1-rc", commit_hash=base)]
        def get_merge_base(self, identity, refs):
            return "c" * 40 if case == "fork" else base
        def get_file_raw(self, identity, path, ref):
            return None
        def review_diff(self, identity, left, right):
            return {"diffs": [], "complete": False, "warnings": ["远端差异不完整"]}
    if case == "missing":
        draft.review_document_paths = ["missing.md"]
        draft.save()
    definition = WorkflowDefinition.objects.create(repository=repository, release_type="rc", name="审批")
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(draft.id), source_project=project, created_by=user)
    if case in ("fork", "missing"):
        with pytest.raises(ValidationError):
            capture_review_scope(draft, instance, user, provider=Provider())
        assert not hasattr(instance, "review_scope")
    else:
        scope = capture_review_scope(draft, instance, user, provider=Provider())
        assert scope.status == {"first": "first_release", "same": "no_changes", "incomplete": "incomplete"}[case]
        if case == "incomplete":
            assert scope.warnings == ["远端差异不完整"]


def test_review_scope_api_limits_project_roles_and_assigned_approvers(user, project, repository, draft):
    from apps.release.models import ReleaseReviewScope
    from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask

    definition = WorkflowDefinition.objects.create(repository=repository, release_type="rc", name="审批")
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(draft.id), source_project=project, created_by=user)
    ReleaseReviewScope.objects.create(instance=instance, head_git_hash=HEAD, status="ready", context="私有需求", documents={"x.md": "私有文档"}, diffs=[{"diff": "私有源码"}])
    client = APIClient()
    for role in ("maintainer", "viewer", "developer", "tester", "auditor"):
        member = User.objects.create_user(username=f"scope-{role}", password="testpass")
        ProjectMember.objects.create(project=project, user=member, role=role)
        client.force_authenticate(member)
        response = client.get(f"/api/workflow/instances/{instance.id}/review-scope/")
        assert response.status_code == 200
        assert ("documents" in response.data["data"]) == (role not in ("maintainer", "viewer"))
    outsider = User.objects.create_user(username="assigned-outsider", password="testpass")
    WorkflowTask.objects.create(instance=instance, node_id="n1", node_name="审批", approver=outsider)
    client.force_authenticate(outsider)
    assert client.get(f"/api/workflow/instances/{instance.id}/review-scope/").data["data"]["documents"] == {"x.md": "私有文档"}
    unrelated = User.objects.create_user(username="unrelated", password="testpass")
    client.force_authenticate(unrelated)
    assert client.get(f"/api/workflow/instances/{instance.id}/review-scope/").status_code == 404


def test_review_scope_uses_same_repository_history_across_projects(user, project, repository, draft):
    from apps.project.models import Project
    from apps.release.review_scope import capture_review_scope
    from apps.workflow.models import WorkflowDefinition, WorkflowInstance
    from utils.provider.base import TagInfo

    base = "a" * 40
    other = Project.objects.create(code="OTHER", name="其他项目", leader=user, status=1)
    ReleaseRecord.objects.create(project=other, repository=repository, publisher=user, release_type="rc", status="released", version="VA.1.0.1", tag_name="VA.1.0.1-rc", branch="develop", git_hash=base)
    class Provider:
        def list_tags(self, identity):
            return [TagInfo(name="VA.1.0.1-rc", commit_hash="f" * 40), TagInfo(name="VA.9.0.0-rc", commit_hash="e" * 40)]
        def get_merge_base(self, identity, refs):
            return base
        def review_diff(self, identity, left, right):
            assert (left, right) == (base, HEAD)
            return {"diffs": [], "complete": True, "warnings": []}
    definition = WorkflowDefinition.objects.create(repository=repository, release_type="rc", name="审批")
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(draft.id), source_project=project, created_by=user)
    scope = capture_review_scope(draft, instance, user, provider=Provider())
    assert scope.base_git_hash == base
    assert scope.status == "no_changes"


def test_rejects_untrusted_paths_and_non_publisher_update(user, project, draft):
    client = APIClient()
    client.force_authenticate(user)
    for path in ("../secret", "/etc/shadow", "docs/../secret", "a\\b", "a//b"):
        result = client.patch(f"/api/releases/{draft.id}/", {"review_document_paths": [path]}, format="json")
        assert result.status_code == 400
    other = User.objects.create_user(username="other-developer", password="testpass")
    ProjectMember.objects.create(project=project, user=other, role="developer")
    client.force_authenticate(other)
    result = client.patch(f"/api/releases/{draft.id}/", {"review_context": "越权修改"}, format="json")
    assert result.status_code == 403


def test_only_review_context_prevents_empty_draft_cleanup(user, draft, mock_git_provider, monkeypatch):
    original = "\n  第一行\n第二行\n\n"
    draft.review_context = original
    draft.save()
    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: mock_git_provider)
    client = APIClient()
    client.force_authenticate(user)
    response = client.post("/api/releases/", {
        "project": str(draft.project_id), "repository": str(draft.repository_id), "release_type": "rc",
        "branch": "develop", "version": draft.version,
    }, format="json")
    assert response.status_code == 201, response.data
    assert ReleaseRecord.objects.filter(pk=draft.pk).exists()
    patched = client.patch(f"/api/releases/{draft.id}/", {"review_context": original}, format="json")
    assert patched.status_code == 200
    assert client.get(f"/api/releases/{draft.id}/").data["data"]["review_context"] == original


def test_future_assigned_nonmember_can_read_snapshot(user, project, repository, draft):
    from apps.release.models import ReleaseReviewScope
    from apps.workflow.models import WorkflowDefinition, WorkflowInstance

    assignee = User.objects.create_user(username="future-approver", password="testpass")
    definition = WorkflowDefinition.objects.create(repository=repository, release_type="rc", name="审批")
    instance = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id=str(draft.id), source_project=project, created_by=user,
        node_config_snapshot=[{"node_id": "next", "approvers": [{"type": "user", "user_id": str(assignee.id)}]}],
    )
    ReleaseReviewScope.objects.create(instance=instance, head_git_hash=HEAD, status="ready", context="需求")
    client = APIClient()
    client.force_authenticate(assignee)
    result = client.get(f"/api/workflow/instances/{instance.id}/review-scope/")
    assert result.status_code == 200
    assert result.data["data"]["context"] == "需求"


def test_formal_review_scope_uses_existing_fixed_baseline(user, project, repository, draft):
    from apps.release.review_scope import capture_review_scope
    from apps.workflow.models import WorkflowDefinition, WorkflowInstance

    base = "a" * 40
    draft.release_type = "formal"
    draft.tag_name = "VA.1.0.2"
    draft.changes_initialized = True
    draft.base_tag = "VA.1.0.1"
    draft.base_git_hash = base
    draft.save()
    class Provider:
        def list_tags(self, identity):
            raise AssertionError("正式版不能重新读取移动 Tag")
        def get_merge_base(self, identity, refs):
            return base
        def review_diff(self, identity, left, right):
            assert (left, right) == (base, HEAD)
            return {"diffs": [], "complete": True, "warnings": []}
    definition = WorkflowDefinition.objects.create(repository=repository, release_type="formal", name="审批")
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(draft.id), source_project=project, created_by=user)
    result = capture_review_scope(draft, instance, user, provider=Provider())
    assert result.base_tag == "VA.1.0.1" and result.base_git_hash == base


def test_future_assigned_nonmember_can_open_workflow_details(user, project, repository, draft):
    from apps.release.models import ReleaseReviewScope
    from apps.workflow.models import WorkflowDefinition, WorkflowInstance

    assignee = User.objects.create_user(username="future-detail", password="testpass")
    definition = WorkflowDefinition.objects.create(repository=repository, release_type="rc", name="审批")
    instance = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id=str(draft.id), source_project=project, created_by=user,
        node_config_snapshot=[{"node_id": "next", "approvers": [{"type": "user", "user_id": str(assignee.id)}]}],
    )
    draft.workflow_instance = instance
    draft.save(update_fields=["workflow_instance"])
    ReleaseReviewScope.objects.create(instance=instance, head_git_hash=HEAD, status="ready")
    client = APIClient()
    client.force_authenticate(assignee)
    result = client.get(f"/api/workflow/instances/{instance.id}/")
    assert result.status_code == 200
    assert result.data["data"]["id"] == str(instance.id)


def test_future_approver_of_historical_round_cannot_read_current_release(user, project, repository, draft):
    from apps.release.models import ReleaseReviewScope
    from apps.workflow.models import WorkflowDefinition, WorkflowInstance

    assignee = User.objects.create_user(username="old-future-approver", password="testpass")
    definition = WorkflowDefinition.objects.create(repository=repository, release_type="rc", name="审批")
    old = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id=str(draft.id), source_project=project, created_by=user,
        node_config_snapshot=[{"node_id": "next", "approvers": [{"type": "user", "user_id": str(assignee.id)}]}],
    )
    current = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(draft.id), source_project=project, created_by=user)
    ReleaseReviewScope.objects.create(instance=old, head_git_hash=HEAD, status="ready", context="旧轮依据")
    draft.workflow_instance = current
    draft.release_doc = "新轮敏感说明"
    draft.branch = "private-new-branch"
    draft.git_hash = "c" * 40
    draft.save()
    client = APIClient()
    client.force_authenticate(assignee)
    detail = client.get(f"/api/workflow/instances/{old.id}/")
    assert detail.status_code == 200
    assert detail.data["data"]["release_doc"] == ""
    assert detail.data["data"]["branch"] == "" and detail.data["data"]["git_hash"] == ""
    scope = client.get(f"/api/workflow/instances/{old.id}/review-scope/")
    assert scope.data["data"]["context"] == "旧轮依据"
