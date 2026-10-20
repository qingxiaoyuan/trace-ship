"""以独立数据库连接验证配置锁与补打快照的真实事务竞争。"""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import pytest
from django.db import close_old_connections, connection, transaction
from rest_framework.response import Response
from rest_framework.test import APIClient

from apps.account.models import User
from apps.package.models import PackageConfig, PackageImage, PackageTask
from apps.package.services import PackageService
from apps.project.models import Project, ProjectComponent, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def locked_context(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    """只替换外部投递，数据库事务、行锁、授权和任务创建均使用生产代码。"""
    if connection.vendor != "postgresql":
        pytest.skip("配置并发保护需要 PostgreSQL 行锁")
    manager = User.objects.create_user(username="lock_manager")
    actor = User.objects.create_user(username="lock_developer")
    project = Project.objects.create(code="LOCK", name="配置锁项目", leader=manager)
    ProjectMember.objects.create(project=project, user=manager, role="manager")
    ProjectMember.objects.create(project=project, user=actor, role="developer")
    repository = Repository.objects.create(
        name="配置锁软件", vendor="gitlab", url="https://example.invalid",
        external_identity="locks/repackage", created_by=manager,
    )
    component = ProjectComponent.objects.create(project=project, repository=repository, component_code="locks")
    image = PackageImage.objects.create(name="配置锁镜像", image="example.invalid/checks:1")
    config = PackageConfig.objects.create(
        project_component=component, image=image, name="配置锁样本", custom_script="echo saved-script",
        env_vars={"BUILD_FLAG": "saved-value"},
    )
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=manager, status="released",
        release_type="formal", version="V1.0.0", tag_name="V1.0.0", git_hash="a" * 40,
    )
    other = Project.objects.create(code="LOCK-OTHER", name="只读项目", leader=manager)
    ProjectMember.objects.create(project=other, user=actor, role="viewer")
    other_component = ProjectComponent.objects.create(project=other, repository=repository, component_code="other")
    dispatched: list[str] = []
    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", lambda task_id: dispatched.append(task_id))
    return SimpleNamespace(
        actor=actor, config=config, release=release, other_component=other_component, dispatched=dispatched,
    )


def trigger(context: SimpleNamespace, started: Event, completed: Event) -> Response:
    """每个线程使用独立连接，HTTP 请求走真实权限和事务创建服务。"""
    close_old_connections()
    client = APIClient()
    client.force_authenticate(context.actor)
    try:
        started.set()
        return client.post(
            f"/api/packages/configs/{context.config.id}/trigger/",
            {"release_id": str(context.release.id)}, format="json",
        )
    finally:
        completed.set()
        close_old_connections()


@pytest.mark.parametrize("change,status", [("disabled", 400), ("moved-project", 403)])
def test_repackage_waits_for_config_change_and_revalidates(
    locked_context: SimpleNamespace, change: str, status: int,
) -> None:
    """配置先持锁时，补打等待提交并读取停用状态或当前项目权限。"""
    locked, resume, started, completed = Event(), Event(), Event(), Event()

    def change_config() -> None:
        close_old_connections()
        try:
            with transaction.atomic():
                config = PackageConfig.objects.select_for_update().get(pk=locked_context.config.pk)
                if change == "disabled":
                    config.is_active = False
                    config.save(update_fields=["is_active"])
                else:
                    config.project_component = locked_context.other_component
                    config.save(update_fields=["project_component"])
                locked.set()
                assert resume.wait(10), "未恢复配置修改事务"
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        changed = executor.submit(change_config)
        try:
            assert locked.wait(10), "配置修改未取得行锁"
            created = executor.submit(trigger, locked_context, started, completed)
            assert started.wait(10)
            assert not completed.wait(1), "补打未等待配置修改事务释放行锁"
        finally:
            resume.set()
        changed.result(timeout=15)
        response = created.result(timeout=15)
    assert response.status_code == status, response.data
    assert not PackageTask.objects.exists()
    assert locked_context.dispatched == []


def test_config_writer_waits_for_repackage_snapshot(
    locked_context: SimpleNamespace, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """补打先持配置锁时，配置写入等待，已创建任务保存完整旧快照。"""
    snapshot_ready, resume, updating, updated = Event(), Event(), Event(), Event()
    original_snapshot = PackageService._snapshot

    def paused_snapshot(config: PackageConfig) -> dict[str, object]:
        snapshot = original_snapshot(config)
        snapshot_ready.set()
        assert resume.wait(10), "未恢复补打快照事务"
        return snapshot

    monkeypatch.setattr(PackageService, "_snapshot", staticmethod(paused_snapshot))

    def update_config() -> None:
        close_old_connections()
        try:
            updating.set()
            PackageConfig.objects.filter(pk=locked_context.config.pk).update(
                custom_script="echo future-script", env_vars={"BUILD_FLAG": "future-value"},
            )
        finally:
            updated.set()
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as executor:
        created = executor.submit(trigger, locked_context, Event(), Event())
        try:
            assert snapshot_ready.wait(10), "补打未进入持锁快照阶段"
            changed = executor.submit(update_config)
            assert updating.wait(10)
            assert not updated.wait(1), "配置写入未等待补打提交快照"
        finally:
            resume.set()
        response = created.result(timeout=15)
        changed.result(timeout=15)
    assert response.status_code == 201, response.data
    task = PackageTask.objects.get()
    assert task.config_snapshot["custom_script"] == "echo saved-script"
    assert task.config_snapshot["env_vars"] == {"BUILD_FLAG": "saved-value"}
    locked_context.config.refresh_from_db()
    assert locked_context.config.custom_script == "echo future-script"
    assert locked_context.dispatched == [str(task.id)]
