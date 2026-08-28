"""打包视图接口测试。"""
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.package.models import PackageConfig, PackageImage, PackageTask
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository


@pytest.fixture
def user():
    return User.objects.create_user(
        username="package_view_user",
        password="pass",
        nickname="打包视图用户",
    )


@pytest.fixture
def other_user():
    return User.objects.create_user(
        username="other_package_user",
        password="pass",
        nickname="其他用户",
    )


@pytest.fixture
def api_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(user):
    project = Project.objects.create(
        name="下载测试项目",
        code="DLT",
        leader=user,
        status=1,
    )
    ProjectMember.objects.create(project=project, user=user, role="software_admin")
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
def release(project, repository, user):
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="V1.0.0",
        tag_name="V1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        publisher=user,
    )


@pytest.fixture
def package_config(project, repository):
    image = PackageImage.objects.create(
        name="Web 镜像",
        image="trace-ship/web:latest",
    )
    return PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="Web 打包",
        image=image,
    )


@pytest.fixture
def task_with_artifacts(package_config, release, project, repository, user, tmp_path):
    """创建已包含产物文件的任务并返回任务对象。"""
    workspace = tmp_path / "workspaces" / "20260101" / str(package_config.id)
    artifacts_dir = workspace / "artifacts"
    artifacts_dir.mkdir(parents=True)
    (artifacts_dir / "app.tar.gz").write_bytes(b"fake app artifact")
    (artifacts_dir / "notes").mkdir()
    (artifacts_dir / "notes" / "release.md").write_text("release notes", encoding="utf-8")

    task = PackageTask.objects.create(
        config=package_config,
        release=release,
        project=project,
        repository=repository,
        triggered_by=user,
        name="Web 打包 / V1.0.0",
        build_type="web",
        tag_name="V1.0.0",
        version="V1.0.0",
        status="success",
        workspace_path=str(workspace),
        artifact_info=[
            {
                "id": "app-tar-gz",
                "name": "app.tar.gz",
                "path": "app.tar.gz",
                "size": 19,
                "sha256": "a" * 64,
            },
            {
                "id": "release-md",
                "name": "release.md",
                "path": "notes/release.md",
                "size": 13,
                "sha256": "b" * 64,
            },
        ],
    )
    return task


@pytest.mark.django_db
def test_download_all_artifacts_success(api_client, task_with_artifacts, monkeypatch):
    """一键下载全部产物返回包含所有文件的 zip。"""
    monkeypatch.setattr(
        "apps.package.views.PackageService.workspace_root",
        staticmethod(lambda: Path(task_with_artifacts.workspace_path).parent.parent.parent),
    )
    response = api_client.get(f"/api/packages/tasks/{task_with_artifacts.id}/download-all/")
    assert response.status_code == 200
    assert response["Content-Disposition"].startswith("attachment")
    assert "artifacts.zip" in response["Content-Disposition"]
    assert response["Content-Type"] == "application/zip"
    content = b"".join(response.streaming_content)
    with zipfile.ZipFile(BytesIO(content)) as zf:
        names = zf.namelist()
        assert "app.tar.gz" in names
        assert "notes/release.md" in names


@pytest.mark.django_db
def test_download_all_404_when_no_artifacts(
    api_client, package_config, release, project, repository, user, monkeypatch, tmp_path
):
    """任务没有产物时返回 404。"""
    workspace = tmp_path / "empty"
    (workspace / "artifacts").mkdir(parents=True)
    task = PackageTask.objects.create(
        config=package_config,
        release=release,
        project=project,
        repository=repository,
        triggered_by=user,
        name="无产物打包",
        build_type="web",
        tag_name="V1.0.0",
        version="V1.0.0",
        status="success",
        workspace_path=str(workspace),
        artifact_info=[],
    )
    monkeypatch.setattr(
        "apps.package.views.PackageService.workspace_root",
        staticmethod(lambda: tmp_path),
    )
    response = api_client.get(f"/api/packages/tasks/{task.id}/download-all/")
    assert response.status_code == 404


@pytest.mark.django_db
def test_download_all_forbidden_for_non_member(other_user, task_with_artifacts, monkeypatch):
    """非项目成员无法下载产物。"""
    client = APIClient()
    client.force_authenticate(user=other_user)
    monkeypatch.setattr(
        "apps.package.views.PackageService.workspace_root",
        staticmethod(lambda: Path(task_with_artifacts.workspace_path).parent.parent.parent),
    )
    response = client.get(f"/api/packages/tasks/{task_with_artifacts.id}/download-all/")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# 任务日志增量读取
# ---------------------------------------------------------------------------

@pytest.fixture
def task_with_log(package_config, release, project, repository, user, tmp_path):
    """带日志文件的任务（10 行 ASCII 日志）。"""
    workspace = tmp_path / "workspaces" / "20260101" / "task-log"
    logs_dir = workspace / "logs"
    logs_dir.mkdir(parents=True)
    content = "".join(f"line {i:03d} xxxxxxxxxx\n" for i in range(10))
    (logs_dir / "build.log").write_text(content, encoding="utf-8")
    task = PackageTask.objects.create(
        config=package_config,
        release=release,
        project=project,
        repository=repository,
        triggered_by=user,
        name="日志任务",
        build_type="web",
        tag_name="V1.0.0",
        version="V1.0.0",
        status="running",
        workspace_path=str(workspace),
        log_path=str(logs_dir / "build.log"),
    )
    return task, content


