"""远程麒麟 Linux 打包节点相关测试。"""
from pathlib import PurePosixPath
from unittest.mock import MagicMock

import pytest

from apps.account.models import User
from apps.credential.models import Credential
from apps.package.models import PackageConfig, PackageNode, PackageTask
from apps.package.remote_base import RemoteNodeError, build_remote_client
from apps.package.remote_base import test_node_connection as dispatch_node_connection
from apps.package.remote_kylin import (
    RemoteKylinClient,
    build_export_lines,
    build_pack_run_script,
    sh_quote,
)
from apps.package.remote_windows import RemoteWindowsClient
from apps.package.serializers import PackageNodeSerializer
from apps.package.services import PackageService
from apps.package.services.cleanup import cleanup_remote_node_workspaces
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository


@pytest.fixture
def user():
    return User.objects.create_user(
        username="kylin_pkg_user",
        password="pass",
        nickname="麒麟打包用户",
    )


@pytest.fixture
def project(user):
    project = Project.objects.create(
        name="麒麟打包项目",
        code="KPKG",
        leader=user,
        status=1,
    )
    ProjectMember.objects.create(project=project, user=user, role="software_admin")
    return project


@pytest.fixture
def repository(project, user):
    git_cred = Credential.objects.create(
        name="GitLab 凭证",
        cred_type="gitlab_token",
        auth_mode="token",
        owner=user,
        is_active=True,
    )
    git_cred.set_data({"token": "git-token"})
    git_cred.save()
    from apps.project.services import ensure_repository_component

    repo = Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="kylin-app",
        url="https://gitlab.example.com",
        external_identity="group/kylin-app",
        default_branch="main",
        credential=git_cred,
        created_by=user,
    )
    ensure_repository_component(repo, project)
    return repo


@pytest.fixture
def ssh_credential(user):
    cred = Credential.objects.create(
        name="SSH 凭证",
        cred_type="ssh_password",
        auth_mode="password",
        owner=user,
        is_active=True,
    )
    cred.set_data({"username": "builder", "password": "secret"})
    cred.save()
    return cred


@pytest.fixture
def kylin_node(ssh_credential):
    return PackageNode.objects.create(
        name="麒麟节点 A",
        host="192.168.1.200",
        port=22,
        os_type="kylin",
        credential=ssh_credential,
        work_root="/data/trace-ship/workspaces",
    )


@pytest.fixture
def release(project, repository, user):
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        publisher=user,
    )


@pytest.mark.django_db
class TestKylinNodeSerializer:
    """麒麟节点的凭证类型与 work_root 路径风格校验。"""

    def test_kylin_requires_ssh_password(self, user, ssh_credential):
        serializer = PackageNodeSerializer(data={
            "name": "麒麟节点", "host": "10.0.0.1", "port": 22, "os_type": "kylin",
            "credential": str(ssh_credential.id),
            "work_root": "/data/trace-ship/workspaces",
        })
        assert serializer.is_valid(), serializer.errors

    def test_kylin_rejects_windows_password(self, user):
        win_cred = Credential.objects.create(
            name="Windows 凭证", cred_type="windows_password", auth_mode="password", owner=user,
        )
        serializer = PackageNodeSerializer(data={
            "name": "麒麟节点", "host": "10.0.0.1", "port": 22, "os_type": "kylin",
            "credential": str(win_cred.id),
            "work_root": "/data/trace-ship/workspaces",
        })
        assert not serializer.is_valid()
        assert "credential" in serializer.errors

    def test_windows_rejects_ssh_password(self, user, ssh_credential):
        serializer = PackageNodeSerializer(data={
            "name": "Windows 节点", "host": "10.0.0.1", "port": 22, "os_type": "windows",
            "credential": str(ssh_credential.id),
            "work_root": r"C:\trace-ship\workspaces",
        })
        assert not serializer.is_valid()
        assert "credential" in serializer.errors

    def test_kylin_work_root_must_be_posix_absolute(self, user, ssh_credential):
        base = {
            "name": "麒麟节点", "host": "10.0.0.1", "port": 22, "os_type": "kylin",
            "credential": str(ssh_credential.id),
        }
        for bad_root in (r"C:\trace-ship\workspaces", "data/workspaces", "relative/path", "/"):
            serializer = PackageNodeSerializer(data={**base, "work_root": bad_root})
            assert not serializer.is_valid(), bad_root
            assert "work_root" in serializer.errors

    def test_windows_work_root_rejects_drive_root(self, user):
        win_cred = Credential.objects.create(
            name="Windows 凭证", cred_type="windows_password", auth_mode="password",
            owner=user,
        )
        for bad_root in ("C:\\", "C:/"):
            serializer = PackageNodeSerializer(data={
                "name": "Windows 节点", "host": "10.0.0.1", "port": 22, "os_type": "windows",
                "credential": str(win_cred.id),
                "work_root": bad_root,
            })
            assert not serializer.is_valid(), bad_root
            assert "work_root" in serializer.errors

    def test_windows_work_root_must_be_drive_path(self, user):
        win_cred = Credential.objects.create(
            name="Windows 凭证", cred_type="windows_password", auth_mode="password",
            owner=user,
        )
        serializer = PackageNodeSerializer(data={
            "name": "Windows 节点", "host": "10.0.0.1", "port": 22, "os_type": "windows",
            "credential": str(win_cred.id),
            "work_root": "/data/trace-ship/workspaces",
        })
        assert not serializer.is_valid()
        assert "work_root" in serializer.errors


