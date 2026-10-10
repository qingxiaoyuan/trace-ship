"""通过发布与版本 API 验证仓库级编号和占用。"""

import pytest
from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord
from apps.workflow.models import WorkflowDefinition
from utils.provider.base import TagInfo

pytestmark = pytest.mark.django_db


@pytest.fixture
def api(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def remote(monkeypatch, mock_git_provider):
    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: mock_git_provider)
    return mock_git_provider


def test_rc_number_uses_released_history_not_drafts(api, repository, project, user, remote):
    for version, status in [("VA.1.0.7", "released"), ("VA.1.0.99", "draft")]:
        ReleaseRecord.objects.create(
            repository=repository,
            project=project,
            publisher=user,
            release_type="rc",
            version=version,
            tag_name=version + "-rc",
            status=status,
        )
    result = api.get(f"/api/repositories/{repository.id}/next-version/?release_type=rc")
    assert result.status_code == 200, result.data
    assert result.data["data"]["next_version"] == "VA.1.0.8"
    assert result.data["data"]["all_types"]["formal"]["next_version"] == "VA.1.0.0"


def test_same_version_different_dates_cannot_enter_two_workflows(api, repository, project, user, remote):
    WorkflowDefinition.objects.create(
        repository=repository,
        project=project,
        name="RC审批",
        biz_type="release",
        release_type="rc",
        node_config=[
            {
                "node_id": "test",
                "node_name": "测试确认",
                "mode": "any",
                "approvers": [{"type": "user", "user_id": str(user.id)}],
            }
        ],
    )
    drafts = [
        ReleaseRecord.objects.create(
            repository=repository,
            project=project,
            publisher=user,
            release_type="rc",
            version="VA.1.0.1",
            tag_name=f"VA.1.0.1-rc_{date}",
            status="draft",
            release_doc="说明",
            git_hash="a" * 40,
        )
        for date in ["20261009", "20261010"]
    ]
    first = api.post(f"/api/releases/{drafts[0].id}/submit-audit/")
    assert first.status_code == 200, first.data
    conflict = api.post(f"/api/releases/{drafts[1].id}/submit-audit/")
    assert conflict.status_code == 400
    assert "已有同版本在发布" in conflict.data["message"]
    repeat = api.post(f"/api/releases/{drafts[0].id}/submit-audit/")
    assert repeat.status_code == 200
    assert repeat.data["data"]["workflow_instance_id"] == first.data["data"]["workflow_instance_id"]


def test_unknown_push_result_is_reconciled_only_for_own_tag(api, repository, project, user, remote, monkeypatch):
    from utils.provider.exceptions import ConnectionError

    WorkflowDefinition.objects.create(
        repository=repository, project=project, name="RC", biz_type="release", release_type="rc", node_config=[]
    )
    record = ReleaseRecord.objects.create(
        repository=repository,
        project=project,
        publisher=user,
        release_type="rc",
        version="VA.1.0.1",
        tag_name="VA.1.0.1-rc",
        status="draft",
        release_doc="说明",
        git_hash="a" * 40,
    )

    def create_and_timeout(repo_identity, tag_name, commit_hash, message=""):
        remote.tags.append(TagInfo(name=tag_name, commit_hash=commit_hash, message=message))
        raise ConnectionError("远端成功后连接中断")

    monkeypatch.setattr(remote, "create_tag", create_and_timeout)
    result = api.post(f"/api/releases/{record.id}/submit-audit/")
    assert result.status_code == 400
    result = api.post(f"/api/releases/{record.id}/retry-push-tag/")
    assert result.status_code == 200, result.data
    assert api.get(f"/api/releases/{record.id}/").data["data"]["status"] == "released"


def test_foreign_same_sha_tag_is_not_adopted(api, repository, project, user, remote):
    record = ReleaseRecord.objects.create(
        repository=repository,
        project=project,
        publisher=user,
        release_type="rc",
        version="VA.1.0.1",
        tag_name="VA.1.0.1-rc",
        status="rejected",
        release_doc="说明",
        git_hash="a" * 40,
    )
    remote.tags = [TagInfo(name=record.tag_name, commit_hash=record.git_hash)]
    result = api.post(f"/api/releases/{record.id}/retry-push-tag/")
    assert result.status_code == 400, result.data
    assert api.get(f"/api/releases/{record.id}/").data["data"]["status"] == "rejected"


@pytest.mark.django_db(transaction=True)
def test_postgresql_serializes_same_version_submissions(repository, project, user, remote):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("需要 PostgreSQL 仓库行锁")
    WorkflowDefinition.objects.create(
        repository=repository,
        project=project,
        name="RC审批",
        biz_type="release",
        release_type="rc",
        node_config=[
            {
                "node_id": "test",
                "node_name": "确认",
                "mode": "any",
                "approvers": [{"type": "user", "user_id": str(user.id)}],
            }
        ],
    )
    drafts = [
        ReleaseRecord.objects.create(
            repository=repository,
            project=project,
            publisher=user,
            release_type="rc",
            version="VA.1.0.1",
            tag_name=f"VA.1.0.1-rc_{day}",
            status="draft",
            release_doc="说明",
        )
        for day in ("20261009", "20261010")
    ]
    barrier = Barrier(2)

    def submit(identity):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(user)
        try:
            barrier.wait(timeout=10)
            return client.post(f"/api/releases/{identity}/submit-audit/")
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(submit, [release.id for release in drafts]))
    assert sorted(result.status_code for result in results) == [200, 400]
    loser = next(result for result in results if result.status_code == 400)
    assert "已有同版本在发布" in loser.data["message"]


