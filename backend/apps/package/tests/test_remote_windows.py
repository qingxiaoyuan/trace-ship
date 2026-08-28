"""远程 Windows 打包节点相关测试。"""
import base64
from pathlib import PureWindowsPath
from unittest.mock import MagicMock

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.credential.models import Credential
from apps.package.models import PackageConfig, PackageImage, PackageNode, PackageTask
from apps.package.remote_windows import RemoteNodeError, build_set_env_prefix, decode_remote_line
from apps.package.serializers import PackageConfigSerializer, PackageNodeSerializer
from apps.package.services import PackageService
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository
from utils.markdown_table import table_newlines_to_br


@pytest.fixture
def user():
    return User.objects.create_user(
        username="remote_pkg_user",
        password="pass",
        nickname="远程打包用户",
    )


@pytest.fixture
def api_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(user):
    project = Project.objects.create(
        name="远程打包项目",
        code="RPKG",
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
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="win-app",
        url="https://gitlab.example.com",
        external_identity="group/win-app",
        default_branch="main",
        credential=git_cred,
    )


@pytest.fixture
def windows_credential(user):
    cred = Credential.objects.create(
        name="Windows 凭证",
        cred_type="windows_password",
        auth_mode="password",
        owner=user,
        is_active=True,
    )
    cred.set_data({"username": "builder", "password": "secret"})
    cred.save()
    return cred


@pytest.fixture
def node(windows_credential):
    return PackageNode.objects.create(
        name="Windows 节点 A",
        host="192.168.1.100",
        port=22,
        credential=windows_credential,
        work_root=r"C:\trace-ship\workspaces",
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


def _fake_request(user):
    request = MagicMock()
    request.user = user
    return request


@pytest.mark.django_db
class TestPackageNodeSerializer:
    def test_credential_must_be_windows_password(self, user):
        svn_cred = Credential.objects.create(
            name="SVN 凭证", cred_type="svn_password", auth_mode="password", owner=user,
        )
        serializer = PackageNodeSerializer(data={
            "name": "节点", "host": "10.0.0.1", "port": 22, "credential": str(svn_cred.id),
        })
        assert not serializer.is_valid()
        assert "credential" in serializer.errors

    def test_valid_node(self, windows_credential):
        serializer = PackageNodeSerializer(data={
            "name": "节点", "host": "10.0.0.1", "port": 22,
            "credential": str(windows_credential.id),
        })
        assert serializer.is_valid(), serializer.errors

    def test_invalid_port(self, windows_credential):
        serializer = PackageNodeSerializer(data={
            "name": "节点", "host": "10.0.0.1", "port": 70000,
            "credential": str(windows_credential.id),
        })
        assert not serializer.is_valid()
        assert "port" in serializer.errors


@pytest.mark.django_db
class TestPackageConfigRemoteValidation:
    def test_remote_windows_requires_node(self, project, repository, user):
        serializer = PackageConfigSerializer(
            data={
                "project": str(project.id),
                "repository": str(repository.id),
                "name": "远程打包",
                "executor_type": "remote_node",
            },
            context={"request": _fake_request(user)},
        )
        assert not serializer.is_valid()
        assert "node" in serializer.errors

    def test_remote_windows_allows_empty_image(self, project, repository, node, user):
        serializer = PackageConfigSerializer(
            data={
                "project": str(project.id),
                "repository": str(repository.id),
                "name": "远程打包",
                "executor_type": "remote_node",
                "node": str(node.id),
            },
            context={"request": _fake_request(user)},
        )
        assert serializer.is_valid(), serializer.errors

    def test_local_docker_rejects_node(self, project, repository, node, user):
        image = PackageImage.objects.create(name="Web 镜像", image="trace-ship/web:latest")
        serializer = PackageConfigSerializer(
            data={
                "project": str(project.id),
                "repository": str(repository.id),
                "name": "本地打包",
                "executor_type": "local_docker",
                "node": str(node.id),
                "image": str(image.id),
            },
            context={"request": _fake_request(user)},
        )
        assert not serializer.is_valid()
        assert "node" in serializer.errors

    def test_local_docker_requires_image(self, project, repository, user):
        serializer = PackageConfigSerializer(
            data={
                "project": str(project.id),
                "repository": str(repository.id),
                "name": "本地打包",
                "executor_type": "local_docker",
            },
            context={"request": _fake_request(user)},
        )
        assert not serializer.is_valid()
        assert "image" in serializer.errors


@pytest.mark.django_db
class TestSnapshot:
    def test_snapshot_contains_executor_and_node(self, project, repository, node):
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="远程打包",
            executor_type="remote_node",
            node=node,
        )
        snapshot = PackageService._snapshot(config)
        assert snapshot["executor_type"] == "remote_node"
        assert snapshot["node_host"] == "192.168.1.100"
        assert snapshot["node_port"] == 22
        assert snapshot["node_work_root"] == r"C:\trace-ship\workspaces"
        assert snapshot["node_credential_id"] == str(node.credential_id)
        # 快照不落凭证明文
        assert "secret" not in str(snapshot)

    def test_snapshot_default_executor(self, project, repository):
        image = PackageImage.objects.create(name="Web 镜像", image="trace-ship/web:latest")
        config = PackageConfig.objects.create(
            project=project, repository=repository, name="本地打包", image=image,
        )
        snapshot = PackageService._snapshot(config)
        assert snapshot["executor_type"] == "local_docker"
        assert snapshot["node_id"] is None
        # 自动压缩默认关闭
        assert snapshot["auto_compress"] is False

    def test_snapshot_auto_compress(self, project, repository):
        """开启自动压缩后进入任务快照"""
        image = PackageImage.objects.create(name="Web 镜像", image="trace-ship/web:latest")
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="本地打包",
            image=image,
            auto_collect_output=True,
            auto_compress=True,
        )
        snapshot = PackageService._snapshot(config)
        assert snapshot["auto_collect_output"] is True
        assert snapshot["auto_compress"] is True