class TestKylinShHelpers:
    """sh 辅助函数与资源限制包装脚本。"""

    def test_sh_quote(self):
        assert sh_quote("plain") == "plain"
        assert sh_quote("a b") == "'a b'"
        assert sh_quote("it's") == "'it'\"'\"'s'"

    def test_build_export_lines(self):
        lines = build_export_lines({"VERSION": "1.0.0", "TAG_NAME": "v 1"})
        assert "export VERSION=1.0.0" in lines
        assert "export TAG_NAME='v 1'" in lines

    def test_build_export_lines_rejects_bad_key(self):
        with pytest.raises(RemoteNodeError):
            build_export_lines({"BAD-KEY": "x"})

    def test_pack_run_script_no_limit(self):
        content = build_pack_run_script(
            PurePosixPath("/data/ws/source"), {"VERSION": "1.0.0"},
            PurePosixPath("/data/ws/source/pack.sh"),
        )
        assert "cd /data/ws/source || exit 1" in content
        assert "export VERSION=1.0.0" in content
        assert content.splitlines()[-1] == "sh -e /data/ws/source/pack.sh"
        assert "ulimit" not in content
        assert "taskset" not in content
        assert "nice" not in content

    def test_pack_run_script_with_limits(self):
        content = build_pack_run_script(
            PurePosixPath("/data/ws/source"), {},
            PurePosixPath("/data/ws/tmp/pack-custom.sh"),
            cores=4, priority="belownormal", mem_mb=4096,
        )
        assert "ulimit -v 4194304" in content  # 4096MB → KB
        last = content.splitlines()[-1]
        assert last == "taskset -c 0-3 nice -n 10 sh -e /data/ws/tmp/pack-custom.sh"

    def test_pack_run_script_low_priority(self):
        content = build_pack_run_script(
            PurePosixPath("/data/ws/source"), {},
            PurePosixPath("/data/ws/source/pack.sh"),
            priority="low",
        )
        assert "nice -n 19 sh -e" in content


@pytest.mark.django_db
class TestKylinSnapshot:
    def test_snapshot_contains_node_os_type(self, project, repository, kylin_node):
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="麒麟远程打包",
            executor_type="remote_node",
            node=kylin_node,
        )
        snapshot = PackageService._snapshot(config)
        assert snapshot["executor_type"] == "remote_node"
        assert snapshot["node_os_type"] == "kylin"
        assert snapshot["node_arch"] == kylin_node.arch
        assert snapshot["node_work_root"] == "/data/trace-ship/workspaces"

    def test_build_remote_client_dispatch(self, kylin_node):
        kylin_client = build_remote_client({"node_os_type": "kylin", "node_host": "h", "node_credential_id": str(kylin_node.credential_id)})
        assert isinstance(kylin_client, RemoteKylinClient)
        windows_client = build_remote_client({"node_host": "h", "node_credential_id": str(kylin_node.credential_id)})
        assert isinstance(windows_client, RemoteWindowsClient)


