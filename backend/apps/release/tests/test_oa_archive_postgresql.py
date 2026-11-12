"""真实 PostgreSQL、独立连接与隔离 HTTP 证明提交/删除的并发语义。"""
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from django.db import close_old_connections, connection, transaction
from rest_framework.test import APIClient

from apps.release.tests.test_oa_archive import archive_case as _archive_case
from apps.release.tests.test_oa_archive import prepare
from apps.release.tests.test_oa_archive_submission import oa_http as _oa_http
from apps.release.tests.test_oa_archive_submission import submit
from apps.repository.models import Repository

pytestmark = pytest.mark.django_db(transaction=True)
archive_case = _archive_case
oa_http = _oa_http


@pytest.fixture(autouse=True)
def require_postgresql():
    if connection.vendor != "postgresql":
        pytest.skip("OA 提交竞争必须使用真实 PostgreSQL")


def request_as(actor, action):
    close_old_connections()
    try:
        client = APIClient()
        client.force_authenticate(actor)
        return action(client)
    finally:
        close_old_connections()


@pytest.mark.parametrize("same_submission", [True, False])
def test_归档并发重放及不同请求均仅发送一次(archive_case, oa_http, same_submission):
    from apps.account.models import User
    from apps.project.models import ProjectMember

    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    identity = uuid4()
    oa_http.mode = "blocked"
    second_actor = release.publisher
    if not same_submission:
        second_actor = User.objects.create_user(username="another-operator")
        ProjectMember.objects.create(project=release.project, user=second_actor, role="manager")
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(request_as, release.publisher, lambda api: submit(api, release, task, form, identity))
        try:
            assert oa_http.received.wait(10)
            second = pool.submit(request_as, second_actor, lambda api: submit(api, release, task, form, identity if same_submission else uuid4())).result(timeout=10)
            assert second.status_code == (200 if same_submission else 400), second.data
            if same_submission:
                assert second.data["data"]["status"] == "sending"
        finally:
            oa_http.resume.set()
        result = first.result(timeout=10)
    assert result.status_code == 201
    assert len(oa_http.requests) == 1
    replay = submit(client, release, task, form, identity)
    assert replay.data["data"] == result.data["data"]


