"""公开 REST 与真实隔离 HTTP 验证归档提交；不访问业务 OA。"""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread
from types import SimpleNamespace
from uuid import uuid4

import pytest

from apps.release.tests.test_oa_archive import archive_case as _archive_case
from apps.release.tests.test_oa_archive import prepare
from apps.system.oa_archive import OaArchiveConfig

pytestmark = pytest.mark.django_db
archive_case = _archive_case


@pytest.fixture
def oa_http():
    requests = []
    state = SimpleNamespace(requests=requests, mode="success", received=Event(), resume=Event())

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            requests.append({"path": self.path, "body": json.loads(self.rfile.read(int(self.headers["Content-Length"]))),
                             "authorization": self.headers.get("Authorization"), "type": self.headers.get("Content-Type")})
            state.received.set()
            if state.mode == "blocked":
                assert state.resume.wait(10), "隔离 OA 未获准返回"
            if state.mode == "disconnect":
                self.close_connection = True
                return
            if state.mode == "timeout":
                time.sleep(0.3)
            body = json.dumps({"code": 0, "data": {"soft_number": "SOFT-001", "software_archive_id": {"opaque": ["单据", 7]}, "number_apply_id": None if requests[-1]["body"].get("soft_number") else "NUMBER-001"}}).encode()
            if state.mode == "failure":
                body = json.dumps({"code": -1, "msg": "申请资料有误，请核对"}).encode()
            elif state.mode == "invalid":
                body = b"invalid json"
            elif state.mode == "missing":
                body = b'{"code":0,"data":{}}'
            elif state.mode == "invalid-number":
                body = b'{"code":0,"data":{"other":NaN}}'
            elif state.mode in ("archive-string", "archive-bool", "archive-list", "archive-empty-object", "number-object", "number-missing", "number-empty"):
                payload = json.loads(body)
                if state.mode.startswith("archive-"):
                    payload["data"]["software_archive_id"] = {"archive-string": "单据", "archive-bool": True, "archive-list": ["单据"], "archive-empty-object": {}}[state.mode]
                elif state.mode == "number-object":
                    payload["data"]["number_apply_id"] = {"wrong": "type"}
                elif state.mode == "number-missing":
                    del payload["data"]["number_apply_id"]
                else:
                    payload["data"]["number_apply_id"] = ""
                body = json.dumps(payload).encode()
            self.send_response(201 if state.mode == "created" else 200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    OaArchiveConfig.save(f"http://127.0.0.1:{server.server_port}/api/v1/ticketscript/create_software_archive_with_number")
    yield state
    state.resume.set()
    server.shutdown()
    server.server_close()
    thread.join()


def submit(client, release, task, form, submission_id=None, **confirmation):
    return client.post(f"/api/releases/{release.id}/oa-archive/submit/", {
        "task_id": str(task.id), "artifact_id": "artifact-1", "submission_id": str(submission_id or uuid4()), "form": form, **confirmation,
    }, format="json")


def test_实际提交独立资料且重新读取完整结果来源(archive_case, oa_http):
    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    form.update(docCreator="oa-operator", soft_version="人工版本", edit_content="第一行 | 保留\n\n" + "长正文" * 400 + "末尾", project_number="不得发送", applyCount=9)
    response = submit(client, release, task, form)
    assert response.status_code == 201, response.data
    record = response.data["data"]
    assert record["status"] == "success"
    assert record["operator"]["username"] == "releaseuser"
    assert record["form"]["docCreator"] == "oa-operator"
    assert record["form"]["applyCount"] == 1
    assert "project_number" not in record["form"]
    assert record["software_archive_id"] == {"opaque": ["单据", 7]}
    assert record["soft_number"] == "SOFT-001"
    assert record["source"]["path"] == "软件.zip"
    assert record["source"]["task_id"] == str(task.id)
    assert client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"] == [record]
    assert oa_http.requests == [{"path": "/api/v1/ticketscript/create_software_archive_with_number", "body": record["form"], "authorization": None, "type": "application/json"}]
    release.refresh_from_db()
    assert release.version == "V1.2.3"


@pytest.mark.parametrize("mode,expected", [("success", "success"), ("created", "success"), ("failure", "failure"), ("invalid", "unknown"), ("invalid-number", "unknown"), ("missing", "unknown"), ("disconnect", "unknown"), ("timeout", "unknown")])
def test_真实HTTP结果持久化且原请求重放不重复发送(archive_case, oa_http, monkeypatch, mode, expected):
    from apps.release.oa_submission import OaArchiveSubmission

    client, release, task = archive_case
    oa_http.mode = mode
    monkeypatch.setattr(OaArchiveSubmission, "timeout", (0.1, 0.1))
    form = prepare(client, release, task).data["data"]["form"]
    form["soft_number"] = "EXISTING-9"
    submission_id = uuid4()
    result = submit(client, release, task, form, submission_id)
    assert result.status_code == 201
    record = result.data["data"]
    assert record["status"] == expected
    assert record["form"]["soft_number"] == "EXISTING-9"
    if mode == "failure":
        assert record["message"] == "申请资料有误，请核对"
    if mode == "success":
        assert record["number_apply_id"] is None
    replay = submit(client, release, task, form, submission_id)
    assert replay.status_code == 200
    assert replay.data["data"] == record
    assert submit(client, release, task, form).status_code == 400
    assert len(oa_http.requests) == 1


@pytest.mark.parametrize("mode,expected", [("archive-string", "unknown"), ("archive-bool", "unknown"), ("archive-list", "unknown"), ("archive-empty-object", "success"), ("number-object", "unknown"), ("number-missing", "unknown"), ("number-empty", "unknown")])
def test_返回类型遵守外层契约但不猜测归档对象内部结构(archive_case, oa_http, mode, expected):
    client, release, task = archive_case
    oa_http.mode = mode
    form = prepare(client, release, task).data["data"]["form"]
    result = submit(client, release, task, form)
    assert result.status_code == 201
    assert result.data["data"]["status"] == expected
    assert len(oa_http.requests) == 1


def test_成功申请阻止直接删除任务且工作区保留(archive_case, oa_http, tmp_path):
    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    assert submit(client, release, task, form).status_code == 201
    release.publisher.is_superuser = True
    release.publisher.save()
    client.force_authenticate(release.publisher)
    deleted = client.delete(f"/api/packages/tasks/{task.id}/")
    assert deleted.status_code == 400, deleted.data
    assert "OA" in deleted.data["message"]
    assert (tmp_path / "build/artifacts/软件.zip").is_file()


@pytest.mark.parametrize("mode", ["success", "missing"])
@pytest.mark.parametrize("source", ["release", "project", "repository"])
def test_成功和未知保护发布及父级级联且远端无删除副作用(archive_case, oa_http, mode, source, monkeypatch):
    from apps.release.services import ReleaseService

    client, release, task = archive_case
    oa_http.mode = mode
    form = prepare(client, release, task).data["data"]["form"]
    assert submit(client, release, task, form).status_code == 201
    release.publisher.is_superuser = True
    release.publisher.save()
    client.force_authenticate(release.publisher)

    def forbidden_provider(*args, **kwargs):
        pytest.fail("归档保护应在访问远端 Tag 前生效")

    monkeypatch.setattr(ReleaseService, "_get_provider", forbidden_provider)
    if source == "release":
        response = client.post(f"/api/releases/{release.id}/delete-released/", {"tag_name": release.tag_name}, format="json")
    else:
        target = release.project_id if source == "project" else release.repository_id
        url = f"/api/projects/{target}/" if source == "project" else f"/api/repositories/{target}/"
        response = client.delete(url)
    assert response.status_code == 400, response.data
    assert "OA" in str(response.data)
    assert len(client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"]) == 1


def test_明确失败允许删除任务且保留发布中可读的原申请资料(archive_case, oa_http):
    client, release, task = archive_case
    oa_http.mode = "failure"
    form = prepare(client, release, task).data["data"]["form"]
    record = submit(client, release, task, form).data["data"]
    release.publisher.is_superuser = True
    release.publisher.save()
    client.force_authenticate(release.publisher)
    assert client.delete(f"/api/packages/tasks/{task.id}/").status_code == 200
    assert client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"] == [record]


@pytest.mark.parametrize("role,allowed", [("developer", False), ("manager", True), ("software_admin", True), ("maintainer", False), ("viewer", False), (None, False)])
def test_提交与查询使用现行成员身份且申请人字段不授予权限(archive_case, oa_http, role, allowed):
    from apps.account.models import User
    from apps.project.models import ProjectMember

    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    actor = User.objects.create_user(username="current-actor")
    if role:
        ProjectMember.objects.create(project=release.project, user=actor, role=role)
    client.force_authenticate(actor)
    result = submit(client, release, task, form)
    assert result.status_code == (201 if allowed else 403 if role else 404), result.data
    assert len(oa_http.requests) == int(allowed)
    read = client.get(f"/api/releases/{release.id}/oa-archive/records/")
    assert read.status_code == (200 if role else 404)


@pytest.mark.parametrize("change", ["revoked", "readonly", "task_failed", "svn_failed", "file_deleted", "wrong_release", "rc"])
def test_准备后变化必须在提交重新核验且不创建记录(archive_case, oa_http, change, tmp_path):
    from apps.project.models import ProjectMember

    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    if change == "revoked":
        ProjectMember.objects.filter(project=release.project, user=release.publisher).delete()
    elif change == "readonly":
        ProjectMember.objects.filter(project=release.project, user=release.publisher).update(role="maintainer")
        release.project.leader = None
        release.project.save()
    elif change == "task_failed":
        task.status = "failure"
    elif change == "svn_failed":
        task.config_snapshot = {"svn_push_enabled": True}
        task.stage_info = {"svn_push": {"status": "failure"}}
    elif change == "file_deleted":
        (tmp_path / "build/artifacts/软件.zip").unlink()
    elif change == "wrong_release":
        task.release = None
    elif change == "rc":
        release.release_type = "rc"
        release.save()
    task.save()
    assert submit(client, release, task, form).status_code in (400, 403, 404)
    assert oa_http.requests == []


def test_到期仅清文件仍保留归档资料与删除保护(archive_case, oa_http, tmp_path):
    from django.utils import timezone

    from apps.package.models import PackageTask
    from apps.package.services.cleanup import cleanup_expired_artifacts

    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    record = submit(client, release, task, form).data["data"]
    PackageTask.objects.filter(pk=task.pk).update(finished_at=timezone.now() - timezone.timedelta(days=100))
    assert cleanup_expired_artifacts()["cleaned"] == 1
    assert not (tmp_path / "build/artifacts/软件.zip").exists()
    assert client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"] == [record]
    assert record["source"]["artifact"]["size"] == 13


def test_文件身份使用任务与规范相对路径而非跨任务产物ID(archive_case, oa_http, tmp_path):
    from apps.package.models import PackageTask

    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    assert submit(client, release, task, form).status_code == 201
    task.artifact_info.append({"id": "alias", "path": "./软件.zip"})
    task.save()
    duplicate = client.post(f"/api/releases/{release.id}/oa-archive/submit/", {
        "task_id": str(task.id), "artifact_id": "alias", "submission_id": str(uuid4()), "form": form,
    }, format="json")
    assert duplicate.status_code == 400
    other = PackageTask.objects.create(
        release=release, project=release.project, repository=release.repository, triggered_by=release.publisher,
        name="另一次构建", status="success", workspace_path=task.workspace_path,
        config_snapshot={"svn_push_enabled": False}, artifact_info=[{"id": "artifact-1", "path": "软件.zip"}],
    )
    assert submit(client, release, other, form).status_code == 201
    assert len(oa_http.requests) == 2


def test_成功后确认最新记录可显式再次办理且不继承生成编号(archive_case, oa_http):
    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    first = submit(client, release, task, form).data["data"]
    second = submit(client, release, task, {**form, "edit_reason": "再次办理"},
                    previous_id=first["id"], confirmation="reapply")
    assert second.status_code == 201, second.data
    record = second.data["data"]
    assert record["previous_id"] == first["id"]
    assert record["confirmation"] == "reapply"
    assert record["form"]["soft_number"] == ""
    assert len(oa_http.requests) == 2
    history = client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"]
    assert history == [record, first]


@pytest.mark.parametrize("mode,confirmation", [("failure", "retry"), ("missing", "checked_no_order")])
def test_失败或未知结果需对应显式确认且重试保留原资料(archive_case, oa_http, mode, confirmation):
    client, release, task = archive_case
    oa_http.mode = mode
    form = prepare(client, release, task).data["data"]["form"]
    first = submit(client, release, task, form).data["data"]
    for invalid in ("", "reapply"):
        assert submit(client, release, task, form, previous_id=first["id"], confirmation=invalid).status_code == 400
    oa_http.mode = "success"
    identity = uuid4()
    amended = {**form, "edit_reason": "核对后补充", "soft_number": "MANUAL-001"}
    second = submit(client, release, task, amended, identity, previous_id=first["id"], confirmation=confirmation)
    assert second.status_code == 201, second.data
    replay = submit(client, release, task, amended, identity, previous_id=first["id"], confirmation=confirmation)
    assert replay.data["data"] == second.data["data"]
    assert len(oa_http.requests) == 2
    history = client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"]
    assert history == [second.data["data"], first]
    assert history[0]["confirmation"] == confirmation
    assert history[0]["number_apply_id"] is None


def test_换操作人和旧窗口确认不能绕过最新历史(archive_case, oa_http):
    from apps.account.models import User
    from apps.project.models import ProjectMember

    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    first = submit(client, release, task, form).data["data"]
    actor = User.objects.create_user(username="another-manager")
    ProjectMember.objects.create(project=release.project, user=actor, role="manager")
    client.force_authenticate(actor)
    assert submit(client, release, task, form).status_code == 400
    second = submit(client, release, task, form, previous_id=first["id"], confirmation="reapply")
    assert second.status_code == 201
    assert second.data["data"]["operator"]["username"] == "another-manager"
    stale = submit(client, release, task, form, previous_id=first["id"], confirmation="reapply")
    assert stale.status_code == 400
    assert "最新" in str(stale.data)
    assert len(oa_http.requests) == 2


@pytest.mark.parametrize("mode", ["success", "missing"])
def test_后续失败不解除早前成功或未知来源保护(archive_case, oa_http, mode):
    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    oa_http.mode = mode
    first = submit(client, release, task, form).data["data"]
    oa_http.mode = "failure"
    second = submit(client, release, task, form, previous_id=first["id"], confirmation="reapply" if mode == "success" else "checked_no_order")
    assert second.status_code == 201
    assert second.data["data"]["status"] == "failure"
    release.publisher.is_superuser = True
    release.publisher.save()
    client.force_authenticate(release.publisher)
    assert client.delete(f"/api/packages/tasks/{task.id}/").status_code == 400
    assert client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"][1] == first


@pytest.mark.parametrize("change", ["readonly", "revoked", "file_deleted", "task_failed"])
def test_再次申请逐次检查现行成员与文件资格(archive_case, oa_http, change, tmp_path):
    from apps.project.models import ProjectMember

    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    first = submit(client, release, task, form).data["data"]
    if change == "revoked":
        ProjectMember.objects.filter(project=release.project, user=release.publisher).delete()
    elif change == "readonly":
        ProjectMember.objects.filter(project=release.project, user=release.publisher).update(role="maintainer")
        release.project.leader = None
        release.project.save()
    elif change == "file_deleted":
        (tmp_path / "build/artifacts/软件.zip").unlink()
    else:
        task.status = "failure"
        task.save()
    result = submit(client, release, task, form, previous_id=first["id"], confirmation="reapply")
    assert result.status_code in (400, 403, 404)
    assert len(oa_http.requests) == 1