@pytest.mark.django_db
class TestKylinConcurrencyGate:
    """麒麟节点（executor_type=remote_node）同样受并发闸门约束。"""

    def _make_task(self, project, repository, kylin_node, release, user, status="queued"):
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="麒麟远程打包",
            executor_type="remote_node",
            node=kylin_node,
        )
        return PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            triggered_by=user, name="麒麟远程打包 / VA.1.0.0", tag_name=release.tag_name,
            version=release.version, config_snapshot=PackageService._snapshot(config),
            status=status,
        )

    def test_slot_full_when_running(self, project, repository, kylin_node, release, user):
        self._make_task(project, repository, kylin_node, release, user, status="running")
        waiting = self._make_task(project, repository, kylin_node, release, user)
        available, running, max_concurrency = PackageService.node_slot_available(waiting)
        assert available is False
        assert running == 1
        assert max_concurrency == 1


@pytest.mark.django_db
class TestKylinRemoteBuild:
    """麒麟节点构建：pack-run.sh 注入环境变量与资源限制。"""

    def _make_task(self, project, repository, kylin_node, release, user, custom="echo hi", **cfg):
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="麒麟远程打包",
            executor_type="remote_node",
            node=kylin_node,
            custom_script=custom,
            **cfg,
        )
        return PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            triggered_by=user, name="麒麟远程打包", tag_name=release.tag_name,
            version=release.version, config_snapshot=PackageService._snapshot(config),
        )

    def test_custom_script_uses_sh(self, project, repository, kylin_node, release, user):
        task = self._make_task(project, repository, kylin_node, release, user)
        client = MagicMock()
        PackageService._run_remote_build(task, client)
        command = client.run_checked.call_args.args[0]
        assert command.startswith("sh -e ")
        assert "pack-run.sh" in command
        uploads = {str(call.args[0]): call.args[1] for call in client.upload_text.call_args_list}
        custom_script = next(c for p, c in uploads.items() if p.endswith("pack-custom.sh"))
        run_script = next(c for p, c in uploads.items() if p.endswith("pack-run.sh"))
        assert custom_script == "echo hi"
        assert "pack-custom.sh" in run_script
        assert "export VERSION=" in run_script
        assert "\r" not in run_script

    def test_default_pack_sh_entry(self, project, repository, kylin_node, release, user):
        task = self._make_task(project, repository, kylin_node, release, user, custom="")
        client = MagicMock()
        PackageService._run_remote_build(task, client)
        _, content = client.upload_text.call_args.args
        assert "sh -e " in content and "source/pack.sh" in content

    def test_resource_limits_in_run_script(self, project, repository, kylin_node, release, user):
        kylin_node.cpu_cores = 2
        kylin_node.cpu_priority = "low"
        kylin_node.save(update_fields=["cpu_cores", "cpu_priority"])
        task = self._make_task(project, repository, kylin_node, release, user, mem_limit_mb=2048)
        client = MagicMock()
        PackageService._run_remote_build(task, client)
        uploads = {str(call.args[0]): call.args[1] for call in client.upload_text.call_args_list}
        run_script = next(c for p, c in uploads.items() if p.endswith("pack-run.sh"))
        assert "ulimit -v 2097152" in run_script
        assert "taskset -c 0-1 nice -n 19 sh -e" in run_script

    def test_remote_workspace_posix(self, project, repository, kylin_node, release, user):
        task = self._make_task(project, repository, kylin_node, release, user)
        workspace = PackageService._remote_workspace(task)
        assert workspace == PurePosixPath("/data/trace-ship/workspaces") / str(task.id)


