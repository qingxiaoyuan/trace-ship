"""正式工作流不可绕过，API 边界回归。"""

import pytest
from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord
from apps.workflow.models import WorkflowDefinition

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("mode", ["empty", "missing_source", "direct_push"])
def test_formal_rejects_bypass(user, project, repository, mode):
    api = APIClient()
    api.force_authenticate(user)
    WorkflowDefinition.objects.create(
        repository=repository,
        project=project,
        name="空正式流程",
        biz_type="release",
        release_type="formal",
        node_config=[],
    )
    release = ReleaseRecord.objects.create(
        repository=repository,
        project=project,
        publisher=user,
        release_type="formal",
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        status="pending" if mode == "direct_push" else "draft",
        release_doc="说明",
        git_hash="a" * 40,
    )
    action = "push-tag" if mode == "direct_push" else "submit-audit"
    response = api.post(f"/api/releases/{release.id}/{action}/")
    assert response.status_code == 400, response.data
    assert any(word in response.data["message"] for word in ("来源 RC", "正式审批", "审批节点"))


def test_formal_requires_all_nodes_and_publishes_only_approved_source(user, project, repository, monkeypatch):
    from datetime import UTC, datetime

    from utils.provider.base import CommitInfo, TagInfo

    api = APIClient()
    api.force_authenticate(user)
    sha = "a" * 40
    rc = ReleaseRecord.objects.create(
        repository=repository,
        project=project,
        publisher=user,
        release_type="rc",
        status="released",
        version="VA.9.0.0",
        tag_name="VA.9.0.0-rc",
        git_hash=sha,
    )

    class Remote:
        tags = [TagInfo(name=rc.tag_name, commit_hash=sha)]

        def list_tags(self, *args):
            return self.tags

        def list_release_commits(self, *args):
            return [
                CommitInfo(
                    hash=sha,
                    author="开发",
                    author_email="",
                    message="feat: 已测试代码",
                    committed_at=datetime(2026, 10, 1, tzinfo=UTC),
                )
            ]

        def list_release_merge_requests(self, *args):
            return []

        def create_tag(self, repo_identity, tag_name, commit_hash, message=""):
            tag = TagInfo(name=tag_name, commit_hash=commit_hash, message=message)
            self.tags.append(tag)
            return tag

    remote = Remote()
    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: remote)
    created = api.post(
        "/api/releases/",
        {
            "project": str(project.id),
            "repository": str(repository.id),
            "release_type": "formal",
            "source_rc": str(rc.id),
            "version": "VA.1.0.0",
            "package_config_ids": [],
        },
        format="json",
    )
    assert created.status_code == 201, created.data
    identity = created.data["data"]["id"]
    assert api.post(f"/api/releases/{identity}/generate-doc/").status_code == 200
    definition = WorkflowDefinition.objects.create(
        repository=repository,
        project=project,
        name="正式审批",
        biz_type="release",
        release_type="formal",
        node_config=[],
    )
    empty = api.post(f"/api/releases/{identity}/submit-audit/")
    assert empty.status_code == 400 and "审批节点" in empty.data["message"]
    node = {
        "node_id": "test",
        "node_name": "测试确认",
        "mode": "any",
        "approvers": [{"type": "user", "user_id": str(user.id)}],
    }
    definition.node_config = [
        node,
        {"node_id": "invalid", "approvers": [{"type": "user", "user_id": "00000000-0000-0000-0000-000000000001"}]},
    ]
    definition.save()
    invalid = api.post(f"/api/releases/{identity}/submit-audit/")
    assert invalid.status_code == 400 and "有效审批人" in invalid.data["message"]
    definition.node_config = [node]
    definition.save()
    submitted = api.post(f"/api/releases/{identity}/submit-audit/")
    assert submitted.status_code == 200, submitted.data
    assert api.post(f"/api/releases/{identity}/push-tag/").status_code == 400
    tasks = api.get("/api/workflow/tasks/todo/").data["data"]["results"]
    approved = api.post(f"/api/workflow/tasks/{tasks[0]['id']}/approve/", {"comment": "测试确认通过"}, format="json")
    assert approved.status_code == 200, approved.data
    detail = api.get(f"/api/releases/{identity}/").data["data"]
    assert detail["status"] == "released"
    assert remote.tags[-1].commit_hash == sha
    assert remote.tags[-1].name == detail["tag_name"]