@pytest.mark.django_db
class TestCpuLimitBuild:
    """节点 CPU 资源限制：start /wait 包装构建命令。"""

    def _make_task(self, project, repository, node, release, user, cores=0, priority="normal", custom="echo hi"):
        node.cpu_cores = cores
        node.cpu_priority = priority
        node.save(update_fields=["cpu_cores", "cpu_priority"])
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="远程打包",
            executor_type="remote_node",
            node=node,
            custom_script=custom,
        )
        return PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            triggered_by=user, name="远程打包", tag_name=release.tag_name,
            version=release.version, config_snapshot=PackageService._snapshot(config),
        )

    def test_snapshot_contains_cpu_fields(self, project, repository, node, release, user):
        task = self._make_task(project, repository, node, release, user, cores=4, priority="low")
        snapshot = task.config_snapshot
        assert snapshot["cpu_cores"] == 4
        assert snapshot["cpu_priority"] == "low"

    def test_affinity_mask(self):
        assert PackageService._affinity_mask(1) == "1"
        assert PackageService._affinity_mask(4) == "F"
        assert PackageService._affinity_mask(8) == "FF"

    def _run_build(self, task):
        client = MagicMock()
        PackageService._run_remote_build(task, client)
        return client

    def test_no_limit_uses_run_script(self, project, repository, node, release, user):
        """不配置限制时也经 pack-run.bat 统一注入环境变量与透传退出码。"""
        task = self._make_task(project, repository, node, release, user, cores=0, priority="normal")
        client = self._run_build(task)
        command = client.run_checked.call_args.args[0]
        assert command.startswith("call ")
        assert "pack-run.bat" in command
        assert "start " not in command
        uploads = {str(call.args[0]): call.args[1] for call in client.upload_text.call_args_list}
        custom_script = next(content for path, content in uploads.items() if path.endswith("pack-custom.bat"))
        run_script = next(content for path, content in uploads.items() if path.endswith("pack-run.bat"))
        assert custom_script == "echo hi"
        assert "pack-custom.bat" in run_script
        assert "echo hi" not in run_script

    def test_priority_only_wraps_start(self, project, repository, node, release, user):
        """仅优先级限制：start /wait /优先级，无 /affinity。"""
        task = self._make_task(project, repository, node, release, user, cores=0, priority="belownormal")
        client = self._run_build(task)
        command = client.run_checked.call_args.args[0]
        assert command.startswith('start "" /b /wait /belownormal cmd /c')
        assert "/affinity" not in command
        assert "pack-run.bat" in command

    def test_cores_only_wraps_affinity(self, project, repository, node, release, user):
        """仅核数限制：带 /affinity 掩码，不加优先级。"""
        task = self._make_task(project, repository, node, release, user, cores=4, priority="normal")
        client = self._run_build(task)
        command = client.run_checked.call_args.args[0]
        assert '/affinity F' in command
        assert "/belownormal" not in command and "/low" not in command

    def test_full_limit_run_script_content(self, project, repository, node, release, user):
        """限制路径上传的 pack-run.bat 包含目录切换、环境变量与退出码透传。"""
        task = self._make_task(project, repository, node, release, user, cores=2, priority="low", custom="echo build %VERSION%")
        client = self._run_build(task)
        uploads = {str(call.args[0]): call.args[1] for call in client.upload_text.call_args_list}
        path, content = next((path, content) for path, content in uploads.items() if path.endswith("pack-run.bat"))
        assert str(path).endswith("pack-run.bat")
        assert 'set "VERSION=' in content
        assert f'set "RELEASE_DOC_PATH=C:\\trace-ship\\workspaces\\{task.id}\\source\\release-{task.version}.md"' in content
        assert "@echo on" in content
        assert "pack-custom.bat" in content
        assert content.splitlines()[-2:] == ['@set "TRACE_SHIP_EXIT_CODE=%errorlevel%"', "@exit /b %TRACE_SHIP_EXIT_CODE%"]
        command = client.run_checked.call_args.args[0]
        assert command.startswith('start "" /b /wait /low /affinity 3 cmd /c')

    def test_default_pack_bat_in_run_script(self, project, repository, node, release, user):
        """未配置自定义脚本时，pack-run.bat 调源码根目录 pack.bat。"""
        task = self._make_task(project, repository, node, release, user, cores=2, priority="low", custom="")
        client = self._run_build(task)
        _, content = client.upload_text.call_args.args
        assert 'call "' in content and "pack.bat" in content