@pytest.mark.django_db
class TestKylinRemotePipeline:
    """麒麟远程流水线主流程：clone → build → 收集产物。"""

    def _make_task(self, project, repository, kylin_node, release, user):
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="麒麟远程打包",
            executor_type="remote_node",
            node=kylin_node,
            custom_script="echo building $VERSION",
        )
        return PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            triggered_by=user, name="麒麟远程打包 / VA.1.0.0", tag_name=release.tag_name,
            version=release.version, commit_hash=release.git_hash,
            config_snapshot=PackageService._snapshot(config),
        )

    def _mock_client(self, monkeypatch, artifacts: dict[str, bytes] | None = None):
        client = MagicMock()
        client.run_checked.return_value = None
        client.upload_text.return_value = None

        def download_dir(remote_dir, local_dir, should_stop=None):
            for name, content in (artifacts or {}).items():
                target = local_dir / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            return len(artifacts or {})

        client.download_dir.side_effect = download_dir
        monkeypatch.setattr(
            "apps.package.remote_kylin.RemoteKylinClient.from_snapshot",
            classmethod(lambda cls, snapshot: client),
        )
        return client

    def test_kylin_pipeline_success(self, project, repository, kylin_node, release, user, monkeypatch, tmp_path):
        monkeypatch.setattr(PackageService, "workspace_root", staticmethod(lambda: tmp_path))
        client = self._mock_client(monkeypatch, artifacts={"app.tar.gz": b"gz-content"})
        task = self._make_task(project, repository, kylin_node, release, user)

        PackageService.run_task(task)
        task.refresh_from_db()

        assert task.status == "success"
        assert task.progress == 100
        assert len(task.artifact_info) == 1
        assert task.artifact_info[0]["name"] == "app.tar.gz"
        assert list(tmp_path.rglob("app.tar.gz")), "产物未回传到本地工作区"
        # 克隆与构建命令均为 sh 语义
        commands = [call.args[0] for call in client.run_checked.call_args_list]
        assert any("git" in cmd and "clone --depth 1" in cmd for cmd in commands)
        assert any(cmd.startswith("sh -e ") and "pack-run.sh" in cmd for cmd in commands)
        # 远程工作目录为 POSIX 路径
        mkdir_args = [str(p) for call in client.mkdirs.call_args_list for p in call.args]
        assert any(p.startswith("/data/trace-ship/workspaces/") for p in mkdir_args)
        # 默认清理远程工作目录
        removed = [call.args[0] for call in client.remove_dir.call_args_list]
        assert PackageService._remote_workspace(task) in removed

    def test_kylin_revoke_git_credential_uses_unset_all(self, project, repository, kylin_node, release, user):
        task = self._make_task(project, repository, kylin_node, release, user)
        snapshot = task.config_snapshot
        snapshot["inject_git_credential"] = True
        task.config_snapshot = snapshot
        client = MagicMock()

        PackageService._revoke_remote_git_credential(task, client)

        commands = [call.args[0] for call in client.run.call_args_list]
        assert any("git" in cmd and "config --unset-all http.extraHeader" in cmd for cmd in commands)


@pytest.mark.django_db
class TestKylinCollectOutput:
    """麒麟节点产物归集：cp -r 拷贝 / tar -czf 压缩。"""

    def _make_task(self, project, repository, release, user, snapshot):
        return PackageTask.objects.create(
            release=release, project=project, repository=repository,
            triggered_by=user, name="打包", tag_name=release.tag_name,
            version=release.version, config_snapshot=snapshot,
        )

    def _snapshot(self, **overrides):
        base = {
            "node_os_type": "kylin",
            "node_work_root": "/data/trace-ship/workspaces",
            "build_path": "app",
            "output_path": "dist",
            "auto_collect_output": True,
        }
        base.update(overrides)
        return base

    def test_kylin_collect_uses_cp(self, project, repository, release, user):
        task = self._make_task(project, repository, release, user, self._snapshot())
        client = MagicMock()
        PackageService._collect_output_remote(task, client)
        command = client.run_checked.call_args.args[0]
        assert "cp -r" in command
        assert "app/dist" in command
        assert "artifacts" in command
        assert "robocopy" not in command

    def test_kylin_auto_compress_uses_tar_gz(self, project, repository, release, user):
        config = PackageConfig.objects.create(
            project=project, repository=repository, name="麒麟打包",
        )
        task = self._make_task(
            project, repository, release, user, self._snapshot(auto_compress=True),
        )
        task.config = config
        task.save(update_fields=["config"])
        client = MagicMock()
        PackageService._collect_output_remote(task, client)
        command = client.run_checked.call_args.args[0]
        assert "tar -czf" in command
        assert ".tar.gz" in command
        assert f"{config.name}-{release.version}-" in command
        assert " -C " in command


