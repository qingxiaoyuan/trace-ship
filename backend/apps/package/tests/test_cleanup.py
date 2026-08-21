"""打包工作区清理相关测试：源码即删、产物过期清理、节点目录每日清理。"""
from pathlib import Path

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.credential.models import Credential
from apps.package.models import PackageConfig, PackageImage, PackageNode, PackageTask
from apps.package.services import PackageService
from apps.package.services.cleanup import (
    cleanup_expired_artifacts,
    cleanup_remote_node_workspaces,
    get_artifact_retention_days,
)
from apps.project.models import Project, ProjectMember
from apps.repository.models import Repository
from apps.system.models import SystemConfig


@pytest.fixture
def user():
    return User.objects.create_user(username="cleanup_user", password="pass", nickname="清理用户")


@pytest.fixture
def api_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(user):
    project = Project.objects.create(name="清理项目", code="CLN", leader=user, status=1)
    ProjectMember.objects.create(project=project, user=user, role="manager")
    return project


@pytest.fixture
def repository(project):
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="web",
        url="https://gitlab.example.com",
        external_identity="group/web",
        default_branch="main",
    )


@pytest.fixture
def package_config(project, repository):
    image = PackageImage.objects.create(name="Web 镜像", image="trace-ship/web:latest")
    return PackageConfig.objects.create(
        project=project, repository=repository, name="Web 打包", image=image,
    )


def _make_task(project, repository, **kwargs):
    defaults = {
        "project": project,
        "repository": repository,
        "name": "打包任务",
        "tag_name": "VA.1.0.0",
        "version": "VA.1.0.0",
        "config_snapshot": {"custom_script": "echo ok"},
    }
    defaults.update(kwargs)
    return PackageTask.objects.create(**defaults)


@pytest.mark.django_db
def test_run_task_removes_source_on_success(project, repository, user, settings, tmp_path, monkeypatch):
    """打包成功后删除工作区源码与临时目录，产物与日志保留。"""
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    task = _make_task(project, repository)

    def fake_checkout(task, workspace):
        (workspace / "source" / "app.py").write_text("print('hi')", encoding="utf-8")
        (workspace / "tmp" / "cache.txt").write_text("tmp", encoding="utf-8")

    monkeypatch.setattr(PackageService, "_checkout_source", fake_checkout)
    monkeypatch.setattr(PackageService, "_run_container", lambda task, workspace: None)

    PackageService.run_task(task)
    task.refresh_from_db()

    workspace = Path(task.workspace_path)
    assert task.status == "success"
    assert not (workspace / "source").exists()
    assert not (workspace / "tmp").exists()
    assert (workspace / "artifacts").exists()
    assert (workspace / "logs" / "build.log").exists()


@pytest.mark.django_db
def test_run_task_removes_source_on_failure(project, repository, user, settings, tmp_path, monkeypatch):
    """打包失败同样删除源码，构建日志保留供排查。"""
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    task = _make_task(project, repository)

    def fake_checkout(task, workspace):
        (workspace / "source" / "app.py").write_text("print('hi')", encoding="utf-8")

    def fail_container(task, workspace):
        raise RuntimeError("构建失败")

    monkeypatch.setattr(PackageService, "_checkout_source", fake_checkout)
    monkeypatch.setattr(PackageService, "_run_container", fail_container)

    PackageService.run_task(task)
    task.refresh_from_db()

    workspace = Path(task.workspace_path)
    assert task.status == "failure"
    assert not (workspace / "source").exists()
    assert (workspace / "logs" / "build.log").exists()
    assert "构建失败" in (workspace / "logs" / "build.log").read_text(encoding="utf-8")


@pytest.mark.django_db
class TestCleanupExpiredArtifacts:
    def _finished_task(self, project, repository, tmp_path, days_ago, with_artifacts=True):
        """构造 finished_at 为 N 天前的任务与本地工作区。"""
        from django.utils import timezone

        task = _make_task(
            project, repository,
            status="success",
            artifact_info=[{"id": "a", "name": "a.zip", "path": "a.zip", "size": 1, "sha256": "x"}],
        )
        workspace = tmp_path / str(task.id)
        (workspace / "artifacts").mkdir(parents=True)
        (workspace / "logs").mkdir(parents=True)
        if with_artifacts:
            (workspace / "artifacts" / "a.zip").write_text("zip", encoding="utf-8")
        task.workspace_path = str(workspace)
        task.save(update_fields=["workspace_path", "updated_at"])
        finished_at = timezone.now() - timezone.timedelta(days=days_ago)
        PackageTask.objects.filter(id=task.id).update(finished_at=finished_at)
        task.refresh_from_db()
        return task

    def test_expired_artifacts_removed(self, project, repository, tmp_path):
        """超期任务产物目录删除、artifact_info 清空；未超期任务不受影响。"""
        old_task = self._finished_task(project, repository, tmp_path, days_ago=40)
        new_task = self._finished_task(project, repository, tmp_path, days_ago=2)

        result = cleanup_expired_artifacts()

        assert result["retention_days"] == 30
        assert result["cleaned"] == 1
        assert result["errors"] == []

        old_task.refresh_from_db()
        assert not (Path(old_task.workspace_path) / "artifacts").exists()
        # 日志目录保留
        assert (Path(old_task.workspace_path) / "logs").exists()
        assert old_task.artifact_info == []
        assert "artifacts_cleaned_at" in (old_task.stage_info or {})

        new_task.refresh_from_db()
        assert (Path(new_task.workspace_path) / "artifacts" / "a.zip").exists()
        assert new_task.artifact_info != []

    def test_retention_days_configurable_via_sys_config(self, project, repository, tmp_path):
        """系统配置页面维护的保留天数优先生效。"""
        task = self._finished_task(project, repository, tmp_path, days_ago=40)
        SystemConfig.objects.create(
            key="package_artifact_retention_days", value="60", description="测试",
        )

        result = cleanup_expired_artifacts()

        assert result["retention_days"] == 60
        assert result["cleaned"] == 0
        assert (Path(task.workspace_path) / "artifacts" / "a.zip").exists()

    def test_retention_days_invalid_value_falls_back_to_default(self):
        """非法配置值回退默认 30 天。"""
        SystemConfig.objects.create(key="package_artifact_retention_days", value="abc")
        assert get_artifact_retention_days() == 30
        SystemConfig.objects.filter(key="package_artifact_retention_days").update(value="0")
        assert get_artifact_retention_days() == 30