@pytest.mark.django_db
class TestConfigLevelResourceLimits:
    """配置级资源限制：覆盖节点默认，内存走作业对象脚本。"""

    def _make_task(self, project, repository, node, release, user, **cfg):
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="远程打包",
            executor_type="remote_node",
            node=node,
            custom_script="echo hi",
            **cfg,
        )
        return PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            triggered_by=user, name="远程打包", tag_name=release.tag_name,
            version=release.version, config_snapshot=PackageService._snapshot(config),
        )

    def test_config_overrides_node(self, project, repository, node, release, user):
        """配置级核数/优先级覆盖节点默认。"""
        node.cpu_cores = 2
        node.cpu_priority = "low"
        node.save(update_fields=["cpu_cores", "cpu_priority"])
        task = self._make_task(project, repository, node, release, user, cpu_cores=6, cpu_priority="belownormal")
        snapshot = task.config_snapshot
        assert snapshot["cpu_cores"] == 6
        assert snapshot["cpu_priority"] == "belownormal"

    def test_config_blank_falls_back_to_node(self, project, repository, node, release, user):
        """配置未设置（0/空串）时跟随节点。"""
        node.cpu_cores = 3
        node.cpu_priority = "low"
        node.save(update_fields=["cpu_cores", "cpu_priority"])
        task = self._make_task(project, repository, node, release, user)
        snapshot = task.config_snapshot
        assert snapshot["cpu_cores"] == 3
        assert snapshot["cpu_priority"] == "low"

    def test_mem_limit_uses_powershell_wrapper(self, project, repository, node, release, user):
        """内存上限 > 0 时上传 run-limited.ps1 并用 powershell 执行。"""
        task = self._make_task(project, repository, node, release, user, mem_limit_mb=4096)
        client = MagicMock()
        PackageService._run_remote_build(task, client)
        uploaded = [call.args[0] for call in client.upload_text.call_args_list]
        assert any(str(p).endswith("run-limited.ps1") for p in uploaded)
        command = client.run_checked.call_args.args[0]
        assert command.startswith("powershell -NoProfile -ExecutionPolicy Bypass -File")
        assert "-MemMB 4096" in command
        assert "pack-run.bat" in command

    def test_mem_zero_uses_start_wrapper(self, project, repository, node, release, user):
        """内存上限为 0 时仍用 start /wait 包装，不上传 ps1。"""
        task = self._make_task(project, repository, node, release, user, cpu_cores=2)
        client = MagicMock()
        PackageService._run_remote_build(task, client)
        uploaded = [call.args[0] for call in client.upload_text.call_args_list]
        assert not any(str(p).endswith("run-limited.ps1") for p in uploaded)
        command = client.run_checked.call_args.args[0]
        assert command.startswith('start "" /b /wait')

    def test_old_snapshot_node_keys_fallback(self):
        """旧快照的 node_cpu_* 键仍可读取。"""
        cores, priority, mem = PackageService._resource_limits({
            "node_cpu_cores": 5, "node_cpu_priority": "low",
        })
        assert (cores, priority, mem) == (5, "low", 0)

    def test_empty_snapshot_defaults(self):
        cores, priority, mem = PackageService._resource_limits({})
        assert (cores, priority, mem) == (0, "normal", 0)

    def test_serializer_rejects_invalid_limits(self, project, repository, node, user):
        """配置级资源字段范围校验。"""
        request = MagicMock()
        request.user = user
        base = {
            "project": str(project.id),
            "repository": str(repository.id),
            "name": "限制校验",
            "executor_type": "remote_node",
            "node": str(node.id),
        }
        serializer = PackageConfigSerializer(
            data={**base, "cpu_cores": 100}, context={"request": request},
        )
        assert not serializer.is_valid()
        assert "cpu_cores" in serializer.errors
        serializer = PackageConfigSerializer(
            data={**base, "mem_limit_mb": -1}, context={"request": request},
        )
        assert not serializer.is_valid()
        assert "mem_limit_mb" in serializer.errors


