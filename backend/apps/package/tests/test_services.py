import pytest
from rest_framework.test import APIClient
import subprocess
import signal
from pathlib import Path

from apps.account.models import User
from apps.package.models import PackageConfig, PackageImage, PackageTask
from apps.package.services import PackageService, PackageTaskCanceledError
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository
from utils.markdown_table import table_newlines_to_br


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
        image="trace-ship/web:latest",
    )
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="Web 打包",
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
        image="trace-ship/web:latest",
    )

    response = api_client.get("/api/packages/images/", {"is_active": True})

    assert response.status_code == 200
    assert response.data["data"]["total"] == 1


@pytest.mark.django_db
def test_package_images_write_requires_superuser(api_client):
    """镜像维护仍然仅允许超管写入。"""
    response = api_client.post(
        "/api/packages/images/",
        {
            "name": "Web 镜像",
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
        image="trace-ship/web:latest",
    )
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="Web 打包",
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
        tag_name=release.tag_name,
        version=release.version,
    )

    workspace = PackageService.prepare_workspace(task)

    assert workspace.name == str(task.id)
    assert (workspace / "source").exists()
    assert (workspace / "artifacts").exists()
    assert (workspace / "logs").exists()


@pytest.mark.django_db
def test_checkout_source_writes_release_doc(project, repository, user, tmp_path, monkeypatch):
    """拉取源码后把发布说明写入源码根目录。"""
    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        release_doc="# 发布说明\n\n- 修复问题",
        publisher=user,
    )
    task = PackageTask.objects.create(
        release=release,
        project=project,
        repository=repository,
        name="打包任务",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot={},
    )
    workspace = tmp_path / "workspace"
    (workspace / "source").mkdir(parents=True)
    monkeypatch.setattr(PackageService, "_run_command", lambda *args, **kwargs: None)
    monkeypatch.setattr(PackageService, "_build_auth_env", lambda repo, request_user=None: {})

    PackageService._checkout_source(task, workspace)

    doc_path = workspace / "source" / f"release-{task.version}.md"
    assert doc_path.read_text(encoding="utf-8") == table_newlines_to_br(release.release_doc)


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
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot={
            "image": "trace-ship/web-builder:node22",
            "script_entry": "/workspace/scripts/pack.sh",
            "build_path": ".",
            "output_path": "artifacts",
        },
    )
    workspace = tmp_path / "workspace"
    (workspace / "source").mkdir(parents=True)
    (workspace / "artifacts").mkdir(parents=True)

    monkeypatch.setattr(PackageService, "_run_command", lambda *args, **kwargs: None)

    PackageService._run_container(task, workspace)

    assert not (workspace / "source" / "artifacts").exists()


@pytest.mark.django_db
def test_container_package_uses_workspace_and_overrides_env(project, repository, user, tmp_path, monkeypatch):
    """容器打包使用 /workspace 挂载，系统环境变量覆盖用户自定义。"""
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
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot={
            "image": "trace-ship/web-builder:node22",
            "script_entry": "/workspace/scripts/pack.sh",
            "build_path": ".",
            "output_path": "custom-output",
            "env_vars": {"ARTIFACTS_DIR": "/custom/artifacts", "RELEASE_DOC_PATH": "/custom/doc.md"},
        },
    )
    workspace = tmp_path / "workspace"
    (workspace / "source").mkdir(parents=True)
    (workspace / "artifacts").mkdir(parents=True)
    captured = {}

    def capture_command(task, command, cwd, env=None, shell=False):
        captured["command"] = command

    monkeypatch.setattr(PackageService, "_run_command", capture_command)

    PackageService._run_container(task, workspace)

    command = captured["command"]
    assert "-e" in command
    assert "OUTPUT_PATH=custom-output" in command
    assert "ARTIFACTS_DIR=/workspace/artifacts" in command
    assert f"{workspace}/source:/workspace/source" in command
    assert f"{workspace}/artifacts:/workspace/artifacts" in command
    assert "--entrypoint" in command
    assert "ARTIFACTS_DIR=/custom/artifacts" in command
    assert command.index("ARTIFACTS_DIR=/workspace/artifacts") > command.index("ARTIFACTS_DIR=/custom/artifacts")
    assert "RELEASE_DOC_PATH=/workspace/source/release-VA.1.0.0.md" in command
    assert command.index("RELEASE_DOC_PATH=/workspace/source/release-VA.1.0.0.md") > command.index("RELEASE_DOC_PATH=/custom/doc.md")


def _make_container_task(project, repository, user, snapshot):
    """构造容器打包任务及已发布版本。"""
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
    return PackageTask.objects.create(
        release=release,
        project=project,
        repository=repository,
        name="打包任务",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot=snapshot,
    )


@pytest.mark.django_db
def test_container_custom_script_bypasses_pack_sh(project, repository, user, tmp_path, monkeypatch):
    """自定义脚本直接用镜像内 shell 执行，不依赖 pack.sh。"""
    task = _make_container_task(project, repository, user, {
        "image": "node:22",
        "custom_script": "echo build",
        "build_path": ".",
        "output_path": "dist",
    })
    workspace = tmp_path / "workspace"
    (workspace / "source").mkdir(parents=True)
    (workspace / "artifacts").mkdir(parents=True)
    captured = {}

    def capture_command(task, command, cwd, env=None, shell=False):
        captured["command"] = command

    monkeypatch.setattr(PackageService, "_run_command", capture_command)

    PackageService._run_container(task, workspace)

    command = captured["command"]
    assert command[-2:] == ["-c", "echo build"]
    assert "/workspace/scripts/pack.sh" not in command
    assert "--entrypoint" in command


