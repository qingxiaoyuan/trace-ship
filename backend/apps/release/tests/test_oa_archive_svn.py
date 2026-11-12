"""公开 REST、真实隔离 SVN 与 HTTP 串起历史文件归档；不连接业务服务。"""
from uuid import uuid4

import pytest

from apps.credential.models import Credential
from apps.package.tests.svn_sandbox import svn_sandbox as _svn_sandbox
from apps.release.tests.test_oa_archive import archive_case as _archive_case
from apps.release.tests.test_oa_archive_submission import oa_http as _oa_http

archive_case = _archive_case
svn_sandbox = _svn_sandbox
oa_http = _oa_http
pytestmark = pytest.mark.django_db
RELATIVE = "目录 空格/安装包@1%.zip"


@pytest.fixture
def history_case(archive_case, svn_sandbox):
    client, release, task = archive_case
    credential = Credential.objects.create(name="归档隔离 SVN", cred_type="svn_password", owner=release.publisher)
    credential.set_data({"username": "reader", "password": "isolated-pass"})
    credential.save()
    task.artifact_info = [{"id": "artifact-1", "path": RELATIVE, "size": 3, "sha256": "original-hash"}]
    task.config_snapshot = {"svn_push_enabled": True, "svn_url": svn_sandbox.url, "svn_credential_id": str(credential.id)}
    task.stage_info = {"svn_push": {"status": "success", "remote_url": svn_sandbox.url + "/task"}}
    task.save()
    return client, release, task, credential


def select_file(client, release, task, **selection):
    return client.post(f"/api/releases/{release.id}/oa-archive/prepare/", {
        "task_id": str(task.id), "path": RELATIVE, **selection,
    }, format="json")


def send_file(client, release, selection, form, submission_id=None):
    return client.post(f"/api/releases/{release.id}/oa-archive/submit/", {
        **selection, "form": form, "submission_id": str(submission_id or uuid4()),
    }, format="json")


def test_历史清单选择后真实发送并保留原始与当前文件依据(history_case, oa_http):
    client, release, task, _ = history_case
    prepared = select_file(client, release, task)
    assert prepared.status_code == 200, prepared.data
    data = prepared.data["data"]
    assert data["selection"]["path"] == RELATIVE
    assert data["form"]["git_svn"].endswith("/%E7%9B%AE%E5%BD%95%20%E7%A9%BA%E6%A0%BC/%E5%AE%89%E8%A3%85%E5%8C%85%401%25.zip")
    form = {**data["form"], "git_svn": "https://oa.example/人工填写.zip"}
    result = send_file(client, release, data["selection"], form)
    assert result.status_code == 201, result.data
    record = result.data["data"]
    assert record["status"] == "success"
    assert record["source"]["kind"] == "svn"
    assert record["source"]["supplemented"] is False
    assert record["source"]["artifact"]["original"] == {"size": 3, "sha256": "original-hash", "revision": None}
    assert record["source"]["artifact"]["current"]["size"] == 15
    assert record["source"]["git_hash"] == release.git_hash
    assert record["form"]["sn_code"] == release.git_hash
    assert len(oa_http.requests) == 1
    assert oa_http.requests[0]["body"]["git_svn"] == "https://oa.example/人工填写.zip"
    assert client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"] == [record]


@pytest.mark.parametrize("manifest", ["upload", "none"])
def test_上传清单或无清单补录不伪造旧元数据且可回读删除保护(history_case, oa_http, manifest):
    client, release, task, _ = history_case
    task.artifact_info = []
    if manifest == "upload":
        task.stage_info["svn_push"]["files"] = [RELATIVE, "release-V1.2.3.md"]
    task.save()
    options = client.get(f"/api/releases/{release.id}/oa-archive/options/").data["data"]
    assert options["svn_tasks"] == [{"task_id": str(task.id), "task_name": task.name}]
    prepared = select_file(client, release, task)
    assert prepared.status_code == 200, prepared.data
    data = prepared.data["data"]
    result = send_file(client, release, data["selection"], data["form"])
    assert result.status_code == 201, result.data
    record = result.data["data"]
    assert record["source"]["supplemented"] is (manifest == "none")
    assert record["source"]["artifact_id"] is None
    assert record["source"]["artifact"]["original"] == {"size": None, "sha256": None, "revision": None}
    assert record["source"]["artifact"]["current"]["size"] == 15
    assert len(oa_http.requests) == 1
    # 同一请求按任务+路径重放，补录文件同样不再发送。
    replay = send_file(client, release, data["selection"], data["form"], record["submission_id"])
    assert replay.status_code == 200
    assert replay.data["data"] == record
    assert len(oa_http.requests) == 1
    release.publisher.is_superuser = True
    release.publisher.save()
    assert client.delete(f"/api/packages/tasks/{task.id}/").status_code == 400


def test_选择后覆盖保存提交时当前元数据并保留原发布SN(history_case, svn_sandbox, oa_http, tmp_path):
    client, release, task, _ = history_case
    data = select_file(client, release, task).data["data"]
    checkout = tmp_path / "archive-checkout"
    svn_sandbox.svn("checkout", svn_sandbox.url + "/task", str(checkout))
    (checkout / RELATIVE).write_bytes(b"overwritten")
    svn_sandbox.svn("commit", str(checkout), "-m", "归档前覆盖隔离文件")
    result = send_file(client, release, data["selection"], data["form"])
    assert result.status_code == 201, result.data
    source = result.data["data"]["source"]
    assert source["artifact"]["current"]["size"] == 11
    assert source["artifact"]["current"]["revision"] == "2"
    assert source["artifact"]["original"]["size"] == 3
    assert result.data["data"]["form"]["sn_code"] == release.git_hash