@pytest.mark.django_db
class TestAutoCollectOutput:
    """自动收集产物目录到 artifacts。"""

    def _snapshot(self, **overrides):
        base = {
            "build_path": ".",
            "output_path": "dist",
            "auto_collect_output": True,
        }
        base.update(overrides)
        return base

    def _make_task(self, project, repository, release, user, snapshot):
        return PackageTask.objects.create(
            release=release, project=project, repository=repository,
            triggered_by=user, name="打包", tag_name=release.tag_name,
            version=release.version, config_snapshot=snapshot,
        )

    def test_output_dir_rel(self):
        svc = PackageService
        assert svc._output_dir_rel({"build_path": ".", "output_path": "dist"}) == "dist"
        assert svc._output_dir_rel({"build_path": "apps/web", "output_path": "dist"}) == "apps/web/dist"

    def test_local_collect_copies_files(self, project, repository, release, user, tmp_path):
        task = self._make_task(project, repository, release, user, self._snapshot())
        workspace = tmp_path / "ws"
        src = workspace / "source" / "dist" / "assets"
        src.mkdir(parents=True)
        (workspace / "source" / "dist" / "app.js").write_text("a")
        (src / "style.css").write_text("b")
        (workspace / "artifacts").mkdir(parents=True)

        PackageService._collect_output_local(task, workspace)

        assert (workspace / "artifacts" / "app.js").exists()
        assert (workspace / "artifacts" / "assets" / "style.css").exists()

    def test_local_collect_missing_dir_skips(self, project, repository, release, user, tmp_path):
        task = self._make_task(project, repository, release, user, self._snapshot())
        workspace = tmp_path / "ws"
        (workspace / "source").mkdir(parents=True)
        (workspace / "artifacts").mkdir(parents=True)
        # 不抛异常即通过
        PackageService._collect_output_local(task, workspace)
        assert list((workspace / "artifacts").iterdir()) == []

    def test_remote_collect_command(self, project, repository, release, user):
        task = self._make_task(project, repository, release, user, self._snapshot(build_path="app", output_path="dist"))
        client = MagicMock()
        PackageService._collect_output_remote(task, client)
        command = client.run_checked.call_args.args[0]
        assert "robocopy" in command
        assert "/e" in command
        assert "/r:1" in command
        assert "/w:1" in command
        assert "app\\dist" in command
        assert "artifacts" in command
        # robocopy 成功也返回非零，必须 exit /b 0 归零
        assert "exit /b 0" in command
        assert "errorlevel 8" in command

    def test_local_auto_compress(self, project, repository, release, user, tmp_path):
        """自动压缩：产物目录内所有内容（含子目录与非压缩文件）归入单个 zip"""
        import zipfile

        from django.utils import timezone

        config = PackageConfig.objects.create(
            project=project, repository=repository, name="Web前端打包",
        )
        task = self._make_task(
            project, repository, release, user, self._snapshot(auto_compress=True)
        )
        task.config = config
        task.save(update_fields=["config"])
        workspace = tmp_path / "ws"
        dist = workspace / "source" / "dist"
        (dist / "assets").mkdir(parents=True)
        (dist / "app.js").write_text("a")
        (dist / "assets" / "style.css").write_text("b")
        (workspace / "artifacts").mkdir(parents=True)

        PackageService._collect_output_local(task, workspace)

        artifacts = workspace / "artifacts"
        files = list(artifacts.iterdir())
        # 最终产物只有一个压缩包
        assert len(files) == 1
        archive = files[0]
        expected = f"{config.name}-{release.version}-{timezone.localdate().strftime('%Y%m%d')}.zip"
        assert archive.name == expected
        with zipfile.ZipFile(archive) as zf:
            names = set(zf.namelist())
        # 产物目录内所有内容（含子目录）都在压缩包内
        assert "app.js" in names
        assert "assets/style.css" in names

    def test_remote_auto_compress_command(self, project, repository, release, user):
        """自动压缩：远程用 tar 把产物目录压缩为单个 zip，不使用 robocopy"""
        config = PackageConfig.objects.create(
            project=project, repository=repository, name="Web前端打包",
        )
        task = self._make_task(
            project,
            repository,
            release,
            user,
            self._snapshot(build_path="app", output_path="dist", auto_compress=True),
        )
        task.config = config
        task.save(update_fields=["config"])
        client = MagicMock()
        PackageService._collect_output_remote(task, client)
        command = client.run_checked.call_args.args[0]
        assert "tar -a -c -f" in command
        assert " -C " in command
        assert "app\\dist" in command
        assert f"{config.name}-{release.version}-" in command
        assert "robocopy" not in command
        assert "exit /b 0" in command