@pytest.mark.django_db
def test_container_missing_pack_sh_hint(project, repository, user, tmp_path, monkeypatch):
    """内置入口缺失（退出码 127）时给出接入规范提示。"""
    task = _make_container_task(project, repository, user, {
        "image": "node:22",
        "build_path": ".",
        "output_path": "dist",
    })
    workspace = tmp_path / "workspace"
    (workspace / "source").mkdir(parents=True)
    (workspace / "artifacts").mkdir(parents=True)

    def fail_command(task, command, cwd, env=None, shell=False):
        raise RuntimeError("命令执行失败，退出码 127")

    monkeypatch.setattr(PackageService, "_run_command", fail_command)

    with pytest.raises(RuntimeError, match="不符合镜像接入规范"):
        PackageService._run_container(task, workspace)


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
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot={"custom_script": "exit 1"},
    )
    monkeypatch.setattr(PackageService, "_checkout_source", lambda task, workspace: None)

    PackageService.run_task(task)
    release.refresh_from_db()
    task.refresh_from_db()

    assert release.status == "released"
    assert task.status == "failure"


@pytest.mark.django_db
def test_cancel_running_task_keeps_canceled_status(project, repository, user, settings, tmp_path, monkeypatch):
    """运行中的任务被取消后，后续执行结果不应覆盖取消状态。"""
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.1",
        tag_name="VA.1.0.1",
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
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot={"custom_script": "echo test"},
    )
    monkeypatch.setattr(PackageService, "_checkout_source", lambda task, workspace: None)

    def fake_run_container(task, workspace):
        PackageService.cancel_task(task)

    monkeypatch.setattr(PackageService, "_run_container", fake_run_container)
    monkeypatch.setattr(PackageService, "_scan_artifacts", lambda workspace: [{"id": "artifact", "name": "a.zip", "path": "a.zip", "size": 1, "sha256": "x"}])

    PackageService.run_task(task)
    task.refresh_from_db()

    assert task.status == "canceled"
    assert task.progress == 0
    assert task.error_message == ""
    assert task.artifact_info == []


@pytest.mark.django_db
def test_run_command_terminates_process_group_when_task_canceled(project, repository, user, monkeypatch):
    """任务取消时应终止整个进程组，避免子进程继续执行。"""
    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.2",
        tag_name="VA.1.0.2",
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
        tag_name=release.tag_name,
        version=release.version,
        log_path="/tmp/package-build.log",
    )

    class FakeStdout:
        def fileno(self):
            return 0

        def readline(self):
            return ""

    class FakeProcess:
        pid = 4321
        stdout = FakeStdout()

        def poll(self):
            return None

        def wait(self, timeout=None):
            return 0

    fake_process = FakeProcess()
    popen_calls = {}
    signal_calls = []

    def fake_popen(*args, **kwargs):
        popen_calls.update(kwargs)
        return fake_process

    monkeypatch.setattr("apps.package.services.subprocess.Popen", fake_popen)
    monkeypatch.setattr("apps.package.services.select.select", lambda *args, **kwargs: ([], [], []))
    monkeypatch.setattr(PackageService, "_ensure_task_not_canceled", lambda task: (_ for _ in ()).throw(PackageTaskCanceledError("任务已被用户取消")))
    monkeypatch.setattr("apps.package.services.os.killpg", lambda pid, sig: signal_calls.append((pid, sig)))

    with pytest.raises(PackageTaskCanceledError):
        PackageService._run_command(task, ["echo", "test"], Path("."))

    assert popen_calls["start_new_session"] is True
    assert signal_calls == [(fake_process.pid, signal.SIGTERM)]


def test_sanitize_log_line_strips_ansi():
    """
    测试剥离 ANSI 颜色与光标控制序列

    期望：颜色码、光标移动序列被移除，纯文本保留
    """
    raw = "\x1b[32m✓\x1b[0m 编译成功 \x1b[1G\x1b[K"
    assert PackageService._sanitize_log_line(raw) == "✓ 编译成功 "


def test_sanitize_log_line_keeps_last_segment_after_cr():
    """
    测试 \\r 进度覆盖只保留最后一段

    期望：进度条中间帧被丢弃，保留最终文本
    """
    raw = "下载中 10%\r下载中 60%\r下载完成"
    assert PackageService._sanitize_log_line(raw) == "下载完成"


def test_sanitize_log_line_removes_control_chars():
    """
    测试剔除其他控制字符但保留制表符

    期望：\\x00-\\x08 等控制字符被移除，\\t 保留
    """
    raw = "col1\x00\tcol2\x07\x0b"
    assert PackageService._sanitize_log_line(raw) == "col1\tcol2"


def test_sanitize_log_line_plain_text_unchanged():
    """
    测试普通文本不受影响

    期望：中英文与常用符号原样保留
    """
    raw = "added 128 packages in 3s（含中文）"
    assert PackageService._sanitize_log_line(raw) == raw