@pytest.mark.parametrize("failure,state", [("delete", "missing"), ("credential", "credential_invalid"), ("network", "network_error")])
def test_选择后文件删除或无法核验时修改git_svn也不能派发(history_case, svn_sandbox, oa_http, tmp_path, failure, state):
    client, release, task, credential = history_case
    data = select_file(client, release, task).data["data"]
    if failure == "delete":
        checkout = tmp_path / "archive-deletion"
        svn_sandbox.svn("checkout", svn_sandbox.url + "/task", str(checkout))
        svn_sandbox.svn("delete", str(checkout / RELATIVE) + "@")
        svn_sandbox.svn("commit", str(checkout), "-m", "归档前删除隔离文件")
    elif failure == "credential":
        credential.set_data({"username": "reader", "password": "invalid-password"})
        credential.save()
    else:
        svn_sandbox.stop()
    form = {**data["form"], "git_svn": svn_sandbox.url + "/other-task/other.zip"}
    result = send_file(client, release, data["selection"], form)
    assert result.status_code in (409, 502), result.data
    assert result.data["data"]["state"] == state
    assert oa_http.requests == []
    assert client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"] == []
    assert select_file(client, release, task).data["data"]["state"] == state


@pytest.mark.parametrize("path", ["../other-task/other.zip", "%2e%2e/other-task/other.zip", "/other-task/other.zip", "svn://another.example/file"])
def test_无清单补录拒绝越过任务目录且无申请副作用(history_case, oa_http, path):
    client, release, task, _ = history_case
    task.artifact_info = []
    task.save()
    result = select_file(client, release, task, path=path)
    assert result.status_code == 400
    assert result.data["data"]["state"] == "invalid_path"
    assert oa_http.requests == []


def test_原清单和不同入口共享任务路径身份且不同任务相同产物ID不冲突(history_case, oa_http):
    from apps.package.models import PackageTask

    client, release, task, _ = history_case
    data = select_file(client, release, task, artifact_id="artifact-1").data["data"]
    first = send_file(client, release, data["selection"], data["form"])
    assert first.status_code == 201
    by_path = {"task_id": str(task.id), "path": RELATIVE}
    assert send_file(client, release, by_path, data["form"], first.data["data"]["submission_id"]).status_code == 200
    assert send_file(client, release, by_path, data["form"]).status_code == 400
    other = PackageTask.objects.create(release=release, project=release.project, repository=release.repository,
        triggered_by=release.publisher, name="独立历史任务", status="success", artifact_info=task.artifact_info,
        config_snapshot=task.config_snapshot, stage_info=task.stage_info)
    other_data = select_file(client, release, other).data["data"]
    assert send_file(client, release, other_data["selection"], other_data["form"]).status_code == 201
    assert len(oa_http.requests) == 2


def test_历史发起人被改为只读后发送重新拒绝(history_case, oa_http):
    from apps.project.models import ProjectMember

    client, release, task, _ = history_case
    data = select_file(client, release, task).data["data"]
    from apps.account.models import User

    release.project.leader = User.objects.create_user(username="history-new-leader")
    release.project.save()
    ProjectMember.objects.filter(project=release.project, user=release.publisher).update(role="maintainer")
    result = send_file(client, release, data["selection"], data["form"])
    assert result.status_code == 403
    assert oa_http.requests == []


def test_实际到期清理之后原产物仍从SVN选择并归档(history_case, oa_http):
    from pathlib import Path

    from django.utils import timezone

    from apps.package.services.cleanup import cleanup_expired_artifacts

    client, release, task, _ = history_case
    local = Path(task.workspace_path) / "artifacts" / RELATIVE
    local.parent.mkdir(parents=True)
    local.write_bytes(b"old")
    task.finished_at = timezone.now() - timezone.timedelta(days=40)
    task.save()
    assert cleanup_expired_artifacts()["cleaned"] == 1
    assert not local.exists()
    task.refresh_from_db()
    assert task.artifact_info[0]["sha256"] == "original-hash"
    data = select_file(client, release, task, artifact_id="artifact-1").data["data"]
    assert data["source"]["kind"] == "svn"
    assert send_file(client, release, data["selection"], data["form"]).status_code == 201
    assert len(oa_http.requests) == 1


def test_缺少旧产物ID时按所选路径提交不会认错同任务另一个文件(archive_case, oa_http):
    from pathlib import Path

    client, release, task = archive_case
    (Path(task.workspace_path) / "artifacts" / "第二个.zip").write_bytes(b"second")
    task.artifact_info = [{"path": "软件.zip"}, {"path": "第二个.zip"}]
    task.save()
    result = select_file(client, release, task, path="第二个.zip")
    assert result.status_code == 200, result.data
    data = result.data["data"]
    assert data["selection"]["path"] == "第二个.zip"
    assert send_file(client, release, data["selection"], data["form"]).data["data"]["source"]["path"] == "第二个.zip"
