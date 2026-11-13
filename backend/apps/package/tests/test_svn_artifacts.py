"""通过任务公开接口验证清理、原始依据与 SVN 当前文件的区别。"""
from pathlib import Path

import pytest
from django.utils import timezone

from apps.package.models import PackageTask
from apps.package.services.cleanup import cleanup_expired_artifacts
from apps.package.tests.svn_sandbox import svn_sandbox as _svn_sandbox
from apps.package.tests.test_task_reading import download_context as _download_context
from apps.package.tests.test_task_reading import reading_context as _reading_context

# 导出共用的公开 API 场景 fixture，测试只通过接口观察生产行为。
download_context = _download_context
reading_context = _reading_context
svn_sandbox = _svn_sandbox

pytestmark = pytest.mark.django_db


def test_cleanup_preserves_manifest_but_disables_local_download(download_context):
    context = download_context
    (context.artifacts / "installer.zip").write_bytes(b"package")
    PackageTask.objects.filter(pk=context.task.pk).update(
        finished_at=timezone.now() - timezone.timedelta(days=40),
    )
    url = f"/api/packages/tasks/{context.task.id}/"
    before = context.client.get(url).json()["data"]["artifact_info"][0]
    assert before["local_available"] is True

    assert cleanup_expired_artifacts()["cleaned"] == 1
    after = context.client.get(url).json()["data"]
    assert after["artifact_info"] == [{**before, "local_available": False}]
    assert after["can_push_svn"] is False
    assert not Path(context.artifacts).exists()
    assert cleanup_expired_artifacts()["cleaned"] == 0
    for suffix in ("artifacts/installer/download/", "download-all/"):
        response = context.client.get(url + suffix)
        assert response.status_code == 404
        assert "清理" in response.json()["message"]


@pytest.fixture
def svn_task(download_context, svn_sandbox):
    from apps.credential.models import Credential

    context = download_context
    credential = Credential.objects.create(
        name="隔离 SVN", cred_type="svn_password", owner=context.manager, is_active=True,
    )
    credential.set_data({"username": "reader", "password": "isolated-pass"})
    credential.save()
    task = context.task
    task.artifact_info = [{
        "id": "old", "path": "目录 空格/安装包@1%.zip", "name": "安装包@1%.zip",
        "size": 3, "sha256": "historical-hash",
    }]
    task.config_snapshot = {"svn_url": svn_sandbox.url, "svn_credential_id": str(credential.id), "svn_push_enabled": True}
    task.stage_info = {"svn_push": {"status": "success", "remote_url": svn_sandbox.url + "/task"}}
    task.save()
    context.credential = credential
    context.svn = svn_sandbox
    context.svn_api = f"/api/packages/tasks/{task.id}/svn-artifacts/"
    return context



def test_manifest_recovers_current_file_without_replacing_original_evidence(svn_task):
    response = svn_task.client.get(svn_task.svn_api)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["mode"] == "manifest"
    entry = data["entries"][0]
    assert entry["source"] == "artifact_manifest"
    assert entry["path"] == "目录 空格/安装包@1%.zip"
    assert entry["state"] == "available"
    assert entry["original"] == {"size": 3, "sha256": "historical-hash", "revision": None}
    assert entry["current"]["kind"] == "file"
    assert entry["current"]["size"] == 15
    assert entry["current"]["revision"] == "1"
    assert entry["url"].endswith("/task/%E7%9B%AE%E5%BD%95%20%E7%A9%BA%E6%A0%BC/%E5%AE%89%E8%A3%85%E5%8C%85%401%25.zip")


def test_uploaded_manifest_recovers_unknown_original_metadata_and_excludes_system_doc(svn_task):
    task = svn_task.task
    task.artifact_info = []
    task.stage_info["svn_push"]["files"] = ["目录 空格/安装包@1%.zip", "release-V1.0.0.md"]
    task.save()
    response = svn_task.client.get(svn_task.svn_api)
    entries = response.json()["data"]["entries"]
    assert len(entries) == 1
    assert entries[0]["source"] == "upload_manifest"
    assert entries[0]["original"] == {"size": None, "sha256": None, "revision": None}
    assert entries[0]["state"] == "available"


