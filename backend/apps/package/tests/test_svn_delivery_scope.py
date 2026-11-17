"""共享配置产物的 SVN 推送、浏览和旧目录保护。"""

from types import SimpleNamespace

import pytest

from apps.credential.models import Credential
from apps.package.models import PackageConfig, PackageTask
from apps.package.tests.svn_sandbox import svn_sandbox as _svn_sandbox
from apps.package.tests.test_shared_packaging import client_for
from apps.package.tests.test_shared_packaging import shared as _shared
from apps.release.models import ReleaseRecord

shared = _shared
svn_sandbox = _svn_sandbox


def make_svn_tasks(shared, tmp_path, svn_url):
    owner, admin, _, _, software, (a, b, _), image = shared
    credential = Credential.objects.create(name="交付范围凭证", cred_type="svn_password", owner=owner)
    credential.set_data({"username": "reader", "password": "isolated-pass"})
    credential.save()
    config = PackageConfig.objects.create(
        software=software, name="共享覆盖配置", image=image, svn_url=svn_url,
        svn_push_enabled=True, svn_credential=credential, svn_commit_mode="overwrite",
    )
    release = ReleaseRecord.objects.create(
        project=a, repository=software.repository, software=software, publisher=owner,
        status="released", release_type="formal", version="3.0.0", tag_name="client/V3.0.0", git_hash="b" * 40,
        release_doc="首次说明",
    )
    tasks = []
    for label, project in (("alpha", a), ("bravo", b)):
        workspace = tmp_path / label
        (workspace / "artifacts").mkdir(parents=True)
        (workspace / "artifacts" / "package.txt").write_text(label)
        snapshot = {
            "svn_url": svn_url, "svn_credential_id": str(credential.pk),
            "svn_commit_mode": "overwrite", "svn_push_enabled": True, "svn_path_template": "{version}",
            "trigger_source": "manual_release",
        }
        tasks.append(PackageTask.objects.create(
            project=project, repository=software.repository, software=software, config=config, release=release,
            status="success", name=label, version=release.version, tag_name=release.tag_name,
            workspace_path=str(workspace), config_snapshot=snapshot,
            artifact_info=[{"id": label, "path": "package.txt", "name": "package.txt"}],
        ))
    return SimpleNamespace(owner=owner, admin=admin, config=config, tasks=tasks, release=release, credential=credential)


def task_api(task, operation):
    return f"/api/packages/tasks/{task.pk}/{operation}/"


@pytest.mark.django_db
def test_real_svn_same_project_repush_and_other_project_collision(shared, svn_sandbox, tmp_path, settings):
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    sample = make_svn_tasks(shared, tmp_path, svn_sandbox.url)
    first, second = sample.tasks
    client = client_for(sample.admin)
    target = svn_sandbox.url + "/formal/3.0.0"
    initial = client.post(task_api(first, "push-svn"))
    assert initial.status_code == 200, initial.data
    conflict = client.post(task_api(second, "push-svn"))
    assert conflict.status_code == 400 and "目录" in conflict.data["message"]
    assert first.project.name not in str(conflict.data) and "alpha" not in str(conflict.data)
    assert svn_sandbox.svn("cat", target + "/package.txt") == "alpha"
    assert client.get(task_api(first, "svn-artifacts")).status_code == 200

    (tmp_path / "alpha" / "artifacts" / "package.txt").write_text("alpha v2")
    assert client.post(task_api(first, "push-svn")).status_code == 200
    assert svn_sandbox.svn("cat", target + "/package.txt") == "alpha v2"

    # 旧快照或另一个配置以等价编码指向子目录时，不能继承其他项目目录的当前文件。
    second.config_snapshot.update(svn_path_template="formal/%33.0.0/child")
    second.save(update_fields=["config_snapshot"])
    assert client.post(task_api(second, "push-svn")).status_code == 400
    second.stage_info = {"svn_push": {"status": "success", "remote_url": target + "/"}}
    second.save(update_fields=["stage_info"])
    for task in (first, second):
        assert client.get(task_api(task, "svn-artifacts")).status_code == 409
    result = client.get(f"/api/releases/{sample.release.pk}/oa-archive/options/")
    assert result.status_code == 200 and result.data["data"]["directories"] == []
    from apps.package.services import PackageService

    synced = PackageService.sync_release_docs_to_svn(sample.release)
    assert len(synced) == 1 and not synced[0]["ok"] and "冲突" in synced[0]["error"]
    assert svn_sandbox.svn("cat", target + "/release-3.0.0.md") == "首次说明"
    test_url = "/api/packages/configs/test-svn/"
    probe = client.post(test_url, {
        "project_id": str(second.project_id), "svn_url": svn_sandbox.url,
        "svn_credential_id": str(sample.credential.pk), "svn_path_template": "formal",
    }, format="json")
    assert probe.status_code == 409 and probe.data["data"] is None


@pytest.mark.django_db(transaction=True)
def test_postgresql_first_svn_push_reserves_directory_before_remote_write(shared, tmp_path, monkeypatch):
    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
    from threading import Barrier, Event

    from django.db import close_old_connections, connection

    if connection.vendor != "postgresql":
        pytest.skip("跨项目 SVN 首次推送竞争需要真实 PostgreSQL")
    sample = make_svn_tasks(shared, tmp_path, "svn://isolated.example.test/repo")
    inspected, writing, release_write = Barrier(2), Event(), Event()
    operations = []
    target = "svn://isolated.example.test/repo/formal/3.0.0"

    def remote_exists(url):
        if url == target:
            # 两个请求都在首次检查时看到空目录。
            inspected.wait(timeout=10)
            return False
        return True

    def import_path(upload, url, message):
        operations.append(url)
        writing.set()
        assert release_write.wait(timeout=12)

    monkeypatch.setattr("apps.package.services.svn.get_provider", lambda *args: SimpleNamespace(
        remote_exists=remote_exists, import_path=import_path,
    ))

    def push(task):
        close_old_connections()
        try:
            return client_for(sample.admin).post(task_api(task, "push-svn"))
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as workers:
        requests = [workers.submit(push, task) for task in sample.tasks]
        try:
            assert writing.wait(timeout=10)
            done, _ = wait(requests, timeout=10, return_when=FIRST_COMPLETED)
            assert len(done) == 1
            refused = done.pop().result()
            assert refused.status_code == 400
            assert "目录" in refused.data["message"]
        finally:
            release_write.set()
        assert sorted(request.result(timeout=12).status_code for request in requests) == [200, 400]
    assert operations == [target]
