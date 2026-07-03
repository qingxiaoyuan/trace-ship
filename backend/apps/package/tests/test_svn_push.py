"""SVN 推送相关测试。"""
from unittest.mock import patch, MagicMock

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.credential.models import Credential
from apps.package.models import PackageConfig, PackageImage, PackageTask
from apps.package.serializers import PackageTaskSerializer
from apps.package.services import PackageService
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository
from utils.provider.svn import SVNProvider


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def user():
    return User.objects.create_user(
        username="svn_user",
        password="pass",
        nickname="SVN 用户",
    )


@pytest.fixture
def api_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(user):
    project = Project.objects.create(
        name="SVN 推送项目",
        code="SVNP",
        leader=user,
        status=1,
    )
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
def svn_credential(user, project):
    cred = Credential.objects.create(
        name="SVN 凭证",
        cred_type="svn_password",
        auth_mode="password",
        owner=user,
        scope="project",
        project=project,
        is_active=True,
    )
    cred.set_data({"username": "svnuser", "password": "svnpass"})
    cred.save()
    return cred


@pytest.fixture
def image():
    return PackageImage.objects.create(
        name="Web 镜像",
        build_type="web",
        image="trace-ship/web:latest",
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


# ---------------------------------------------------------------------------
# SVNProvider 写操作测试
# ---------------------------------------------------------------------------

class TestSVNProviderWriteOps:
    """SVNProvider 写操作方法测试。"""

    def test_remote_exists_true(self):
        """svn info 成功时返回 True。"""
        provider = SVNProvider("svn://host/repo", {"username": "u", "password": "p"})
        with patch("utils.provider.svn.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="Path: svn://host/repo\n", stderr="")
            assert provider.remote_exists("svn://host/repo/path") is True

    def test_remote_exists_false(self):
        """svn info 失败时返回 False。"""
        provider = SVNProvider("svn://host/repo", {"username": "u", "password": "p"})
        with patch("utils.provider.svn.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="Path not found")
            assert provider.remote_exists("svn://host/repo/nonexistent") is False

    def test_mkdir_constructs_correct_command(self):
        """svn mkdir 命令包含远程地址和提交说明。"""
        provider = SVNProvider("svn://host/repo", {"username": "u", "password": "p"})
        with patch("utils.provider.svn.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            provider.mkdir("svn://host/repo/v1.0.0", "Create release dir")

        cmd = mock_run.call_args[0][0]
        assert "mkdir" in cmd
        assert "svn://host/repo/v1.0.0" in cmd
        assert "-m" in cmd
        assert "Create release dir" in cmd

    def test_import_path_constructs_correct_command(self):
        """svn import 命令包含本地路径、远程地址和提交说明。"""
        provider = SVNProvider("svn://host/repo", {"username": "u", "password": "p"})
        with patch("utils.provider.svn.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
            provider.import_path("/tmp/artifacts", "svn://host/repo/v1.0.0", "Upload artifacts")

        cmd = mock_run.call_args[0][0]
        assert "import" in cmd
        assert "/tmp/artifacts" in cmd
        assert "svn://host/repo/v1.0.0" in cmd
        assert "-m" in cmd
        assert "Upload artifacts" in cmd


# ---------------------------------------------------------------------------
# PackageConfigSerializer 校验测试
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestPackageConfigSVNValidation:
    """打包配置 SVN 推送校验测试。"""

    def test_svn_push_enabled_requires_svn_url(self, api_client, project, repository, image, svn_credential):
        """启用 SVN 推送时必须填写 svn_url。"""
        response = api_client.post(
            "/api/packages/configs/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "name": "测试配置",
                "mode": "simple",
                "build_type": "web",
                "image": str(image.id),
                "build_path": ".",
                "output_path": "dist",
                "svn_push_enabled": True,
                "svn_credential": str(svn_credential.id),
            },
            format="json",
        )
        assert response.status_code == 400
        assert "svn_url" in str(response.data)

    def test_svn_push_enabled_requires_svn_credential(self, api_client, project, repository, image):
        """启用 SVN 推送时必须选择 SVN 凭证。"""
        response = api_client.post(
            "/api/packages/configs/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "name": "测试配置",
                "mode": "simple",
                "build_type": "web",
                "image": str(image.id),
                "build_path": ".",
                "output_path": "dist",
                "svn_push_enabled": True,
                "svn_url": "svn://host/releases",
            },
            format="json",
        )
        assert response.status_code == 400
        assert "svn_credential" in str(response.data)

    def test_svn_credential_must_be_svn_password_type(self, api_client, project, repository, image, user):
        """SVN 凭证类型必须为 svn_password。"""
        cred = Credential.objects.create(
            name="GitLab 凭证",
            cred_type="gitlab_token",
            auth_mode="token",
            owner=user,
            scope="project",
            project=project,
            is_active=True,
        )
        cred.set_data({"token": "glpat-test"})
        cred.save()
        response = api_client.post(
            "/api/packages/configs/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "name": "测试配置",
                "mode": "simple",
                "build_type": "web",
                "image": str(image.id),
                "build_path": ".",
                "output_path": "dist",
                "svn_push_enabled": True,
                "svn_url": "svn://host/releases",
                "svn_credential": str(cred.id),
            },
            format="json",
        )
        assert response.status_code == 400
        assert "svn_credential" in str(response.data)

    def test_svn_push_disabled_does_not_require_svn_fields(self, api_client, project, repository, image):
        """未启用 SVN 推送时不需要 SVN 字段。"""
        response = api_client.post(
            "/api/packages/configs/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "name": "测试配置",
                "mode": "simple",
                "build_type": "web",
                "image": str(image.id),
                "build_path": ".",
                "output_path": "dist",
                "svn_push_enabled": False,
            },
            format="json",
        )
        assert response.status_code == 200
        assert response.data["data"]["svn_push_enabled"] is False

    def test_create_config_with_svn_push_enabled(self, api_client, project, repository, image, svn_credential):
        """完整 SVN 配置可以成功创建。"""
        response = api_client.post(
            "/api/packages/configs/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "name": "SVN 推送配置",
                "mode": "simple",
                "build_type": "web",
                "image": str(image.id),
                "build_path": ".",
                "output_path": "dist",
                "svn_push_enabled": True,
                "svn_url": "svn://host/releases",
                "svn_credential": str(svn_credential.id),
                "svn_path_template": "{version}",
            },
            format="json",
        )
        assert response.status_code == 200
        data = response.data["data"]
        assert data["svn_push_enabled"] is True
        assert data["svn_url"] == "svn://host/releases"
        assert data["svn_credential_id"] == str(svn_credential.id)