def test_missing_manifest_browses_only_task_directory_and_marks_supplement(svn_task):
    task = svn_task.task
    task.artifact_info = []
    task.save()
    root = svn_task.client.get(svn_task.svn_api).json()["data"]
    assert root["mode"] == "browse"
    assert {entry["name"] for entry in root["entries"]} == {"目录 空格", "release-V1.0.0.md"}
    child = svn_task.client.get(svn_task.svn_api, {"path": "目录 空格"}).json()["data"]
    assert child["path"] == "目录 空格"
    assert child["entries"][0]["source"] == "svn_supplement"
    assert child["entries"][0]["path"] == "目录 空格/安装包@1%.zip"
    assert child["entries"][0]["original"] == {"size": None, "sha256": None, "revision": None}
    file_as_dir = svn_task.client.get(svn_task.svn_api, {"path": "目录 空格/安装包@1%.zip"})
    assert file_as_dir.status_code == 400
    assert file_as_dir.json()["data"]["state"] == "not_directory"


def test_svn_access_errors_remain_distinct_from_missing_file(svn_task):
    credential = svn_task.credential
    credential.set_data({"username": "blocked", "password": "isolated-pass"})
    credential.save()
    entry = svn_task.client.get(svn_task.svn_api).json()["data"]["entries"][0]
    assert entry["state"] == "forbidden"
    assert entry["current"] is None

    credential.set_data({"username": "reader", "password": "wrong-password"})
    credential.save()
    entry = svn_task.client.get(svn_task.svn_api).json()["data"]["entries"][0]
    assert entry["state"] == "credential_invalid"
    assert "wrong-password" not in str(entry)


def test_selection_is_reverified_after_current_file_overwrite_and_delete(svn_task, tmp_path):
    relative = "目录 空格/安装包@1%.zip"
    selection = svn_task.client.get(svn_task.svn_api, {"file": relative})
    assert selection.status_code == 200
    assert selection.json()["data"]["current"]["size"] == 15
    workcopy = tmp_path / "checkout"
    svn_task.svn.svn("checkout", svn_task.svn.url + "/task", str(workcopy))
    (workcopy / relative).write_bytes(b"changed")
    svn_task.svn.svn("commit", str(workcopy), "-m", "隔离覆盖")
    changed = svn_task.client.get(svn_task.svn_api, {"file": relative}).json()["data"]
    assert changed["current"]["size"] == 7
    assert changed["current"]["revision"] == "2"
    assert changed["original"]["size"] == 3
    svn_task.svn.svn("delete", str(workcopy / relative) + "@")
    svn_task.svn.svn("commit", str(workcopy), "-m", "隔离删除")
    deleted = svn_task.client.get(svn_task.svn_api, {"file": relative})
    assert deleted.status_code == 409
    assert deleted.json()["data"]["state"] == "missing"


def test_connection_failure_is_not_missing_and_browse_has_same_feedback(svn_task):
    svn_task.svn.stop()
    response = svn_task.client.get(svn_task.svn_api)
    assert response.json()["data"]["entries"][0]["state"] == "network_error"
    svn_task.task.artifact_info = []
    svn_task.task.save()
    response = svn_task.client.get(svn_task.svn_api)
    assert response.status_code == 400
    assert response.json()["data"]["state"] == "network_error"


@pytest.mark.parametrize("path", ["../other-task", "/other-task", "a/../../other-task", "%2e%2e/other-task", "%252e%252e/other-task", "a\\..\\other-task", "svn://other-host/repo"])
def test_path_escape_is_rejected_before_any_svn_connection(reading_context, path):
    response = reading_context.client.get(f"/api/packages/tasks/{reading_context.task.id}/svn-artifacts/", {"path": path})
    assert response.status_code == 400
    assert response.json()["data"]["state"] == "invalid_path"


def test_members_may_read_svn_but_maintainers_gain_no_download_permission(svn_task):
    from apps.account.models import User
    from apps.project.models import ProjectMember

    ProjectMember.objects.filter(project=svn_task.project, user=svn_task.reader).update(role="maintainer")
    assert svn_task.client.get(svn_task.svn_api).status_code == 200
    assert svn_task.client.get(f"/api/packages/tasks/{svn_task.task.id}/artifacts/old/download/").status_code == 403
    outsider = User.objects.create_user(username="svn-outsider")
    svn_task.client.force_authenticate(outsider)
    assert svn_task.client.get(svn_task.svn_api).status_code == 404
    svn_task.client.force_authenticate(svn_task.reader)
    ProjectMember.objects.filter(project=svn_task.project, user=svn_task.reader).delete()
    assert svn_task.client.get(svn_task.svn_api).status_code == 404


