"""RC Tag 清理在业务 API 保留历史并保护最后引用。"""

import pytest
from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord
from utils.provider.base import TagInfo

pytestmark = pytest.mark.django_db


@pytest.fixture
def api(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def source(project, repository, user):
    rc = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        publisher=user,
        release_type="rc",
        status="released",
        version="VA.1.0.9",
        tag_name="VA.1.0.9-rc",
        git_hash="a" * 40,
        release_doc="RC历史说明",
    )
    ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        publisher=user,
        release_type="formal",
        status="released",
        version="VA.1.0.1",
        tag_name="VA.1.0.1",
        git_hash=rc.git_hash,
        source_rc=rc,
    )
    return rc


@pytest.fixture
def remote(source, monkeypatch, mock_git_provider):
    mock_git_provider.tags = [
        TagInfo(name=source.tag_name, commit_hash=source.git_hash),
        TagInfo(name="VA.1.0.1", commit_hash=source.git_hash),
    ]
    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: mock_git_provider)
    return mock_git_provider


def test_cleanup_retains_release_history_and_is_idempotent(api, source, remote):
    response = api.post(f"/api/releases/{source.id}/cleanup-tag/", {"tag_name": source.tag_name}, format="json")
    assert response.status_code == 200
    assert response.data["data"]["status"] == "success"
    detail = api.get(f"/api/releases/{source.id}/").data["data"]
    assert detail["status"] == "released" and detail["release_doc"] == "RC历史说明"
    assert detail["tag_cleanup_status"] == "cleaned"
    assert source.tag_name not in [tag.name for tag in remote.tags]
    repeat = api.post(f"/api/releases/{source.id}/cleanup-tag/", {"tag_name": source.tag_name}, format="json")
    assert repeat.data["data"]["status"] == "already_cleaned"


def test_cleanup_blocks_busy_tasks_and_last_formal_delete(api, source, remote):
    from apps.package.models import PackageTask

    task = PackageTask.objects.create(
        project=source.project,
        repository=source.repository,
        release=source,
        tag_name=source.tag_name,
        version=source.version,
        status="queued",
        commit_hash=source.git_hash,
    )
    result = api.post(f"/api/releases/{source.id}/cleanup-tag/", {"tag_name": source.tag_name}, format="json")
    assert result.data["data"]["status"] == "blocked"
    task.status = "success"
    task.save()
    assert (
        api.post(f"/api/releases/{source.id}/cleanup-tag/", {"tag_name": source.tag_name}, format="json").data["data"][
            "status"
        ]
        == "success"
    )
    formal = source.formal_promotions.get()
    blocked = api.post(f"/api/releases/{formal.id}/delete-released/", {"tag_name": formal.tag_name}, format="json")
    assert blocked.status_code == 400
    assert formal.tag_name in [tag.name for tag in remote.tags]


def test_bulk_cleanup_mixed_results_and_retry(api, source, remote, monkeypatch):
    from utils.provider.exceptions import ConnectionError

    other = ReleaseRecord.objects.create(
        project=source.project,
        repository=source.repository,
        publisher=source.publisher,
        release_type="rc",
        status="released",
        tag_name="VA.1.0.8-rc",
        version="VA.1.0.8",
        git_hash="b" * 40,
    )
    items = [{"id": str(source.id), "tag_name": source.tag_name}, {"id": str(other.id), "tag_name": other.tag_name}]
    original = remote.delete_tag

    def failed(*args):
        raise ConnectionError("超时")

    monkeypatch.setattr(remote, "delete_tag", failed)
    first = api.post("/api/releases/cleanup-tags/", {"items": items}, format="json")
    assert first.status_code == 200, first.data
    assert [r["status"] for r in first.data["data"]] == ["failure", "blocked"]
    monkeypatch.setattr(remote, "delete_tag", original)
    retry = api.post("/api/releases/cleanup-tags/", {"items": items[:1]}, format="json")
    assert retry.data["data"][0]["status"] == "success"
    history = api.get(f"/api/releases/{source.id}/").data["data"]["cleanup_history"]
    assert [item["status"] for item in history] == ["failure", "success"]


def test_external_missing_is_not_reported_as_platform_deletion(api, source, remote):
    remote.tags = remote.tags[1:]
    result = api.post(f"/api/releases/{source.id}/cleanup-tag/", {"tag_name": source.tag_name}, format="json")
    assert result.data["data"]["status"] == "external_missing"