# ---------------------------------------------------------------------------
# PackageService._push_artifacts_to_svn 测试
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestPushArtifactsToSVN:
    """PackageService._push_artifacts_to_svn 方法测试。"""

    def test_push_success(self, project, repository, release, svn_credential, tmp_path):
        """SVN 推送成功时返回 remote_url 和文件列表。"""
        task = PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
            mode="local",
            build_type="web",
            tag_name=release.tag_name,
            version=release.version,
            config_snapshot={
                "svn_push_enabled": True,
                "svn_url": "svn://host/releases",
                "svn_credential_id": str(svn_credential.id),
                "svn_path_template": "{version}",
            },
            artifact_info=[{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
        )
        workspace = tmp_path / "workspace"
        (workspace / "artifacts").mkdir(parents=True)
        (workspace / "artifacts" / "app.tar.gz").write_bytes(b"fake artifact")

        mock_provider = MagicMock()
        mock_provider.remote_exists.return_value = False

        with patch("apps.package.services.get_provider", return_value=mock_provider):
            result = PackageService._push_artifacts_to_svn(task, workspace)

        assert result["remote_url"] == "svn://host/releases/V1.0.0"
        assert result["file_count"] == 1
        assert result["files"] == ["app.tar.gz"]
        mock_provider.remote_exists.assert_called_once_with("svn://host/releases/V1.0.0")
        mock_provider.import_path.assert_called_once()

    def test_push_fails_when_directory_exists(self, project, repository, release, svn_credential, tmp_path):
        """SVN 版本目录已存在时推送失败。"""
        task = PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
            mode="local",
            build_type="web",
            tag_name=release.tag_name,
            version=release.version,
            config_snapshot={
                "svn_push_enabled": True,
                "svn_url": "svn://host/releases",
                "svn_credential_id": str(svn_credential.id),
                "svn_path_template": "{version}",
            },
            artifact_info=[],
        )
        workspace = tmp_path / "workspace"
        (workspace / "artifacts").mkdir(parents=True)

        mock_provider = MagicMock()
        mock_provider.remote_exists.return_value = True

        with patch("apps.package.services.get_provider", return_value=mock_provider):
            with pytest.raises(RuntimeError, match="SVN 目录已存在"):
                PackageService._push_artifacts_to_svn(task, workspace)

    def test_push_fails_when_credential_inactive(self, project, repository, release, svn_credential, tmp_path):
        """SVN 凭证已停用时推送失败。"""
        svn_credential.is_active = False
        svn_credential.save()

        task = PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
            mode="local",
            build_type="web",
            tag_name=release.tag_name,
            version=release.version,
            config_snapshot={
                "svn_push_enabled": True,
                "svn_url": "svn://host/releases",
                "svn_credential_id": str(svn_credential.id),
                "svn_path_template": "{version}",
            },
            artifact_info=[],
        )
        workspace = tmp_path / "workspace"
        (workspace / "artifacts").mkdir(parents=True)

        with pytest.raises(RuntimeError, match="SVN 凭证已停用"):
            PackageService._push_artifacts_to_svn(task, workspace)

    def test_push_fails_when_config_incomplete(self, project, repository, release, tmp_path):
        """SVN 推送配置不完整时失败。"""
        task = PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
            mode="local",
            build_type="web",
            tag_name=release.tag_name,
            version=release.version,
            config_snapshot={
                "svn_push_enabled": True,
                "svn_url": "",
                "svn_credential_id": None,
                "svn_path_template": "{version}",
            },
            artifact_info=[],
        )
        workspace = tmp_path / "workspace"
        (workspace / "artifacts").mkdir(parents=True)

        with pytest.raises(RuntimeError, match="SVN 推送配置不完整"):
            PackageService._push_artifacts_to_svn(task, workspace)

    def test_push_with_custom_path_template(self, project, repository, release, svn_credential, tmp_path):
        """自定义路径模板正确渲染。"""
        task = PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
            mode="local",
            build_type="web",
            tag_name=release.tag_name,
            version=release.version,
            config_snapshot={
                "svn_push_enabled": True,
                "svn_url": "svn://host/releases",
                "svn_credential_id": str(svn_credential.id),
                "svn_path_template": "{project_code}/{version}",
            },
            artifact_info=[],
        )
        workspace = tmp_path / "workspace"
        (workspace / "artifacts").mkdir(parents=True)

        mock_provider = MagicMock()
        mock_provider.remote_exists.return_value = False

        with patch("apps.package.services.get_provider", return_value=mock_provider):
            result = PackageService._push_artifacts_to_svn(task, workspace)

        assert result["remote_url"] == "svn://host/releases/SVNP/V1.0.0"


