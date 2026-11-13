"""通过公开 REST、真实文件与隔离 SVN/HTTP 验证整次打包目录归档。"""
from pathlib import Path

import pytest

from apps.release.tests.test_oa_archive import archive_case as _archive_case
from apps.release.tests.test_oa_archive_submission import oa_http as _oa_http
from apps.release.tests.test_oa_archive_svn import (
    history_case as _history_case,
)
from apps.release.tests.test_oa_archive_svn import (
    send_file,
)
from apps.release.tests.test_oa_archive_svn import (
    svn_sandbox as _svn_sandbox,
)

archive_case = _archive_case
history_case = _history_case
oa_http = _oa_http
svn_sandbox = _svn_sandbox
pytestmark = pytest.mark.django_db


def prepare_directory(client, release, task, **extra):
    return client.post(f"/api/releases/{release.id}/oa-archive/prepare/", {
        "task_id": str(task.id), "scope": "directory", "path": ".", **extra,
    }, format="json")


def test_多文件打包只提供一个完整目录并保存目录申请(archive_case, oa_http):
    client, release, task = archive_case
    root = Path(task.workspace_path) / "artifacts"
    (root / "第二个.zip").write_bytes(b"second")
    task.artifact_info.append({"id": "artifact-2", "path": "第二个.zip", "size": 6})
    task.save()
    choices = client.get(f"/api/releases/{release.id}/oa-archive/options/").data["data"]["directories"]
    assert len(choices) == 1
    assert choices[0]["task_id"] == str(task.id)
    assert choices[0]["scope"] == "directory"
    assert choices[0]["path"] == "."
    assert choices[0]["artifact_count"] == 2
    result = prepare_directory(client, release, task)
    assert result.status_code == 200, result.data
    data = result.data["data"]
    assert data["selection"] == {"task_id": str(task.id), "scope": "directory", "path": ".", "source_kind": "local"}
    assert data["source"]["current"]["artifact_count"] == 2
    assert data["form"]["git_svn"] == ""
    sent = send_file(client, release, data["selection"], data["form"])
    assert sent.status_code == 201, sent.data
    record = sent.data["data"]
    assert record["source"]["scope"] == "directory"
    assert record["source"]["path"] == "."
    assert record["source"]["artifact_id"] is None
    assert send_file(client, release, data["selection"], data["form"], record["submission_id"]).data["data"] == record
    assert send_file(client, release, data["selection"], data["form"]).status_code == 400
    again = send_file(client, release, {**data["selection"], "previous_id": record["id"], "confirmation": "reapply"}, data["form"])
    assert again.status_code == 201
    assert again.data["data"]["previous_id"] == record["id"]
    assert len(oa_http.requests) == 2
    release.publisher.is_superuser = True
    release.publisher.save()
    assert client.delete(f"/api/packages/tasks/{task.id}/").status_code == 400


@pytest.mark.parametrize("extra", [{"path": "软件.zip"}, {"path": "子目录"}, {"path": "../"}, {"path": "%2e"}, {"artifact_id": "artifact-1"}])
def test_目录选择不能冒充单文件或任意子目录(archive_case, extra):
    client, release, task = archive_case
    assert prepare_directory(client, release, task, **extra).status_code == 400


def test_准备之后本地目录清空则发送重新拒绝(archive_case, oa_http):
    client, release, task = archive_case
    data = prepare_directory(client, release, task).data["data"]
    (Path(task.workspace_path) / "artifacts/软件.zip").unlink()
    response = send_file(client, release, data["selection"], data["form"])
    assert response.status_code == 400, response.data
    assert oa_http.requests == []
    assert client.get(f"/api/releases/{release.id}/oa-archive/options/").data["data"]["directories"] == []


def test_旧文件历史不改写且不同任务目录身份独立(archive_case, oa_http):
    from apps.package.models import PackageTask
    from apps.release.tests.test_oa_archive import prepare

    client, release, task = archive_case
    old = prepare(client, release, task).data["data"]
    old_record = send_file(client, release, old["selection"], old["form"]).data["data"]
    directory = prepare_directory(client, release, task).data["data"]
    current = send_file(client, release, directory["selection"], directory["form"])
    assert current.status_code == 201
    assert current.data["data"]["previous_id"] is None
    assert old_record["source"]["path"] == "软件.zip"
    assert old_record["source"]["scope"] == "file"
    other = PackageTask.objects.create(
        release=release, project=release.project, repository=release.repository,
        triggered_by=release.publisher, name="另一次成功打包", status="success",
        workspace_path=task.workspace_path, config_snapshot=task.config_snapshot, artifact_info=task.artifact_info,
    )
    other_data = prepare_directory(client, release, other).data["data"]
    assert send_file(client, release, other_data["selection"], other_data["form"]).status_code == 201
    history = client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"]
    assert len(history) == 3
    assert history[-1] == old_record
    assert len(oa_http.requests) == 3


@pytest.mark.parametrize("supplemented", [False, True])
def test_本地清理后的SVN归档使用整个当前目录而非文件地址(history_case, oa_http, supplemented):
    client, release, task, _ = history_case
    if supplemented:
        task.artifact_info = []
        task.save()
    result = prepare_directory(client, release, task, source_kind="svn")
    assert result.status_code == 200, result.data
    data = result.data["data"]
    assert data["form"]["git_svn"] == task.stage_info["svn_push"]["remote_url"]
    assert data["source"]["supplemented"] is supplemented
    assert data["source"]["current"]["artifact_count"] >= 1
    assert "size" not in data["source"]["original"]
    result = send_file(client, release, data["selection"], data["form"])
    assert result.status_code == 201, result.data
    assert result.data["data"]["source"]["artifact"]["current"]["kind"] == "dir"
    assert oa_http.requests[0]["body"]["git_svn"] == data["form"]["git_svn"]


@pytest.mark.parametrize("failure,state", [("delete", "missing"), ("empty", "empty_directory"), ("file", "not_directory"), ("credential", "credential_invalid"), ("network", "network_error")])
def test_目录准备后删除清空变文件或无法核验均不向OA派发(history_case, svn_sandbox, oa_http, tmp_path, failure, state):
    client, release, task, credential = history_case
    data = prepare_directory(client, release, task).data["data"]
    if failure in ("delete", "empty", "file"):
        checkout = tmp_path / "directory-change"
        svn_sandbox.svn("checkout", svn_sandbox.url, str(checkout))
        target = checkout / "task"
        svn_sandbox.svn("delete", str(target) + "@")
        if failure == "empty":
            target.mkdir()
            (target / "release-V1.2.3.md").write_text("系统生成发布说明")
            svn_sandbox.svn("add", str(target))
        elif failure == "file":
            target.write_bytes(b"not a directory")
            svn_sandbox.svn("add", str(target))
        svn_sandbox.svn("commit", str(checkout), "-m", "更改隔离目录")
    elif failure == "credential":
        credential.set_data({"username": "reader", "password": "invalid"})
        credential.save()
    else:
        svn_sandbox.stop()
    result = send_file(client, release, data["selection"], {**data["form"], "git_svn": "https://manual.example/elsewhere"})
    assert result.status_code in (400, 409, 502), result.data
    assert result.data["data"]["state"] == state
    assert oa_http.requests == []