@pytest.mark.parametrize("end_action", ["revoke", "reject"])
def test_ending_workflow_releases_version_for_other_draft(api, repository, project, user, remote, end_action):
    WorkflowDefinition.objects.create(
        repository=repository,
        project=project,
        name="RC审批",
        biz_type="release",
        release_type="rc",
        node_config=[
            {
                "node_id": "test",
                "node_name": "确认",
                "mode": "any",
                "approvers": [{"type": "user", "user_id": str(user.id)}],
            }
        ],
    )
    drafts = [
        ReleaseRecord.objects.create(
            repository=repository,
            project=project,
            publisher=user,
            release_type="rc",
            version="VA.1.0.1",
            tag_name="VA.1.0.1-rc",
            status="draft",
            release_doc="说明",
        )
        for _ in range(2)
    ]
    first = api.post(f"/api/releases/{drafts[0].id}/submit-audit/")
    assert first.status_code == 200
    if end_action == "revoke":
        instance = first.data["data"]["workflow_instance_id"]
        ended = api.post(f"/api/workflow/instances/{instance}/revoke/")
    else:
        task = api.get("/api/workflow/tasks/todo/").data["data"]["results"][0]
        ended = api.post(f"/api/workflow/tasks/{task['id']}/reject/", {"comment": "测试未通过"})
    assert ended.status_code == 200, ended.data
    second = api.post(f"/api/releases/{drafts[1].id}/submit-audit/")
    assert second.status_code == 200, second.data


def test_old_failed_request_cannot_retry_over_another_claim(api, repository, project, user, remote):
    from apps.release.models import ReleaseVersionClaim

    old = ReleaseRecord.objects.create(
        repository=repository,
        project=project,
        publisher=user,
        release_type="rc",
        version="VA.1.0.1",
        tag_name="VA.1.0.1-rc",
        status="rejected",
        git_hash="a" * 40,
    )
    current = ReleaseRecord.objects.create(
        repository=repository,
        project=project,
        publisher=user,
        release_type="rc",
        version="VA.1.0.1",
        tag_name="VA.1.0.1-rc_20261010",
        status="pending",
    )
    ReleaseVersionClaim.objects.create(
        repository=repository, release_type="rc", base_version="1.0.1", release=current, tag_name=current.tag_name
    )
    response = api.post(f"/api/releases/{old.id}/retry-push-tag/")
    assert response.status_code == 400 and "已有同版本在发布" in response.data["message"]
    assert not remote.tags


def test_deleting_legacy_success_keeps_number_consumed(api, repository, project, user, remote):
    old = ReleaseRecord.objects.create(
        repository=repository,
        project=project,
        publisher=user,
        release_type="rc",
        version="VA.1.0.9",
        tag_name="VA.1.0.9-rc",
        status="released",
    )
    remote.tags = [TagInfo(name=old.tag_name)]
    deleted = api.post(f"/api/releases/{old.id}/delete-released/", {"tag_name": old.tag_name})
    assert deleted.status_code == 200, deleted.data
    next_version = api.get(f"/api/repositories/{repository.id}/next-version/?release_type=rc")
    assert next_version.data["data"]["next_version"] == "VA.1.0.10"


@pytest.mark.django_db(transaction=True)
def test_postgresql_termination_waits_for_retry(api, repository, project, user, remote, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("需要 PostgreSQL 仓库行锁")
    record = ReleaseRecord.objects.create(
        repository=repository,
        project=project,
        publisher=user,
        release_type="rc",
        version="VA.1.0.1",
        tag_name="VA.1.0.1-rc",
        status="rejected",
        git_hash="a" * 40,
    )
    writing, resume, deleting, deleted = Event(), Event(), Event(), Event()
    original = remote.create_tag

    def pause_create(*args, **kwargs):
        writing.set()
        assert resume.wait(10)
        return original(*args, **kwargs)

    monkeypatch.setattr(remote, "create_tag", pause_create)

    def request(retry):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(user)
        try:
            if retry:
                return client.post(f"/api/releases/{record.id}/retry-push-tag/")
            deleting.set()
            return client.delete(f"/api/releases/{record.id}/")
        finally:
            if not retry:
                deleted.set()
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        retry = executor.submit(request, True)
        assert writing.wait(10)
        termination = executor.submit(request, False)
        try:
            assert deleting.wait(10)
            assert not deleted.wait(1), "终止删除没有等待正在推送的申请"
        finally:
            resume.set()
        assert retry.result(timeout=10).status_code == 200
        assert termination.result(timeout=10).status_code == 400
    assert api.get(f"/api/releases/{record.id}/").data["data"]["status"] == "released"
