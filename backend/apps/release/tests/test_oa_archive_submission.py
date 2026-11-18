"""公开 REST 与真实隔离 HTTP 验证归档提交；不访问业务 OA。"""
import json
import time
from codecs import BOM_UTF8
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread
from types import SimpleNamespace
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import ProjectMember
from apps.release.oa_http import post_oa_json
from apps.release.tests.test_oa_archive import archive_case as _archive_case
from apps.release.tests.test_oa_archive import prepare
from apps.system.oa_archive import OaArchiveConfig

pytestmark = pytest.mark.django_db
archive_case = _archive_case


@pytest.fixture
def oa_http():
    requests = []
    state = SimpleNamespace(
        requests=requests, mode="success", received=Event(), resume=Event(),
        names={"code": 0, "data": [{"soft_name": "项目内软件"}, {"soft_name": "54S_MainControl"}], "msg": ""},
        name_requests=[], names_prefix=b"",
    )

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            request = {"path": self.path, "body": json.loads(self.rfile.read(int(self.headers["Content-Length"]))),
                       "authorization": self.headers.get("Authorization"), "type": self.headers.get("Content-Type")}
            if self.path == "/api/v1/ticketscript/get_oa_software_name_list":
                state.name_requests.append({**request, "method": self.command, "cookie": self.headers.get("Cookie")})
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(state.names_prefix + json.dumps(state.names).encode())
                return
            requests.append(request)
            state.received.set()
            if state.mode == "blocked":
                assert state.resume.wait(10), "隔离 OA 未获准返回"
            if state.mode == "disconnect":
                self.close_connection = True
                return
            if state.mode == "timeout":
                time.sleep(0.3)
            body = json.dumps({"code": 0, "data": {"soft_number": "SOFT-001", "software_archive_id": {"opaque": ["单据", 7]}, "number_apply_id": None if requests[-1]["body"].get("soft_number") else "NUMBER-001"}}).encode()
            status = 201 if state.mode == "created" else 200
            content_type = "application/json"
            if state.mode == "failure":
                body = json.dumps({"code": -1, "msg": "申请资料有误，请核对"}).encode()
            elif state.mode == "nul-in-json":
                body = b'{"code":-1,"msg":"bad\\u0000data"}'
            elif state.mode == "literal-nul-escape":
                body = b'{"code":-1,"msg":"literal \\\\u0000"}'
            elif state.mode == "http-error-json":
                status = 503
                body = '{\n  "code": -1, "msg": "OA 暂不可用"\n}\n'.encode()
            elif state.mode == "http-error-html":
                status = 502
                content_type = "text/html; charset=utf-8"
                body = b"<html>Bad Gateway</html>\n"
            elif state.mode == "utf8-without-charset":
                status = 502
                content_type = "text/plain"
                body = "OA 暂不可用\n".encode()
            elif state.mode == "unsupported-charset":
                content_type = "text/plain; charset=unknown-charset"
                body = "OA 返回正文\n".encode()
            elif state.mode == "invalid-text-character":
                content_type = "text/plain; charset=unicode_escape"
                body = b"OA reply \\ud800"
            elif state.mode in ("body-timeout", "slow-body"):
                status = 502
                content_type = "text/plain"
                body = "前半段\n后一段".encode()
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
            state.response_body = body.decode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.end_headers()
            try:
                if state.mode == "body-timeout":
                    self.wfile.write("前半段\n".encode())
                    time.sleep(0.3)
                if state.mode == "slow-body":
                    for index in range(10):
                        self.wfile.write(f"第{index}段\n".encode())
                        time.sleep(0.025)
                else:
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


def test_软件名称从同源OA名单读取且名单变更后拒绝新申请但仍可重放(archive_case, oa_http):
    client, release, task = archive_case
    OaArchiveConfig.save(OaArchiveConfig.get_url() + "?trace=submit-only")
    names_url = f"/api/releases/{release.id}/oa-archive/software-names/"
    oa_http.names["data"] += [{"soft_name": "54S_MainControl"}, {"soft_name": " "}]
    assert client.get(names_url).data["data"] == ["项目内软件", "54S_MainControl"]
    assert oa_http.name_requests == [{
        "method": "POST", "path": "/api/v1/ticketscript/get_oa_software_name_list",
        "body": {}, "type": "application/json", "authorization": None, "cookie": None,
    }]
    form = prepare(client, release, task).data["data"]["form"]
    invalid = submit(client, release, task, {**form, "soft_name": "自行填写"})
    assert invalid.status_code == 400
    assert "不在当前 OA 名单" in invalid.data["message"]
    assert oa_http.requests == []

    submission_id = uuid4()
    accepted = submit(client, release, task, {**form, "soft_name": "54S_MainControl"}, submission_id)
    assert accepted.status_code == 201
    assert oa_http.requests[0]["body"]["soft_name"] == "54S_MainControl"
    oa_http.names["data"] = []
    assert client.get(names_url).data["data"] == []
    name_request_count = len(oa_http.name_requests)
    replay = submit(client, release, task, {**form, "soft_name": "54S_MainControl"}, submission_id)
    assert replay.status_code == 200
    assert replay.data["data"] == accepted.data["data"]
    assert len(oa_http.name_requests) == name_request_count
    assert len(oa_http.requests) == 1


