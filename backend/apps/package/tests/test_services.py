import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.package.models import PackageConfig, PackageImage, PackageTask
from apps.package.services import PackageService
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository


@pytest.fixture
def user():
    """测试用户。"""
    return User.objects.create_user(
        username="package_user",
        password="pass",
        nickname="打包用户",
    )


@pytest.fixture
def api_client(user):
    """已认证测试客户端。"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(user):
    """测试项目。"""
    project = Project.objects.create(
        name="打包项目",
        code="PKG",
        leader=user,
        status=1,
    )
    ProjectMember.objects.create(project=project, user=user, role="manager")
    return project


@pytest.fixture
def repository(project):
    """测试仓库。"""
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="web",
        url="https://gitlab.example.com",
        external_identity="group/web",
        default_branch="main",
    )


@pytest.mark.django_db
def test_trigger_auto_packages_creates_task(project, repository, user, monkeypatch):
    """发布成功后为启用的自动打包配置创建任务。"""
    image = PackageImage.objects.create(
        name="Web 镜像",
        build_type="web",
        image="trace-ship/web:latest",
    )
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="Web 打包",
        mode="simple",
        build_type="web",
        image=image,
        auto_package_on_release=True,
    )
    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        publisher=user,
    )
    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", lambda task_id: None)

    tasks = PackageService.trigger_auto_packages_for_release(release, request_user=user)

    assert len(tasks) == 1
    assert tasks[0].config_id == config.id
    assert tasks[0].status == "queued"


@pytest.mark.django_db
def test_package_images_readable_for_authenticated_user(api_client):
    """项目配置选择镜像时，普通登录用户可以读取启用镜像列表。"""
    PackageImage.objects.create(
        name="Web 镜像",
        build_type="web",
        image="trace-ship/web:latest",
    )

    response = api_client.get("/api/packages/images/", {"build_type": "web", "is_active": True})

    assert response.status_code == 200
    assert response.data["data"]["total"] == 1


@pytest.mark.django_db
def test_package_images_write_requires_superuser(api_client):
    """镜像维护仍然仅允许超管写入。"""
    response = api_client.post(
        "/api/packages/images/",
        {
            "name": "Web 镜像",
            "build_type": "web",
            "image": "trace-ship/web:latest",
        },
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_create_task_falls_back_to_local_worker_when_celery_broker_unavailable(project, repository, user, monkeypatch):
    """Celery 投递失败时不让手动触发接口 500，而是降级为本地后台执行。"""
    image = PackageImage.objects.create(
        name="Web 镜像",
        build_type="web",
        image="trace-ship/web:latest",
    )
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="Web 打包",
        mode="simple",
        build_type="web",
        image=image,
    )
    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        publisher=user,
    )

    def raise_connection_refused(task_id):
        raise ConnectionError("[Errno 111] Connection refused")

    dispatched = {}

    def fake_local_worker(task_id, reason=""):
        dispatched["task_id"] = task_id
        dispatched["reason"] = reason

    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", raise_connection_refused)
    monkeypatch.setattr(PackageService, "_start_local_worker", fake_local_worker)

    task = PackageService.create_task_for_release(config, release, request_user=user)

    assert task.status == "queued"
    assert dispatched["task_id"] == str(task.id)
    assert "Connection refused" in dispatched["reason"]


def test_display_command_masks_docker_env_values():
    """任务日志中的 docker 环境变量值需要脱敏。"""
    command = [
        "docker", "run", "--rm",
        "-e", "NEXUS_PASSWORD=secret",
        "-e", "PUBLIC_FLAG=true",
        "trace-ship/web:latest",
    ]

    display = PackageService._display_command(command)

    assert "NEXUS_PASSWORD=******" in display
    assert "PUBLIC_FLAG=******" in display
    assert "secret" not in display
    assert "PUBLIC_FLAG=true" not in display


@pytest.mark.django_db
def test_prepare_workspace_isolated(project, repository, user, settings, tmp_path):
    """每个任务生成独立工作区目录。"""
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        publisher=user,
    )
    task = PackageTask.objects.create(
        release=release,
        project=project,
        repository=repository,
        name="打包任务",
        mode="local",
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
    )

    workspace = PackageService.prepare_workspace(task)

    assert workspace.name == str(task.id)
    assert (workspace / "source").exists()
    assert (workspace / "artifacts").exists()
    assert (workspace / "logs").exists()


@pytest.mark.django_db
def test_simple_package_does_not_precreate_source_output_dir(project, repository, user, tmp_path, monkeypatch):
    """简易打包不能提前创建源码产物目录，否则镜像会复制空目录。"""
    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        publisher=user,
    )
    task = PackageTask.objects.create(
        release=release,
        project=project,
        repository=repository,
        name="打包任务",
        mode="simple",
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot={
            "image": "trace-ship/web-builder:node22",
            "script_entry": "/usr/local/bin/trace-ship-build",
            "build_path": ".",
            "output_path": "artifacts",
        },
    )
    workspace = tmp_path / "workspace"
    (workspace / "source").mkdir(parents=True)
    (workspace / "artifacts").mkdir(parents=True)

    monkeypatch.setattr(PackageService, "_run_command", lambda *args, **kwargs: None)

    PackageService._run_simple(task, workspace)

    assert not (workspace / "source" / "artifacts").exists()


@pytest.mark.django_db
def test_simple_package_uses_fixed_dist_and_artifacts_dir(project, repository, user, tmp_path, monkeypatch):
    """Web 简易打包固定从 dist 收集产物到 /workspace/artifacts。"""
    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        publisher=user,
    )
    task = PackageTask.objects.create(
        release=release,
        project=project,
        repository=repository,
        name="打包任务",
        mode="simple",
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot={
            "image": "trace-ship/web-builder:node22",
            "script_entry": "/usr/local/bin/trace-ship-build",
            "build_path": ".",
            "output_path": "custom-output",
            "env_vars": {"ARTIFACTS_DIR": "/custom/artifacts"},
        },
    )
    workspace = tmp_path / "workspace"
    (workspace / "source").mkdir(parents=True)
    (workspace / "artifacts").mkdir(parents=True)
    captured = {}

    def capture_command(task, command, cwd, env=None, shell=False):
        captured["command"] = command

    monkeypatch.setattr(PackageService, "_run_command", capture_command)

    PackageService._run_simple(task, workspace)

    command = captured["command"]
    assert "-e" in command
    assert "OUTPUT_PATH=dist" in command
    assert "ARTIFACTS_DIR=/workspace/artifacts" in command
    assert f"{workspace / 'artifacts'}:/workspace/artifacts" in command
    assert "ARTIFACTS_DIR=/custom/artifacts" in command
    assert command.index("ARTIFACTS_DIR=/workspace/artifacts") > command.index("ARTIFACTS_DIR=/custom/artifacts")


@pytest.mark.django_db
def test_package_failure_does_not_rollback_release(project, repository, user, settings, tmp_path, monkeypatch):
    """打包失败不回滚已发布状态。"""
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        publisher=user,
    )
    task = PackageTask.objects.create(
        release=release,
        project=project,
        repository=repository,
        name="打包任务",
        mode="local",
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot={"local_script": "exit 1"},
    )
    monkeypatch.setattr(PackageService, "_checkout_source", lambda task, workspace: None)

    PackageService.run_task(task)
    release.refresh_from_db()
    task.refresh_from_db()

    assert release.status == "released"
    assert task.status == "failure"