class FakeRemoteClient:
    """模拟远程 Windows 客户端：预置目录清单，记录删除调用。"""

    dir_entries: list[str] = []
    removed: list[str] = []

    def __init__(self, host, port, username, password, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def run(self, command, on_line=None, **kwargs):
        if on_line and "dir /b /ad" in command:
            for name in type(self).dir_entries:
                on_line(name)
        return 0

    def remove_dir(self, path):
        type(self).removed.append(str(path))


@pytest.mark.django_db
class TestCleanupRemoteNodeWorkspaces:
    @pytest.fixture
    def windows_credential(self, user):
        cred = Credential.objects.create(
            name="Windows 凭证", cred_type="windows_password", auth_mode="password",
            owner=user, is_active=True,
        )
        cred.set_data({"username": "builder", "password": "secret"})
        cred.save()
        return cred

    @pytest.fixture
    def node(self, windows_credential):
        return PackageNode.objects.create(
            name="节点 A", host="192.168.1.100", port=22,
            credential=windows_credential, work_root=r"C:\trace-ship\workspaces",
        )

    def test_removes_stale_dirs_and_skips_running(self, project, repository, node, monkeypatch):
        """残留目录被删除，运行中任务目录跳过。"""
        running_task = _make_task(
            project, repository,
            status="running",
            config_snapshot={"node_id": str(node.id)},
        )
        FakeRemoteClient.dir_entries = [str(running_task.id), "stale-task-id"]
        FakeRemoteClient.removed = []
        monkeypatch.setattr("apps.package.services.cleanup.RemoteWindowsClient", FakeRemoteClient)

        result = cleanup_remote_node_workspaces()

        assert result["errors"] == []
        assert FakeRemoteClient.removed == [r"C:\trace-ship\workspaces\stale-task-id"]
        node_result = result["nodes"][0]
        assert node_result["removed"] == ["stale-task-id"]
        assert node_result["skipped"] == [str(running_task.id)]

    def test_dangerous_work_root_rejected(self, node, windows_credential, monkeypatch):
        """节点工作目录误配置为盘符根目录时拒绝清理，防止删整盘。"""
        node.work_root = "C:\\"
        node.save(update_fields=["work_root", "updated_at"])
        client_calls = []
        monkeypatch.setattr(
            "apps.package.services.cleanup.RemoteWindowsClient",
            lambda *args, **kwargs: client_calls.append(1) or FakeRemoteClient(),
        )

        result = cleanup_remote_node_workspaces()

        assert result["nodes"] == []
        assert len(result["errors"]) == 1
        assert "拒绝清理" in result["errors"][0]
        # 未建立任何 SSH 连接
        assert client_calls == []

    def test_node_failure_does_not_block_others(self, project, repository, node, user, monkeypatch):
        """单节点凭证/连接失败仅记入 errors，不影响其他节点。"""
        bad_cred = Credential.objects.create(
            name="停用凭证", cred_type="windows_password", auth_mode="password",
            owner=user, is_active=False,
        )
        PackageNode.objects.create(
            name="坏节点", host="192.168.1.101", port=22,
            credential=bad_cred, work_root=r"C:\trace-ship\workspaces",
        )
        FakeRemoteClient.dir_entries = ["stale-task-id"]
        FakeRemoteClient.removed = []
        monkeypatch.setattr("apps.package.services.cleanup.RemoteWindowsClient", FakeRemoteClient)

        result = cleanup_remote_node_workspaces()

        assert len(result["errors"]) == 1
        assert "坏节点" in result["errors"][0]
        assert len(result["nodes"]) == 1
        assert result["nodes"][0]["removed"] == ["stale-task-id"]


@pytest.mark.django_db
def test_task_list_status_multi_value_filter(api_client, project, repository):
    """任务列表接口支持 ?status=queued,running 多值过滤。"""
    _make_task(project, repository, name="排队中任务", status="queued")
    _make_task(project, repository, name="运行中任务", status="running")
    _make_task(project, repository, name="成功任务", status="success")
    _make_task(project, repository, name="失败任务", status="failure")

    response = api_client.get("/api/packages/tasks/", {"status": "queued,running"})

    assert response.status_code == 200
    names = {item["name"] for item in response.data["data"]["results"]}
    assert names == {"排队中任务", "运行中任务"}


@pytest.mark.django_db
def test_task_list_status_single_value_still_works(api_client, project, repository):
    """单值 status 过滤保持兼容。"""
    _make_task(project, repository, name="成功任务", status="success")
    _make_task(project, repository, name="失败任务", status="failure")

    response = api_client.get("/api/packages/tasks/", {"status": "success"})

    assert response.status_code == 200
    names = {item["name"] for item in response.data["data"]["results"]}
    assert names == {"成功任务"}