@pytest.mark.parametrize(("role", "release_type", "status", "expected"), [
    ("maintainer", "formal", "released", 403),
    (None, "formal", "released", 404),
    ("manager", "rc", "released", 400),
    ("manager", "formal", "draft", 400),
])
def test_无归档权限或发布资格时名单接口拒绝且不请求OA(archive_case, oa_http, role, release_type, status, expected):
    client, release, _ = archive_case
    actor = User.objects.create_user(username="archive-options-reader")
    if role:
        ProjectMember.objects.create(project=release.project, user=actor, role=role)
    client.force_authenticate(actor)
    release.release_type, release.status = release_type, status
    release.save(update_fields=["release_type", "status"])

    response = client.get(f"/api/releases/{release.id}/oa-archive/software-names/")

    assert response.status_code == expected
    assert oa_http.name_requests == []


def test_OA名单失败时可重读且提交没有派发或保存申请(archive_case, oa_http):
    client, release, task = archive_case
    names_url = f"/api/releases/{release.id}/oa-archive/software-names/"
    oa_http.names = {"code": 1, "data": [], "msg": "读取失败"}
    assert client.get(names_url).status_code == 502
    form = prepare(client, release, task).data["data"]["form"]
    response = submit(client, release, task, form)
    assert response.status_code == 400
    assert "软件名称名单核验失败" in response.data["message"]
    assert oa_http.requests == []
    assert not release.oa_applications.exists()
    oa_http.names = {"code": 0, "data": [{"soft_name": "Antireal_Project"}], "msg": ""}
    assert client.get(names_url).data["data"] == ["Antireal_Project"]


@pytest.mark.parametrize(("prefix", "name", "status"), [
    pytest.param(BOM_UTF8, "54S_MainControl", 200, id="UTF-8-BOM"),
    pytest.param(b"", "软件\ud800", 502, id="孤立代理字符"),
    pytest.param(b"", "软件\x00", 502, id="NUL"),
])
def test_OA名单兼容BOM并将不可返回的名称报为上游异常(archive_case, oa_http, prefix, name, status):
    client, release, task = archive_case
    oa_http.names_prefix = prefix
    oa_http.names["data"] = [{"soft_name": name}]
    response = client.get(f"/api/releases/{release.id}/oa-archive/software-names/")
    assert response.status_code == status
    form = prepare(client, release, task).data["data"]["form"]
    if status == 200:
        assert response.json()["data"] == [name]
        assert submit(client, release, task, {**form, "soft_name": name}).status_code == 201
        assert oa_http.requests[0]["body"]["soft_name"] == name
    else:
        assert "无效 JSON" in response.json()["message"]
        assert "名单核验失败" in submit(client, release, task, form).json()["message"]
        assert oa_http.requests == []
        assert not release.oa_applications.exists()


def test_未配置OA可往返预检其他资料而提交仍要求名称(archive_case):
    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    del form["soft_name"]
    response = prepare(client, release, task, form=form)
    assert response.status_code == 200
    assert not response.json()["data"]["configuration"]["configured"]
    returned_form = response.json()["data"]["form"]
    assert returned_form == {**form, "soft_name": ""}
    repeated = prepare(client, release, task, form=returned_form)
    assert repeated.status_code == 200
    assert repeated.json()["data"]["form"] == returned_form
    invalid = prepare(client, release, task, form={**form, "developer": ""})
    assert invalid.status_code == 400
    assert "developer" in invalid.json()["data"]["form"]
    for candidate in (form, returned_form):
        submission = submit(client, release, task, candidate)
        assert submission.status_code == 400
        assert "soft_name" in submission.json()["data"]["form"]
    assert not release.oa_applications.exists()