def test_modified_rc_and_readonly_member_cannot_cleanup(api, source, remote, user):
    from apps.project.models import ProjectMember

    remote.tags[0].commit_hash = "f" * 40
    result = api.post(f"/api/releases/{source.id}/cleanup-tag/", {"tag_name": source.tag_name}, format="json")
    assert result.data["data"]["status"] == "blocked"
    # 所有者/项目负责人也会放行，换用普通查看成员验证权限。
    from apps.account.models import User

    viewer = User.objects.create_user(username="cleanup_viewer")
    ProjectMember.objects.create(project=source.project, user=viewer, role="viewer")
    api.force_authenticate(viewer)
    result = api.post(
        "/api/releases/cleanup-tags/", {"items": [{"id": str(source.id), "tag_name": source.tag_name}]}, format="json"
    )
    assert result.data["data"][0]["status"] == "blocked"
    assert source.tag_name in [tag.name for tag in remote.tags]


@pytest.mark.django_db(transaction=True)
def test_postgresql_task_creation_waits_for_cleanup(api, source, remote, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections, connection

    from apps.package.models import PackageConfig, PackageImage

    if connection.vendor != "postgresql":
        pytest.skip("需要 PostgreSQL 仓库行锁")
    image = PackageImage.objects.create(name="测试镜像", image="test:image")
    config = PackageConfig.objects.create(
        project_component=source.project.project_components.get(repository=source.repository), name="打包", image=image
    )
    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", lambda *args: None)
    deleting, resume, task_started, task_done = Event(), Event(), Event(), Event()
    original = remote.delete_tag

    def pause_delete(*args):
        deleting.set()
        assert resume.wait(10)
        original(*args)

    monkeypatch.setattr(remote, "delete_tag", pause_delete)

    def request(cleanup):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(source.publisher)
        try:
            if cleanup:
                return client.post(
                    f"/api/releases/{source.id}/cleanup-tag/", {"tag_name": source.tag_name}, format="json"
                )
            task_started.set()
            return client.post(
                f"/api/packages/configs/{config.id}/trigger/", {"release_id": str(source.id)}, format="json"
            )
        finally:
            if not cleanup:
                task_done.set()
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        cleaned = executor.submit(request, True)
        assert deleting.wait(10)
        created = executor.submit(request, False)
        try:
            assert task_started.wait(10)
            assert not task_done.wait(1), "任务创建未等待清理释放仓库锁"
        finally:
            resume.set()
        assert cleaned.result(timeout=10).data["data"]["status"] == "success"
        assert created.result(timeout=10).status_code == 201


def test_repository_delete_cannot_bypass_reference_protection(api, source, remote, monkeypatch):
    monkeypatch.setattr("apps.repository.services.get_provider", lambda *args: remote)
    endpoint = f"/api/repositories/{source.repository_id}/delete-tag/"
    assert api.post(endpoint, {"tag_name": source.tag_name}).status_code == 400
    assert (
        api.post(f"/api/releases/{source.id}/cleanup-tag/", {"tag_name": source.tag_name}).data["data"]["status"]
        == "success"
    )
    assert api.post(endpoint, {"tag_name": "VA.1.0.1"}).status_code == 400
    ReleaseRecord.objects.create(
        project=source.project,
        repository=source.repository,
        publisher=source.publisher,
        release_type="formal",
        status="released",
        version="VA.1.0.2",
        tag_name="VA.1.0.2",
        git_hash=source.git_hash,
        source_rc=source,
    )
    remote.tags.append(TagInfo(name="VA.1.0.2", commit_hash=source.git_hash))
    assert api.post(endpoint, {"tag_name": "VA.1.0.1"}).status_code == 200
    assert api.get(f"/api/releases/{source.id}/source-reference/").data["data"]["reference"] == "VA.1.0.2"


def test_delete_timeout_reconciles_without_claiming_platform_deleted_it(api, source, remote, monkeypatch):
    from utils.provider.exceptions import ConnectionError

    delete = remote.delete_tag

    def delete_then_timeout(*args):
        delete(*args)
        raise ConnectionError("删除后断线")

    monkeypatch.setattr(remote, "delete_tag", delete_then_timeout)
    endpoint = f"/api/releases/{source.id}/cleanup-tag/"
    assert api.post(endpoint, {"tag_name": source.tag_name}).data["data"]["status"] == "failure"
    retried = api.post(endpoint, {"tag_name": source.tag_name}).data["data"]
    assert retried["status"] == "reconciled_missing"
    detail = api.get(f"/api/releases/{source.id}/").data["data"]
    assert detail["status"] == "released"
    assert [attempt["status"] for attempt in detail["cleanup_history"]] == ["failure", "reconciled_missing"]


def test_original_rc_does_not_allow_removing_only_formal_reference(api, source, remote, monkeypatch):
    monkeypatch.setattr("apps.repository.services.get_provider", lambda *args: remote)
    result = api.post(f"/api/repositories/{source.repository_id}/delete-tag/", {"tag_name": "VA.1.0.1"})
    assert result.status_code == 400
    formal = source.formal_promotions.get()
    available = api.get(f"/api/releases/{formal.id}/source-reference/")
    assert available.data["data"]["available"] is True
