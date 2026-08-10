"""远程 Windows 打包节点相关测试。"""
import base64
import pytest
from pathlib import PureWindowsPath
from unittest.mock import MagicMock

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
    ProjectMember.objects.create(project=project, user=user, role="manager")
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
                "executor_type": "remote_windows",
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
                "executor_type": "remote_windows",
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
            executor_type="remote_windows",
            node=node,
        )
        snapshot = PackageService._snapshot(config)
        assert snapshot["executor_type"] == "remote_windows"
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
        assert decode_remote_line("中文".encode("utf-8")) == "中文"


@pytest.mark.django_db
class TestAuthCloneArgs:
    def test_builds_basic_auth_header(self, repository, user, monkeypatch):
        monkeypatch.setattr(
            "apps.package.services.resolve_credential",
            lambda repo, user=None: {"token": "tok@en/1"},
        )
        args = PackageService._auth_clone_args(repository, user)
        assert args[0] == "-c"
        expected = base64.b64encode(b"oauth2:tok@en/1").decode("ascii")
        assert args[1] == f"http.extraHeader=Authorization: Basic {expected}"

    def test_custom_username(self, repository, user, monkeypatch):
        monkeypatch.setattr(
            "apps.package.services.resolve_credential",
            lambda repo, user=None: {"username": "deploy", "token": "t"},
        )
        args = PackageService._auth_clone_args(repository, user)
        expected = base64.b64encode(b"deploy:t").decode("ascii")
        assert args[1].endswith(expected)

    def test_no_token_returns_empty(self, repository, user, monkeypatch):
        monkeypatch.setattr(
            "apps.package.services.resolve_credential",
            lambda repo, user=None: {},
        )
        assert PackageService._auth_clone_args(repository, user) == []


@pytest.mark.django_db
class TestRemoteRunTask:
    def _make_task(self, project, repository, node, release, user):
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="远程打包",
            executor_type="remote_windows",
            node=node,
            custom_script="echo building %VERSION%",
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
        client = self._mock_client(monkeypatch, artifacts={"app.zip": b"zip-content"})
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
            "apps.package.services.resolve_credential",
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
            "credential": str(windows_credential.id),
            "work_root": r"C:\trace-ship\workspaces",
        }, format="json")
        assert resp.status_code == 200, resp.json()
        node_id = resp.json()["data"]["id"]

        resp = client.get("/api/packages/nodes/")
        assert resp.status_code == 200
        assert any(n["id"] == node_id for n in resp.json()["data"]["results"])

    def test_delete_blocked_when_referenced(self, project, repository, node):
        PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="远程打包",
            executor_type="remote_windows",
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
            lambda host, port, credential_id, work_root="": {
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