def test_等待OA名单期间项目成员降级则拒绝提交(archive_case, oa_http, monkeypatch):
    client, release, task = archive_case
    administrator = APIClient()
    administrator.force_authenticate(release.publisher)
    actor = User.objects.create_user(username="archive-operator")
    membership = ProjectMember.objects.create(project=release.project, user=actor, role="manager")
    client.force_authenticate(actor)
    form = prepare(client, release, task).data["data"]["form"]

    def downgrade_while_reading_names(*args, **kwargs):
        result = post_oa_json(*args, **kwargs)
        response = administrator.patch(f"/api/projects/{release.project_id}/members/{membership.id}/", {"role": "maintainer"}, format="json")
        assert response.status_code == 200, response.data
        return result

    monkeypatch.setattr("apps.release.oa_archive.post_oa_json", downgrade_while_reading_names)
    response = submit(client, release, task, form)

    assert response.status_code == 403, response.data
    assert len(oa_http.name_requests) == 1
    assert oa_http.requests == []
    assert not release.oa_applications.exists()


def test_实际提交独立资料且重新读取完整结果来源(archive_case, oa_http):
    client, release, task = archive_case
    endpoint = OaArchiveConfig.get_url()
    OaArchiveConfig.save(endpoint + "?trace=hidden-in-history")
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
    assert record["oa_endpoint"] == endpoint
    OaArchiveConfig.save("https://changed.example.com/another-endpoint")
    assert client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"] == [record]
    assert oa_http.requests == [{"path": "/api/v1/ticketscript/create_software_archive_with_number?trace=hidden-in-history", "body": record["form"], "authorization": None, "type": "application/json"}]
    release.refresh_from_db()
    assert release.version == "V1.2.3"


@pytest.mark.parametrize("mode,expected,upstream_status,reason", [
    ("success", "success", 200, "已发起归档"),
    ("created", "success", 201, "已发起归档"),
    ("failure", "failure", 200, "申请资料有误，请核对"),
    ("nul-in-json", "unknown", 200, "OA 未返回有效 JSON"),
    ("literal-nul-escape", "failure", 200, r"literal \u0000"),
    ("http-error-json", "unknown", 503, "OA 返回 HTTP 503：OA 暂不可用"),
    ("http-error-html", "unknown", 502, "OA 返回 HTTP 502"),
    ("utf8-without-charset", "unknown", 502, "OA 返回 HTTP 502"),
    ("unsupported-charset", "unknown", 200, "OA 返回正文无法完整解码为文本"),
    ("invalid-text-character", "unknown", 200, "OA 返回正文无法完整解码为文本"),
    ("invalid", "unknown", 200, "OA 未返回有效 JSON"),
    ("invalid-number", "unknown", 200, "OA 未返回有效 JSON"),
    ("missing", "unknown", 200, "data.soft_number"),
    ("disconnect", "unknown", None, "与 OA 的连接失败或中断"),
    ("timeout", "unknown", None, "等待 OA 返回超时"),
    ("body-timeout", "unknown", 502, "等待 OA 返回超时"),
    ("slow-body", "unknown", 502, "等待 OA 返回超时"),
])
def test_真实HTTP结果持久化且原请求重放不重复发送(archive_case, oa_http, monkeypatch, mode, expected, upstream_status, reason):
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
    assert reason in record["message"]
    assert result.data["message"] == record["message"]
    if upstream_status is None:
        assert record["oa_response"] is None
    else:
        snapshot = record["oa_response"]
        assert snapshot["status_code"] == upstream_status
        assert snapshot["complete"] is (mode not in ("body-timeout", "slow-body"))
        if mode == "body-timeout":
            assert snapshot["body"] == "前半段\n"
        elif mode == "slow-body":
            assert snapshot["body"].startswith("第0段\n")
            assert "第9段" not in snapshot["body"]
        else:
            assert snapshot["body"] == oa_http.response_body
        if mode in ("unsupported-charset", "invalid-text-character"):
            from base64 import b64decode

            assert b64decode(snapshot["body_base64"]) == oa_http.response_body.encode()
    if mode == "http-error-json":
        assert record["response"] == {"code": -1, "msg": "OA 暂不可用"}
    assert record["form"]["soft_number"] == "EXISTING-9"
    if mode == "failure":
        assert record["message"] == "申请资料有误，请核对"
    if mode == "success":
        assert record["number_apply_id"] is None
    replay = submit(client, release, task, form, submission_id)
    assert replay.status_code == 200
    assert replay.data["data"] == record
    assert client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"] == [record]
    assert submit(client, release, task, form).status_code == 400
    assert len(oa_http.requests) == 1