def test_missing_directory_or_credential_basis_never_uses_current_configuration(svn_task):
    task = svn_task.task
    task.stage_info = {}
    task.save()
    response = svn_task.client.get(svn_task.svn_api)
    assert response.status_code == 400
    assert response.json()["data"]["state"] == "unverifiable"
    task.stage_info = {"svn_push": {"remote_url": svn_task.svn.url + "/task"}}
    task.config_snapshot["svn_credential_id"] = None
    task.save()
    response = svn_task.client.get(svn_task.svn_api)
    assert response.status_code == 400
    assert response.json()["data"]["state"] == "unverifiable"


def test_invalid_credential_reference_is_reported_as_unverifiable(svn_task):
    svn_task.task.config_snapshot["svn_credential_id"] = "historical-invalid-uuid"
    svn_task.task.save()
    response = svn_task.client.get(svn_task.svn_api)
    assert response.status_code == 400
    assert response.json()["data"]["state"] == "unverifiable"


def test_cleaned_task_still_verifies_svn_and_does_not_claim_other_files(svn_task):
    artifact = svn_task.task.artifact_info[0]
    local = svn_task.artifacts / artifact["path"]
    local.parent.mkdir(parents=True)
    local.write_bytes(b"old")
    PackageTask.objects.filter(pk=svn_task.task.pk).update(
        finished_at=timezone.now() - timezone.timedelta(days=40),
    )
    cleanup_expired_artifacts()
    entry = svn_task.client.get(svn_task.svn_api).json()["data"]["entries"][0]
    assert entry["state"] == "available"
    assert entry["local_available"] is False
    assert entry["original"]["sha256"] == "historical-hash"
    assert svn_task.client.get(svn_task.svn_api, {"file": "release-V1.0.0.md"}).status_code == 400
    assert svn_task.client.get(svn_task.svn_api, {"file": "../other-task/other.zip"}).status_code == 400


def test_original_manifest_document_is_not_excluded_just_for_its_name(svn_task):
    svn_task.task.artifact_info = [{"id": "doc", "path": "release-V1.0.0.md"}]
    svn_task.task.save()
    entry = svn_task.client.get(svn_task.svn_api).json()["data"]["entries"][0]
    assert entry["source"] == "artifact_manifest"
    assert entry["path"] == "release-V1.0.0.md"
    assert entry["state"] == "available"


def test_supplement_selection_verifies_file_and_rejects_directory(svn_task):
    svn_task.task.artifact_info = []
    svn_task.task.save()
    selected = svn_task.client.get(svn_task.svn_api, {"file": "目录 空格/安装包@1%.zip"})
    assert selected.status_code == 200
    assert selected.json()["data"]["source"] == "svn_supplement"
    assert selected.json()["data"]["original"] == {"size": None, "sha256": None, "revision": None}
    directory = svn_task.client.get(svn_task.svn_api, {"file": "目录 空格"})
    assert directory.status_code == 409
    assert directory.json()["data"]["state"] == "not_file"


def test_manifest_queries_are_paged_without_losing_known_files(svn_task):
    svn_task.task.artifact_info.append({"id": "doc", "path": "release-V1.0.0.md"})
    svn_task.task.save()
    first = svn_task.client.get(svn_task.svn_api, {"page_size": 1}).json()["data"]
    assert len(first["entries"]) == 1
    assert first["total"] == 2
    second = svn_task.client.get(svn_task.svn_api, {"page_size": 1, "page": 2}).json()["data"]
    assert second["entries"][0]["path"] == "release-V1.0.0.md"


@pytest.mark.parametrize("remote_url", ["svn://[", "svn://user:secret@example.test/repo/task", "svn://elsewhere.test/repo/task"])
def test_invalid_or_out_of_scope_saved_urls_remain_unverifiable(reading_context, remote_url):
    task = reading_context.task
    task.config_snapshot = {"svn_url": "svn://example.test/repo"}
    task.stage_info = {"svn_push": {"remote_url": remote_url}}
    task.save()
    response = reading_context.client.get(f"/api/packages/tasks/{task.id}/svn-artifacts/")
    assert response.status_code == 400
    assert response.json()["data"]["state"] == "unverifiable"
    assert "secret" not in response.content.decode()