# ---------------------------------------------------------------------------
# run_task 集成测试（SVN 推送阶段）
# ---------------------------------------------------------------------------

@pytest.mark.django_db
def test_run_task_with_svn_push_success(project, repository, release, svn_credential, user, settings, tmp_path, monkeypatch):
    """启用 SVN 推送时，打包成功后产物推送到 SVN，任务状态为 success。"""
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="SVN 打包配置",
        mode="local",
        build_type="web",
        local_script="echo build",
        svn_push_enabled=True,
        svn_url="svn://host/releases",
        svn_credential=svn_credential,
        svn_path_template="{version}",
    )
    task = PackageTask.objects.create(
        config=config,
        release=release,
        project=project,
        repository=repository,
        name="SVN 打包任务",
        mode="local",
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot=PackageService._snapshot(config),
    )

    monkeypatch.setattr(PackageService, "_checkout_source", lambda task, workspace: None)
    monkeypatch.setattr(PackageService, "_run_local", lambda task, workspace: None)
    monkeypatch.setattr(
        PackageService,
        "_scan_artifacts",
        lambda workspace: [{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
    )

    mock_provider = MagicMock()
    mock_provider.remote_exists.return_value = False
    monkeypatch.setattr("apps.package.services.get_provider", lambda vendor, url, cred: mock_provider)

    PackageService.run_task(task)
    task.refresh_from_db()

    assert task.status == "success"
    assert task.stage_info["stage"] == "done"
    assert task.stage_info.get("svn_push") is not None
    assert task.stage_info["svn_push"]["remote_url"] == "svn://host/releases/V1.0.0"
    mock_provider.import_path.assert_called_once()


@pytest.mark.django_db
def test_run_task_with_svn_push_failure_marks_task_failed(project, repository, release, svn_credential, user, settings, tmp_path, monkeypatch):
    """SVN 推送失败时，打包任务标记为 failure。"""
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="SVN 打包配置",
        mode="local",
        build_type="web",
        local_script="echo build",
        svn_push_enabled=True,
        svn_url="svn://host/releases",
        svn_credential=svn_credential,
        svn_path_template="{version}",
    )
    task = PackageTask.objects.create(
        config=config,
        release=release,
        project=project,
        repository=repository,
        name="SVN 打包任务",
        mode="local",
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot=PackageService._snapshot(config),
    )

    monkeypatch.setattr(PackageService, "_checkout_source", lambda task, workspace: None)
    monkeypatch.setattr(PackageService, "_run_local", lambda task, workspace: None)
    monkeypatch.setattr(
        PackageService,
        "_scan_artifacts",
        lambda workspace: [{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
    )

    mock_provider = MagicMock()
    mock_provider.remote_exists.return_value = True  # 目录已存在
    monkeypatch.setattr("apps.package.services.get_provider", lambda vendor, url, cred: mock_provider)

    PackageService.run_task(task)
    task.refresh_from_db()

    assert task.status == "failure"
    assert "SVN 目录已存在" in task.error_message
    # 产物仍然保留
    assert len(task.artifact_info) == 1


@pytest.mark.django_db
def test_run_task_without_svn_push_has_no_svn_stage(project, repository, release, user, settings, tmp_path, monkeypatch):
    """未启用 SVN 推送时，流程不包含 svn_push 阶段。"""
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="普通打包配置",
        mode="local",
        build_type="web",
        local_script="echo build",
        svn_push_enabled=False,
    )
    task = PackageTask.objects.create(
        config=config,
        release=release,
        project=project,
        repository=repository,
        name="普通打包任务",
        mode="local",
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot=PackageService._snapshot(config),
    )

    monkeypatch.setattr(PackageService, "_checkout_source", lambda task, workspace: None)
    monkeypatch.setattr(PackageService, "_run_local", lambda task, workspace: None)
    monkeypatch.setattr(
        PackageService,
        "_scan_artifacts",
        lambda workspace: [{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
    )

    PackageService.run_task(task)
    task.refresh_from_db()

    assert task.status == "success"
    assert task.stage_info["stage"] == "done"
    assert "svn_push" not in task.stage_info


# ---------------------------------------------------------------------------
# manual_push_svn 测试
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestManualPushSvn:
    """PackageService.manual_push_svn 方法测试。"""

    def test_manual_push_success(self, project, repository, release, svn_credential, tmp_path):
        """手动推送成功时返回结果并更新 stage_info。"""
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="SVN 配置",
            mode="local",
            build_type="web",
            local_script="echo build",
            svn_push_enabled=True,
            svn_url="svn://host/releases",
            svn_credential=svn_credential,
        )
        workspace = tmp_path / "workspace"
        (workspace / "artifacts").mkdir(parents=True)
        (workspace / "artifacts" / "app.tar.gz").write_bytes(b"fake")
        task = PackageTask.objects.create(
            config=config,
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
            mode="local",
            build_type="web",
            tag_name=release.tag_name,
            version=release.version,
            status="success",
            workspace_path=str(workspace),
            artifact_info=[{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
            config_snapshot=PackageService._snapshot(config),
        )

        mock_provider = MagicMock()
        mock_provider.remote_exists.return_value = False

        with patch("apps.package.services.get_provider", return_value=mock_provider):
            result = PackageService.manual_push_svn(task)

        assert result["remote_url"] == "svn://host/releases/V1.0.0"
        task.refresh_from_db()
        assert task.stage_info.get("svn_push") is not None
        assert task.stage_info["svn_push"]["remote_url"] == "svn://host/releases/V1.0.0"

    def test_manual_push_fails_when_task_not_success(self, project, repository, release, svn_credential, tmp_path):
        """非成功状态的任务不能手动推送。"""
        from rest_framework import serializers as drf_serializers

        config = PackageConfig.objects.create(
            project=project, repository=repository, name="配置", mode="local", build_type="web",
            svn_push_enabled=True, svn_url="svn://host/releases", svn_credential=svn_credential,
        )
        task = PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            name="任务", mode="local", build_type="web", tag_name=release.tag_name, version=release.version,
            status="failure", config_snapshot=PackageService._snapshot(config),
        )
        with pytest.raises(drf_serializers.ValidationError):
            PackageService.manual_push_svn(task)

    def test_manual_push_fails_when_no_artifacts(self, project, repository, release, svn_credential, tmp_path):
        """没有产物的任务不能手动推送。"""
        from rest_framework import serializers as drf_serializers

        config = PackageConfig.objects.create(
            project=project, repository=repository, name="配置", mode="local", build_type="web",
            svn_push_enabled=True, svn_url="svn://host/releases", svn_credential=svn_credential,
        )
        task = PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            name="任务", mode="local", build_type="web", tag_name=release.tag_name, version=release.version,
            status="success", artifact_info=[], config_snapshot=PackageService._snapshot(config),
        )
        with pytest.raises(drf_serializers.ValidationError):
            PackageService.manual_push_svn(task)

    def test_manual_push_fails_when_svn_not_configured(self, project, repository, release, tmp_path):
        """配置未启用 SVN 推送时手动推送失败。"""
        config = PackageConfig.objects.create(
            project=project, repository=repository, name="配置", mode="local", build_type="web",
            svn_push_enabled=False,
        )
        workspace = tmp_path / "workspace"
        (workspace / "artifacts").mkdir(parents=True)
        task = PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            name="任务", mode="local", build_type="web", tag_name=release.tag_name, version=release.version,
            status="success", workspace_path=str(workspace),
            artifact_info=[{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
            config_snapshot=PackageService._snapshot(config),
        )
        with pytest.raises(RuntimeError, match="未启用 SVN 推送"):
            PackageService.manual_push_svn(task)

    def test_manual_push_fallback_to_config(self, project, repository, release, svn_credential, tmp_path):
        """快照缺少 SVN 配置时回退到 config 当前配置。"""
        config = PackageConfig.objects.create(
            project=project, repository=repository, name="配置", mode="local", build_type="web",
            svn_push_enabled=True, svn_url="svn://host/releases", svn_credential=svn_credential,
        )
        workspace = tmp_path / "workspace"
        (workspace / "artifacts").mkdir(parents=True)
        (workspace / "artifacts" / "app.tar.gz").write_bytes(b"fake")
        # 快照中不含 SVN 配置（模拟旧任务）
        task = PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            name="任务", mode="local", build_type="web", tag_name=release.tag_name, version=release.version,
            status="success", workspace_path=str(workspace),
            artifact_info=[{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
            config_snapshot={"mode": "local", "build_type": "web", "local_script": "echo build"},
        )

        mock_provider = MagicMock()
        mock_provider.remote_exists.return_value = False

        with patch("apps.package.services.get_provider", return_value=mock_provider):
            result = PackageService.manual_push_svn(task)

        assert result["remote_url"] == "svn://host/releases/V1.0.0"
        mock_provider.import_path.assert_called_once()


@pytest.mark.django_db
def test_package_task_serializer_can_push_svn(project, repository, release, svn_credential, tmp_path):
    """任务序列化时返回 can_push_svn，供前端控制手动推送按钮。"""
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="SVN 配置",
        mode="local",
        build_type="web",
        local_script="echo build",
        svn_push_enabled=True,
        svn_url="svn://host/releases",
        svn_credential=svn_credential,
    )
    task = PackageTask.objects.create(
        config=config,
        release=release,
        project=project,
        repository=repository,
        name="任务",
        mode="local",
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
        status="success",
        artifact_info=[{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz"}],
        config_snapshot=PackageService._snapshot(config),
    )
    data = PackageTaskSerializer(task).data
    assert data["can_push_svn"] is True

    task.config_snapshot = {"svn_push_enabled": False}
    task.save(update_fields=["config_snapshot"])
    data = PackageTaskSerializer(task).data
    assert data["can_push_svn"] is False
