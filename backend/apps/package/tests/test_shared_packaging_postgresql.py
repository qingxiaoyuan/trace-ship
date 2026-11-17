"""使用独立 PostgreSQL 连接验证分支任务快照与共享配置编辑竞争。"""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest
from django.db import close_old_connections, connection

from apps.credential.models import Credential
from apps.package.models import PackageTask
from apps.package.tests import test_shared_packaging
from apps.package.tests.test_shared_packaging import client_for, create_shared_config

shared = test_shared_packaging.shared

pytestmark = pytest.mark.django_db(transaction=True)


def test_shared_branch_snapshot_and_edit_serialize(shared, monkeypatch):
    if connection.vendor != "postgresql":
        pytest.skip("共享配置修改与快照竞争需要 PostgreSQL 行锁")

    owner, admin, collaborator, _, software, (_, project, _), image = shared
    credential = Credential.objects.create(name="并发分支凭证", cred_type="gitlab_token", owner=owner)
    credential.set_data({"token": "isolated-token"})
    credential.save()
    software.repository.credential = credential
    software.repository.save(update_fields=["credential"])
    response = create_shared_config(collaborator, software, image, custom_script="echo before")
    assert response.status_code == 200, response.data
    url = f"/api/packages/configs/{response.data['data']['id']}/"
    locked, resume = Event(), Event()
    writer_started, writer_finished = Event(), Event()
    dispatched_snapshots = []

    def get_branch(_identity, name):
        locked.set()
        assert resume.wait(12), "未恢复持锁的分支任务请求"
        return SimpleNamespace(name=name, last_commit_hash="b" * 40)

    def dispatch(task_id):
        dispatched_snapshots.append(PackageTask.objects.get(pk=task_id).config_snapshot)

    monkeypatch.setattr("apps.package.services.tasks.get_provider", lambda *args: SimpleNamespace(get_branch=get_branch))
    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", dispatch)

    def trigger():
        close_old_connections()
        try:
            return client_for(admin).post(f"{url}trigger-branch/", {
                "project": str(project.pk), "software": str(software.pk), "branch": "main",
            }, format="json")
        finally:
            close_old_connections()

    def edit():
        close_old_connections()
        try:
            writer_started.set()
            return client_for(collaborator).patch(url, {
                "custom_script": "echo after", "env_vars": {"BUILD_OPTION": "updated"},
            }, format="json")
        finally:
            writer_finished.set()
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        creating = executor.submit(trigger)
        try:
            assert locked.wait(10), "分支请求未建立持锁阶段"
            updating = executor.submit(edit)
            assert writer_started.wait(10)
            assert not writer_finished.wait(1), "配置编辑未等待任务快照事务"
        finally:
            resume.set()
        created = creating.result(timeout=15)
        updated = updating.result(timeout=15)

    assert created.status_code == 201, created.data
    assert updated.status_code == 200, updated.data
    assert updated.data["data"]["custom_script"] == "echo after"
    assert len(dispatched_snapshots) == 1
    assert dispatched_snapshots[0]["custom_script"] == "echo before"
    assert dispatched_snapshots[0]["env_vars"] == {"BUILD_OPTION": "saved"}