class TestConnectRetry:
    """建连重试：握手阶段瞬时失败（并发场景常见）重试，认证失败不重试。"""

    def _fake_paramiko(self, monkeypatch, connect_side_effect):
        import apps.package.remote_base as rb
        import apps.package.remote_windows as rw

        class FakeSSHException(Exception):
            pass

        class FakeAuthException(Exception):
            pass

        calls = []

        class FakeClient:
            def set_missing_host_key_policy(self, policy):
                pass

            def connect(self, **kwargs):
                calls.append(1)
                connect_side_effect(len(calls), FakeSSHException, FakeAuthException)

            def close(self):
                pass

        fake = MagicMock()
        fake.SSHClient.side_effect = lambda: FakeClient()
        fake.SSHException = FakeSSHException
        fake.AuthenticationException = FakeAuthException
        monkeypatch.setattr(rb, "_import_paramiko", lambda: fake)
        monkeypatch.setattr(rb.time, "sleep", lambda _s: None)
        return rw, calls

    def test_retry_on_transient_handshake_error(self, monkeypatch):
        def side_effect(attempt, ssh_exc, _auth_exc):
            if attempt < 2:
                raise ssh_exc("No existing session")

        rw, calls = self._fake_paramiko(monkeypatch, side_effect)
        client = rw.RemoteWindowsClient("h", 22, "u", "p")
        client.connect()
        assert len(calls) == 2  # 第一次失败后重连成功

    def test_no_retry_on_auth_failure(self, monkeypatch):
        def side_effect(_attempt, _ssh_exc, auth_exc):
            raise auth_exc("bad credentials")

        rw, calls = self._fake_paramiko(monkeypatch, side_effect)
        client = rw.RemoteWindowsClient("h", 22, "u", "p")
        with pytest.raises(RemoteNodeError, match="认证失败"):
            client.connect()
        assert len(calls) == 1

    def test_gives_up_after_three_attempts(self, monkeypatch):
        def side_effect(_attempt, ssh_exc, _auth_exc):
            raise ssh_exc("No existing session")

        rw, calls = self._fake_paramiko(monkeypatch, side_effect)
        client = rw.RemoteWindowsClient("h", 22, "u", "p")
        with pytest.raises(RemoteNodeError, match="无法连接远程节点"):
            client.connect()
        assert len(calls) == 3


class TestRemoteHelpers:
    def test_build_set_env_prefix(self):
        prefix = build_set_env_prefix({"TAG_NAME": "v1", "VERSION": "1.0.0"})
        assert 'set "TAG_NAME=v1"' in prefix
        assert 'set "VERSION=1.0.0"' in prefix
        assert " && " in prefix

    def test_build_set_env_prefix_rejects_percent(self):
        with pytest.raises(RemoteNodeError):
            build_set_env_prefix({"PATH_EXT": "%SystemRoot%"})

    def test_build_set_env_prefix_rejects_quote(self):
        with pytest.raises(RemoteNodeError):
            build_set_env_prefix({"NAME": 'a"b'})

    def test_decode_remote_line_gbk_fallback(self):
        assert decode_remote_line("中文".encode("gbk")) == "中文"
        assert decode_remote_line("中文".encode()) == "中文"


@pytest.mark.django_db
class TestAuthCloneArgs:
    def test_builds_basic_auth_header(self, repository, user, monkeypatch):
        monkeypatch.setattr(
            "apps.package.services.source.resolve_credential",
            lambda repo, user=None: {"token": "tok@en/1"},
        )
        args = PackageService._auth_clone_args(repository, user)
        assert args[0] == "-c"
        expected = base64.b64encode(b"oauth2:tok@en/1").decode("ascii")
        assert args[1] == f"http.extraHeader=Authorization: Basic {expected}"

    def test_custom_username(self, repository, user, monkeypatch):
        monkeypatch.setattr(
            "apps.package.services.source.resolve_credential",
            lambda repo, user=None: {"username": "deploy", "token": "t"},
        )
        args = PackageService._auth_clone_args(repository, user)
        expected = base64.b64encode(b"deploy:t").decode("ascii")
        assert args[1].endswith(expected)

    def test_no_token_returns_empty(self, repository, user, monkeypatch):
        monkeypatch.setattr(
            "apps.package.services.source.resolve_credential",
            lambda repo, user=None: {},
        )
        assert PackageService._auth_clone_args(repository, user) == []