def test_发送前预算耗尽返回明确错误且不创建申请(archive_case, oa_http, monkeypatch):
    from apps.release import oa_submission

    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    monkeypatch.setattr(oa_submission, "PREPARATION_BUDGET", 0)
    result = submit(client, release, task, form)
    assert result.status_code == 400
    assert "尚未发送 OA" in result.data["message"]
    assert client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"] == []
    assert oa_http.requests == []


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


@pytest.mark.parametrize("mode", ["success", "missing", "failure"])
@pytest.mark.parametrize("source", ["release", "project", "repository"])
def test_成功未知及未核对失败保护发布及父级级联且远端无删除副作用(archive_case, oa_http, mode, source, monkeypatch):
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


def test_明确失败须人工确认未建单才允许删除且保留原资料(archive_case, oa_http):
    client, release, task = archive_case
    oa_http.mode = "failure"
    form = prepare(client, release, task).data["data"]["form"]
    record = submit(client, release, task, form).data["data"]
    release.publisher.is_superuser = True
    release.publisher.save()
    client.force_authenticate(release.publisher)
    assert client.delete(f"/api/packages/tasks/{task.id}/").status_code == 400
    url = f"/api/releases/{release.id}/oa-archive/confirm-no-order/"
    confirmation = {"application_id": record["id"], "confirmation": "checked_no_order", "evidence": "已在 OA 按申请人及提交时间核对，未生成归档单"}
    assert client.post(url, {**confirmation, "evidence": " "}, format="json").status_code == 400
    confirmed = client.post(url, confirmation, format="json")
    assert confirmed.status_code == 200, confirmed.data
    checked = confirmed.data["data"]
    assert checked["status"] == "failure"
    assert checked["form"] == record["form"]
    assert checked["response"] == record["response"]
    assert checked["no_order_confirmation"]["operator"]["username"] == "releaseuser"
    assert checked["no_order_confirmation"]["evidence"] == confirmation["evidence"]
    assert checked["no_order_confirmation"]["confirmed_at"]
    assert client.post(url, confirmation, format="json").data["data"] == checked
    assert len(oa_http.requests) == 1
    assert client.delete(f"/api/packages/tasks/{task.id}/").status_code == 200
    assert client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"] == [checked]


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
    confirmation = client.post(f"/api/releases/{release.id}/oa-archive/confirm-no-order/", {
        "application_id": second.data["data"]["id"], "confirmation": "checked_no_order", "evidence": "已人工核对第二次失败未建单",
    }, format="json")
    assert confirmation.status_code == 200
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


@pytest.mark.parametrize("mode", ["success", "missing", "sending"])
def test_非明确失败结果不能通过人工确认解除保护(archive_case, oa_http, mode):
    from apps.release.models import OaArchiveApplication

    client, release, task = archive_case
    oa_http.mode = "missing" if mode == "sending" else mode
    form = prepare(client, release, task).data["data"]["form"]
    record = submit(client, release, task, form).data["data"]
    if mode == "sending":
        OaArchiveApplication.objects.filter(pk=record["id"]).update(status="sending")
    result = client.post(f"/api/releases/{release.id}/oa-archive/confirm-no-order/", {
        "application_id": record["id"], "confirmation": "checked_no_order", "evidence": "人工核对",
    }, format="json")
    assert result.status_code == 400
    release.publisher.is_superuser = True
    release.publisher.save()
    assert client.delete(f"/api/packages/tasks/{task.id}/").status_code == 400
    assert len(oa_http.requests) == 1


@pytest.mark.parametrize("role,expected", [("manager", 200), ("software_admin", 200), ("developer", 403), ("maintainer", 403), ("viewer", 403), (None, 404)])
def test_失败核对重新授权且不依赖过期文件(archive_case, oa_http, role, expected, tmp_path):
    from apps.account.models import User
    from apps.project.models import ProjectMember

    client, release, task = archive_case
    oa_http.mode = "failure"
    record = submit(client, release, task, prepare(client, release, task).data["data"]["form"]).data["data"]
    (tmp_path / "build/artifacts/软件.zip").unlink()
    actor = User.objects.create_user(username="confirming-user")
    if role:
        ProjectMember.objects.create(project=release.project, user=actor, role=role)
    client.force_authenticate(actor)
    result = client.post(f"/api/releases/{release.id}/oa-archive/confirm-no-order/", {
        "application_id": record["id"], "confirmation": "checked_no_order", "evidence": "人工核对未建单",
    }, format="json")
    assert result.status_code == expected
    assert len(oa_http.requests) == 1