@pytest.mark.django_db
class TestTaskLogsIncremental:
    """日志 tail / offset 增量读取测试。"""

    @staticmethod
    def _patch_root(monkeypatch, tmp_path):
        monkeypatch.setattr(
            "apps.package.views.PackageService.workspace_root",
            staticmethod(lambda: tmp_path / "workspaces"),
        )

    def test_full_log_default(self, api_client, task_with_artifacts, task_with_log, monkeypatch, tmp_path):
        self._patch_root(monkeypatch, tmp_path)
        task, content = task_with_log
        response = api_client.get(f"/api/packages/tasks/{task.id}/logs/")
        assert response.status_code == 200
        assert b"".join(response.streaming_content).decode("utf-8") == content

    def test_tail_returns_last_bytes(self, api_client, task_with_log, monkeypatch, tmp_path):
        self._patch_root(monkeypatch, tmp_path)
        task, content = task_with_log
        response = api_client.get(f"/api/packages/tasks/{task.id}/logs/?tail=46")
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["size"] == len(content.encode("utf-8"))
        assert data["offset"] == data["size"] - 46
        assert data["content"] == content.encode("utf-8")[-46:].decode("utf-8")
        assert data["truncated"] is False

    def test_tail_larger_than_file(self, api_client, task_with_log, monkeypatch, tmp_path):
        self._patch_root(monkeypatch, tmp_path)
        task, content = task_with_log
        response = api_client.get(f"/api/packages/tasks/{task.id}/logs/?tail=999999")
        data = response.json()["data"]
        assert data["offset"] == 0
        assert data["content"] == content

    def test_offset_returns_increment(self, api_client, task_with_log, monkeypatch, tmp_path):
        self._patch_root(monkeypatch, tmp_path)
        task, content = task_with_log
        half = len(content.encode("utf-8")) // 2
        response = api_client.get(f"/api/packages/tasks/{task.id}/logs/?offset={half}")
        data = response.json()["data"]
        assert data["offset"] == half
        assert data["content"].encode("utf-8") == content.encode("utf-8")[half:]

    def test_offset_beyond_size_falls_back_full(self, api_client, task_with_log, monkeypatch, tmp_path):
        self._patch_root(monkeypatch, tmp_path)
        task, content = task_with_log
        response = api_client.get(f"/api/packages/tasks/{task.id}/logs/?offset=999999")
        data = response.json()["data"]
        assert data["truncated"] is True
        assert data["offset"] == 0
        assert data["content"] == content

    def test_invalid_offset_rejected(self, api_client, task_with_log, monkeypatch, tmp_path):
        self._patch_root(monkeypatch, tmp_path)
        task, _ = task_with_log
        response = api_client.get(f"/api/packages/tasks/{task.id}/logs/?offset=abc")
        assert response.status_code == 400

    def test_empty_log_incremental(self, api_client, package_config, release, project, repository, user, monkeypatch, tmp_path):
        self._patch_root(monkeypatch, tmp_path)
        task = PackageTask.objects.create(
            config=package_config, release=release, project=project, repository=repository,
            triggered_by=user, name="无日志任务", build_type="web", tag_name="V1.0.0",
            version="V1.0.0", status="queued",
        )
        response = api_client.get(f"/api/packages/tasks/{task.id}/logs/?offset=0")
        assert response.status_code == 200
        assert response.json()["data"]["content"] == ""


@pytest.mark.django_db
def test_task_list_filter_by_triggered_by(
    api_client, package_config, release, project, repository, user, other_user
):
    """任务列表支持按发起人过滤（工作台「打包发起人是当前登录人」口径）。"""
    mine = PackageTask.objects.create(
        config=package_config, release=release, project=project, repository=repository,
        triggered_by=user, name="我的打包", build_type="web", tag_name="V1.0.0",
        version="V1.0.0", status="failure",
    )
    PackageTask.objects.create(
        config=package_config, release=release, project=project, repository=repository,
        triggered_by=other_user, name="他人的打包", build_type="web", tag_name="V1.0.0",
        version="V1.0.0", status="failure",
    )
    response = api_client.get(f"/api/packages/tasks/?triggered_by={user.id}")
    assert response.status_code == 200
    results = response.json()["data"]["results"]
    assert [t["id"] for t in results] == [str(mine.id)]


@pytest.mark.django_db
def test_migration_0022_updates_unfinished_task_snapshots(
    package_config, release, project, repository, user
):
    """0022 数据迁移：配置与未结束任务快照中的 remote_windows 一并迁为 remote_node。"""
    import importlib

    from django.apps import apps as global_apps

    mig = importlib.import_module(
        "apps.package.migrations.0022_alter_packageconfig_executor_type_and_more"
    )
    package_config.executor_type = "remote_windows"
    package_config.save(update_fields=["executor_type"])
    queued = PackageTask.objects.create(
        config=package_config, release=release, project=project, repository=repository,
        triggered_by=user, name="排队任务", build_type="web", tag_name="V1.0.0",
        version="V1.0.0", status="queued",
        config_snapshot={"executor_type": "remote_windows"},
    )
    finished = PackageTask.objects.create(
        config=package_config, release=release, project=project, repository=repository,
        triggered_by=user, name="已结束任务", build_type="web", tag_name="V1.0.0",
        version="V1.0.0", status="success",
        config_snapshot={"executor_type": "remote_windows"},
    )

    mig.executor_type_to_remote_node(global_apps, None)

    package_config.refresh_from_db()
    queued.refresh_from_db()
    finished.refresh_from_db()
    assert package_config.executor_type == "remote_node"
    assert queued.config_snapshot["executor_type"] == "remote_node"
    # 已结束任务的快照不再执行，保持原样
    assert finished.config_snapshot["executor_type"] == "remote_windows"

    mig.executor_type_back_to_remote_windows(global_apps, None)
    queued.refresh_from_db()
    assert queued.config_snapshot["executor_type"] == "remote_windows"