@pytest.mark.django_db
class TestRemoteRunTask:
    def _make_task(self, project, repository, node, release, user, cleanup_workspace=True):
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="远程打包",
            executor_type="remote_node",
            node=node,
            custom_script="echo building %VERSION%",
            cleanup_workspace=cleanup_workspace,
        )
        return PackageTask.objects.create(
            config=config,
            release=release,
            project=project,
            repository=repository,
            triggered_by=user,
            name="远程打包 / VA.1.0.0",
            tag_name=release.tag_name,
            version=release.version,
            commit_hash=release.git_hash,
            config_snapshot=PackageService._snapshot(config),
        )

    def _mock_client(self, monkeypatch, artifacts: dict[str, bytes] | None = None):
        """Mock RemoteWindowsClient：记录命令、回传预设产物。"""
        client = MagicMock()
        client.__enter__ = lambda self: self
        client.__exit__ = lambda self, *exc: None
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
            "apps.package.services.RemoteWindowsClient.from_snapshot",
            classmethod(lambda cls, snapshot: client),
        )
        return client

    def test_remote_pipeline_success(self, project, repository, node, release, user, monkeypatch, tmp_path):
        monkeypatch.setattr(PackageService, "workspace_root", staticmethod(lambda: tmp_path))
        self._mock_client(monkeypatch, artifacts={"app.zip": b"zip-content"})
        task = self._make_task(project, repository, node, release, user)

        PackageService.run_task(task)
        task.refresh_from_db()

        assert task.status == "success"
        assert task.progress == 100
        assert len(task.artifact_info) == 1
        assert task.artifact_info[0]["name"] == "app.zip"
        # 本地产物已回传
        workspace = tmp_path
        zips = list(workspace.rglob("app.zip"))
        assert zips, "产物未回传到本地工作区"

    def test_remote_pipeline_cleans_workspace_by_default(self, project, repository, node, release, user, monkeypatch, tmp_path):
        """默认开启清理：回传成功后删除远程工作目录。"""
        monkeypatch.setattr(PackageService, "workspace_root", staticmethod(lambda: tmp_path))
        client = self._mock_client(monkeypatch, artifacts={"app.zip": b"zip-content"})
        task = self._make_task(project, repository, node, release, user)

        PackageService.run_task(task)
        task.refresh_from_db()

        assert task.status == "success"
        remote_workspace = PackageService._remote_workspace(task)
        removed = [call.args[0] for call in client.remove_dir.call_args_list]
        assert remote_workspace in removed, "默认配置应清理远程工作目录"
        log_text = (tmp_path.rglob("build.log").__next__()).read_text(encoding="utf-8")
        assert "远程工作目录已清理" in log_text

    def test_remote_pipeline_keeps_workspace_when_cleanup_disabled(self, project, repository, node, release, user, monkeypatch, tmp_path):
        """关闭清理：回传成功后保留远程工作目录用于调试。"""
        monkeypatch.setattr(PackageService, "workspace_root", staticmethod(lambda: tmp_path))
        client = self._mock_client(monkeypatch, artifacts={"app.zip": b"zip-content"})
        task = self._make_task(project, repository, node, release, user, cleanup_workspace=False)

        PackageService.run_task(task)
        task.refresh_from_db()

        assert task.status == "success"
        remote_workspace = PackageService._remote_workspace(task)
        removed = [call.args[0] for call in client.remove_dir.call_args_list]
        assert remote_workspace not in removed, "关闭清理后不应删除远程工作目录"
        log_text = (tmp_path.rglob("build.log").__next__()).read_text(encoding="utf-8")
        assert "远程工作目录已保留" in log_text

    def test_remote_build_failure_marks_task(self, project, repository, node, release, user, monkeypatch, tmp_path):
        monkeypatch.setattr(PackageService, "workspace_root", staticmethod(lambda: tmp_path))
        client = self._mock_client(monkeypatch)
        client.run_checked.side_effect = [None, RemoteNodeError("远程命令执行失败，退出码 1")]
        task = self._make_task(project, repository, node, release, user)

        PackageService.run_task(task)
        task.refresh_from_db()

        assert task.status == "failure"
        assert "退出码 1" in task.error_message

    def test_remote_checkout_command_uses_auth_header(self, project, repository, node, release, user, monkeypatch, tmp_path):
        monkeypatch.setattr(PackageService, "workspace_root", staticmethod(lambda: tmp_path))
        monkeypatch.setattr(
            "apps.package.services.source.resolve_credential",
            lambda repo, user=None: {"token": "abc123"},
        )
        client = self._mock_client(monkeypatch)
        task = self._make_task(project, repository, node, release, user)

        PackageService.run_task(task)

        clone_call = client.run_checked.call_args_list[0]
        command = clone_call.args[0]
        assert "clone --depth 1 --branch" in command
        assert "credential.helper=" in command
        expected_header = base64.b64encode(b"oauth2:abc123").decode("ascii")
        assert f"http.extraHeader=Authorization: Basic {expected_header}" in command
        # 明文凭证不进入命令与日志
        assert "abc123" not in command
        log_text = (tmp_path.rglob("build.log").__next__()).read_text(encoding="utf-8")
        assert "abc123" not in log_text
        assert expected_header not in log_text

    def test_remote_workspace_uses_snapshot_root(self, project, repository, node, release, user):
        task = self._make_task(project, repository, node, release, user)
        workspace = PackageService._remote_workspace(task)
        assert workspace == PureWindowsPath(r"C:\trace-ship\workspaces") / str(task.id)

    def test_remote_checkout_uploads_release_doc(self, project, repository, node, release, user):
        """远程拉取源码后上传发布说明到源码根目录。"""
        release.release_doc = "| 项目 | 内容 |\n|---|---|\n| 变更内容 | 第一行\n第二行 |"
        release.save(update_fields=["release_doc"])
        client = MagicMock()
        client.mkdirs.return_value = None
        client.remove_dir.return_value = None
        client.run_checked.return_value = None
        task = self._make_task(project, repository, node, release, user)

        PackageService._checkout_source_remote(task, client)

        path, content = client.upload_text.call_args.args
        expected = PackageService._remote_workspace(task) / "source" / f"release-{task.version}.md"
        assert path == expected
        assert content == table_newlines_to_br(release.release_doc)

    def test_remote_checkout_injects_credential_into_submodules(
        self, project, repository, node, release, user, monkeypatch
    ):
        """注入凭证 + 拉取子模块：foreach 命令内层用单引号。

        双引号经 sshd → cmd /c → git.exe 参数解析链路会被吞掉，
        命令在空格处截断，Git Bash sh -c 报 unexpected EOF（退出码 128）。
        """
        monkeypatch.setattr(
            "apps.package.services.source.resolve_credential",
            lambda repo, user=None: {"token": "abc123"},
        )
        task = self._make_task(project, repository, node, release, user)
        snapshot = task.config_snapshot
        snapshot["inject_git_credential"] = True
        snapshot["clone_submodules"] = True
        task.config_snapshot = snapshot
        client = MagicMock()

        PackageService._checkout_source_remote(task, client)

        commands = [call.args[0] for call in client.run_checked.call_args_list]
        foreach = next(cmd for cmd in commands if "submodule foreach" in cmd)
        expected = base64.b64encode(b"oauth2:abc123").decode("ascii")
        assert f"git config http.extraHeader 'Authorization: Basic {expected}'" in foreach
        # 内层不得出现双引号（cmd_quote 的 "" 转义会被 Windows 参数解析吞掉）
        assert '""' not in foreach
        # --quiet 抑制 foreach 回显命令，避免认证头明文进入构建日志
        assert "--quiet" in foreach


