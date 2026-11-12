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