class FakeKylinClient:
    """模拟麒麟客户端：预置目录清单，记录删除调用与命令。"""

    dir_entries: list[str] = []
    removed: list[str] = []
    commands: list[str] = []

    def __init__(self, host, port, username, password, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def run(self, command, on_line=None, **kwargs):
        type(self).commands.append(command)
        if on_line and "find " in command:
            for name in type(self).dir_entries:
                on_line(name)
        return 0

    def remove_dir(self, path):
        type(self).removed.append(str(path))


@pytest.mark.django_db
class TestKylinCleanup:
    """每日清理的麒麟分支：find 列目录 + rm -rf 删除，危险 work_root 拒绝。"""

    def test_kylin_cleanup_uses_find(self, project, repository, kylin_node, monkeypatch):
        running_task = PackageTask.objects.create(
            project=project, repository=repository, name="运行中任务",
            tag_name="VA.1.0.0", version="VA.1.0.0", status="running",
            config_snapshot={"node_id": str(kylin_node.id)},
        )
        FakeKylinClient.dir_entries = [str(running_task.id), "stale-task-id"]
        FakeKylinClient.removed = []
        FakeKylinClient.commands = []
        monkeypatch.setattr("apps.package.services.cleanup.RemoteKylinClient", FakeKylinClient)

        result = cleanup_remote_node_workspaces()

        assert result["errors"] == []
        assert any("find /data/trace-ship/workspaces -mindepth 1 -maxdepth 1 -type d" in cmd for cmd in FakeKylinClient.commands)
        assert FakeKylinClient.removed == ["/data/trace-ship/workspaces/stale-task-id"]
        node_result = result["nodes"][0]
        assert node_result["removed"] == ["stale-task-id"]
        assert node_result["skipped"] == [str(running_task.id)]

    def test_kylin_dangerous_work_root_rejected(self, kylin_node, monkeypatch):
        """麒麟节点工作目录误配置为 / 时拒绝清理，防止删整盘。"""
        kylin_node.work_root = "/"
        kylin_node.save(update_fields=["work_root", "updated_at"])
        client_calls = []
        monkeypatch.setattr(
            "apps.package.services.cleanup.RemoteKylinClient",
            lambda *args, **kwargs: client_calls.append(1) or FakeKylinClient(),
        )

        result = cleanup_remote_node_workspaces()

        assert result["nodes"] == []
        assert len(result["errors"]) == 1
        assert "拒绝清理" in result["errors"][0]
        assert client_calls == []


@pytest.mark.django_db
class TestNodeConnectionDispatch:
    """test_node_connection 入口按 os_type 分发。"""

    def test_dispatch_kylin(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            "apps.package.remote_kylin.test_kylin_node_connection",
            lambda host, port, credential_id, work_root="": calls.append("kylin") or {"ok": True},
        )
        result = dispatch_node_connection("h", 22, "cred-id", os_type="kylin")
        assert result == {"ok": True}
        assert calls == ["kylin"]

    def test_dispatch_windows_default(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            "apps.package.remote_windows.test_windows_node_connection",
            lambda host, port, credential_id, work_root="": calls.append("windows") or {"ok": True},
        )
        result = dispatch_node_connection("h", 22, "cred-id")
        assert result == {"ok": True}
        assert calls == ["windows"]