@pytest.mark.django_db
class TestNodeConcurrencyGate:
    """节点并发闸门：槽位不足时排队重投而不是失败。"""

    def _make_task(self, project, repository, node, release, user, status="queued"):
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="远程打包",
            executor_type="remote_node",
            node=node,
        )
        return PackageTask.objects.create(
            config=config,
            release=release,
            project=project,
            repository=repository,
            triggered_by=user,
            name="远程打包 / VA.1.0.0",
            tag_name=release.tag_name,
            version=release.version,
            config_snapshot=PackageService._snapshot(config),
            status=status,
        )

    def test_slot_available_when_idle(self, project, repository, node, release, user):
        task = self._make_task(project, repository, node, release, user)
        available, running, max_concurrency = PackageService.node_slot_available(task)
        assert available is True
        assert running == 0
        assert max_concurrency == 1

    def test_slot_full_when_running(self, project, repository, node, release, user):
        self._make_task(project, repository, node, release, user, status="running")
        waiting = self._make_task(project, repository, node, release, user)
        available, running, max_concurrency = PackageService.node_slot_available(waiting)
        assert available is False
        assert running == 1
        assert max_concurrency == 1

    def test_slot_respects_max_concurrency(self, project, repository, node, release, user):
        node.max_concurrency = 2
        node.save(update_fields=["max_concurrency"])
        self._make_task(project, repository, node, release, user, status="running")
        waiting = self._make_task(project, repository, node, release, user)
        available, running, _ = PackageService.node_slot_available(waiting)
        assert available is True
        assert running == 1

    def test_local_docker_task_bypasses_gate(self, project, repository, release, user):
        image = PackageImage.objects.create(name="Web 镜像", image="trace-ship/web:latest")
        config = PackageConfig.objects.create(
            project=project, repository=repository, name="本地打包", image=image,
        )
        task = PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            triggered_by=user, name="本地打包", tag_name=release.tag_name,
            version=release.version, config_snapshot=PackageService._snapshot(config),
        )
        available, _, _ = PackageService.node_slot_available(task)
        assert available is True

    def test_gate_queues_and_redispatches_when_full(self, project, repository, node, release, user, monkeypatch, tmp_path):
        monkeypatch.setattr(PackageService, "workspace_root", staticmethod(lambda: tmp_path))
        self._make_task(project, repository, node, release, user, status="running")
        waiting = self._make_task(project, repository, node, release, user)

        redispatched = []
        monkeypatch.setattr(
            PackageService, "_redispatch_delayed",
            classmethod(lambda cls, task: redispatched.append(str(task.id))),
        )
        run_called = []
        monkeypatch.setattr(
            PackageService, "run_task",
            classmethod(lambda cls, task: run_called.append(str(task.id))),
        )

        PackageService.run_task_with_gate(waiting)
        waiting.refresh_from_db()

        assert not run_called, "槽位不足时不应执行"
        assert redispatched == [str(waiting.id)], "应延迟重投"
        assert waiting.status == "queued"
        assert waiting.stage_info["stage"] == "waiting_node"
        assert waiting.stage_info["running"] == 1

    def test_gate_runs_when_slot_free(self, project, repository, node, release, user, monkeypatch):
        waiting = self._make_task(project, repository, node, release, user)
        run_called = []
        monkeypatch.setattr(
            PackageService, "run_task",
            classmethod(lambda cls, task: run_called.append(str(task.id))),
        )
        PackageService.run_task_with_gate(waiting)
        assert run_called == [str(waiting.id)]

    def test_gate_skips_finished_task(self, project, repository, node, release, user, monkeypatch):
        task = self._make_task(project, repository, node, release, user, status="canceled")
        run_called = []
        monkeypatch.setattr(
            PackageService, "run_task",
            classmethod(lambda cls, t: run_called.append(str(t.id))),
        )
        PackageService.run_task_with_gate(task)
        assert not run_called