@pytest.mark.parametrize("source", ["task", "release", "project"])
def test_发送已提交时删除竞争不能绕过来源保护(archive_case, oa_http, source):
    client, release, task = archive_case
    actor = release.publisher
    actor.is_superuser = True
    actor.save()
    form = prepare(client, release, task).data["data"]["form"]
    oa_http.mode = "blocked"

    def delete(api):
        if source == "release":
            return api.post(f"/api/releases/{release.id}/delete-released/", {"tag_name": release.tag_name}, format="json")
        url = f"/api/packages/tasks/{task.id}/" if source == "task" else f"/api/projects/{release.project_id}/"
        return api.delete(url)

    with ThreadPoolExecutor(max_workers=2) as pool:
        sent = pool.submit(request_as, actor, lambda api: submit(api, release, task, form))
        try:
            assert oa_http.received.wait(10)
            deleted = pool.submit(request_as, actor, delete).result(timeout=10)
            assert deleted.status_code == 400, deleted.data
        finally:
            oa_http.resume.set()
        assert sent.result(timeout=10).status_code == 201
    assert len(client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"]) == 1


def test_任务删除先持锁时申请等待并重新拒绝已删来源(archive_case, oa_http):
    client, release, task = archive_case
    actor = release.publisher
    actor.is_superuser = True
    actor.save()
    form = prepare(client, release, task).data["data"]["form"]
    deleted, resume, starting, finished = Event(), Event(), Event(), Event()

    def deleting(api):
        with transaction.atomic():
            Repository.objects.select_for_update(no_key=True).get(pk=release.repository_id)
            result = api.delete(f"/api/packages/tasks/{task.id}/")
            deleted.set()
            assert resume.wait(10)
        return result

    def submitting(api):
        starting.set()
        try:
            return submit(api, release, task, form)
        finally:
            finished.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        deletion = pool.submit(request_as, actor, deleting)
        try:
            assert deleted.wait(10)
            sending = pool.submit(request_as, actor, submitting)
            assert starting.wait(10)
            assert not finished.wait(0.5), "提交未等待来源删除事务"
        finally:
            resume.set()
        assert deletion.result(timeout=10).status_code == 200
        assert sending.result(timeout=10).status_code == 404
    assert oa_http.requests == []


@pytest.mark.parametrize("initial_mode,confirmation", [("success", "reapply"), ("missing", "checked_no_order")])
def test_同一前次确认的并发新申请仅发送一次且保留全部历史(archive_case, oa_http, initial_mode, confirmation):
    from apps.account.models import User
    from apps.project.models import ProjectMember

    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    oa_http.mode = initial_mode
    prior = submit(client, release, task, form).data["data"]
    second_actor = User.objects.create_user(username="reapply-manager")
    ProjectMember.objects.create(project=release.project, user=second_actor, role="manager")
    oa_http.mode = "blocked"
    oa_http.received.clear()
    identity = uuid4()
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(request_as, release.publisher, lambda api: submit(api, release, task, form, identity, previous_id=prior["id"], confirmation=confirmation))
        try:
            assert oa_http.received.wait(10)
            second = pool.submit(request_as, second_actor, lambda api: submit(api, release, task, form, previous_id=prior["id"], confirmation=confirmation)).result(timeout=10)
            assert second.status_code == 400, second.data
            assert "正在发送" in str(second.data)
            replay = submit(client, release, task, form, identity, previous_id=prior["id"], confirmation=confirmation)
            assert replay.status_code == 200
            assert replay.data["data"]["status"] == "sending"
        finally:
            oa_http.resume.set()
        result = first.result(timeout=10)
    assert result.status_code == 201
    assert len(oa_http.requests) == 2
    stale = submit(client, release, task, form, previous_id=prior["id"], confirmation=confirmation)
    assert stale.status_code == 400
    assert "最新" in str(stale.data)
    history = client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"]
    assert history == [result.data["data"], prior]


@pytest.mark.parametrize("following", ["delete", "confirm"])
def test_失败核对与删除或重复核对竞争原子且保留首次依据(archive_case, oa_http, following):
    client, release, task = archive_case
    actor = release.publisher
    actor.is_superuser = True
    actor.save()
    oa_http.mode = "failure"
    record = submit(client, release, task, prepare(client, release, task).data["data"]["form"]).data["data"]
    url = f"/api/releases/{release.id}/oa-archive/confirm-no-order/"
    body = {"application_id": record["id"], "confirmation": "checked_no_order", "evidence": "第一次核对已确认未建单"}
    confirmed, resume, starting, finished = Event(), Event(), Event(), Event()

    def confirming(api):
        with transaction.atomic():
            result = api.post(url, body, format="json")
            assert result.status_code == 200
            confirmed.set()
            assert resume.wait(10)
        return result

    def following_request(api):
        starting.set()
        try:
            if following == "delete":
                return api.delete(f"/api/packages/tasks/{task.id}/")
            return api.post(url, {**body, "evidence": "不得覆盖首次核对"}, format="json")
        finally:
            finished.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(request_as, actor, confirming)
        try:
            assert confirmed.wait(10)
            second = pool.submit(request_as, actor, following_request)
            assert starting.wait(10)
            assert not finished.wait(0.5), "后续操作未等待核对结果提交"
        finally:
            resume.set()
        saved = first.result(timeout=10).data["data"]
        result = second.result(timeout=10)
    assert result.status_code == 200
    if following == "confirm":
        assert result.data["data"] == saved
    assert client.get(f"/api/releases/{release.id}/oa-archive/records/").data["data"] == [saved]
    assert saved["no_order_confirmation"]["evidence"] == body["evidence"]
    assert len(oa_http.requests) == 1