@pytest.mark.django_db
class TestPackageNodeViews:
    def _superuser_client(self):
        admin = User.objects.create_superuser(
            username="node_admin", password="pass", nickname="管理员",
        )
        client = APIClient()
        client.force_authenticate(user=admin)
        return client

    def test_node_crud(self, windows_credential):
        client = self._superuser_client()
        resp = client.post("/api/packages/nodes/", {
            "name": "节点 A",
            "host": "10.0.0.1",
            "port": 22,
            "arch": "arm64",
            "credential": str(windows_credential.id),
            "work_root": r"C:\trace-ship\workspaces",
        }, format="json")
        assert resp.status_code == 200, resp.json()
        data = resp.json()["data"]
        node_id = data["id"]
        assert data["arch"] == "arm64"
        assert data["arch_display"] == "ARM 64位"

        resp = client.get("/api/packages/nodes/")
        assert resp.status_code == 200
        assert any(n["id"] == node_id for n in resp.json()["data"]["results"])

    def test_node_arch_default_x86_64(self, windows_credential):
        """不传 arch 时默认 x86 64位。"""
        client = self._superuser_client()
        resp = client.post("/api/packages/nodes/", {
            "name": "节点默认架构",
            "host": "10.0.0.3",
            "port": 22,
            "credential": str(windows_credential.id),
            "work_root": r"C:\trace-ship\workspaces",
        }, format="json")
        assert resp.status_code == 200, resp.json()
        assert resp.json()["data"]["arch"] == "x86_64"

    def test_delete_blocked_when_referenced(self, project, repository, node):
        PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="远程打包",
            executor_type="remote_node",
            node=node,
        )
        client = self._superuser_client()
        resp = client.delete(f"/api/packages/nodes/{node.id}/")
        assert resp.status_code == 409

    def test_delete_allowed_when_unreferenced(self, node):
        client = self._superuser_client()
        resp = client.delete(f"/api/packages/nodes/{node.id}/")
        assert resp.status_code == 200
        assert not PackageNode.objects.filter(id=node.id).exists()

    def test_write_requires_permission(self, api_client, windows_credential):
        """普通用户无 system.package_image 权限时不能创建节点。"""
        resp = api_client.post("/api/packages/nodes/", {
            "name": "节点 B",
            "host": "10.0.0.2",
            "port": 22,
            "credential": str(windows_credential.id),
        }, format="json")
        assert resp.status_code in (401, 403)

    def test_test_connection_requires_params(self):
        client = self._superuser_client()
        resp = client.post("/api/packages/nodes/test-connection/", {}, format="json")
        assert resp.status_code == 400

    def test_test_saved_node(self, node, monkeypatch):
        monkeypatch.setattr(
            "apps.package.views.test_node_connection",
            lambda host, port, credential_id, work_root="", os_type="windows": {
                "ok": True, "os": "Windows Server 2022", "git": r"C:\Program Files\Git\cmd\git.exe",
                "work_root_ready": True,
            },
        )
        client = self._superuser_client()
        resp = client.post(f"/api/packages/nodes/{node.id}/test/")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["ok"] is True
        assert data["git"]
