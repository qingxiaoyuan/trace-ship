"""SVN 推送相关测试。"""
from unittest.mock import MagicMock, patch

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
def svn_credential(user, project):
    cred = Credential.objects.create(
        name="SVN 凭证",
        cred_type="svn_password",
        auth_mode="password",
        owner=user,
        is_active=True,
    )
    cred.set_data({"username": "svnuser", "password": "svnpass"})
    cred.save()
    return cred


@pytest.fixture
def image():
    return PackageImage.objects.create(
        name="Web 镜像",
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
        release_doc="# 发布说明\n\n- 修复问题",
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

        with patch("apps.package.services.svn.get_provider", return_value=mock_provider):
            result = PackageService._push_artifacts_to_svn(task, workspace)

        assert result["remote_url"] == "svn://host/releases/V1.0.0"
        assert result["file_count"] == 2
        assert result["files"] == ["app.tar.gz", "release-V1.0.0.md"]
        mock_provider.remote_exists.assert_called_once_with("svn://host/releases/V1.0.0")
        import_path = mock_provider.import_path.call_args.args[0]
        assert (workspace / "tmp" / "svn_upload" / "release-V1.0.0.md").read_text(encoding="utf-8") == release.release_doc
        assert import_path == str(workspace / "tmp" / "svn_upload")
        message = mock_provider.import_path.call_args.args[2]
        assert message == f"Release {task.version} artifacts ({task.tag_name})\n\n{release.release_doc}"

    def test_push_message_uses_summary_when_doc_empty(self, project, repository, release, svn_credential, tmp_path):
        """发布说明为空时 SVN 提交信息仅保留摘要行。"""
        release.release_doc = ""
        release.save(update_fields=["release_doc"])
        task = PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
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

        with patch("apps.package.services.svn.get_provider", return_value=mock_provider):
            PackageService._push_artifacts_to_svn(task, workspace)

        message = mock_provider.import_path.call_args.args[2]
        assert message == f"Release {task.version} artifacts ({task.tag_name})"

    def test_push_doc_multiline_cells_use_br(self, project, repository, release, svn_credential, tmp_path):
        """推送的发布文档中多行单元格换行转换为 <br>（标准 Markdown 表格语法）。"""
        release.release_doc = "| 项目 | 内容 |\n|---|---|\n| 变更内容 | 第一行\n第二行 |\n| 发布人 | 张三 |"
        release.save(update_fields=["release_doc"])
        task = PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
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

        with patch("apps.package.services.svn.get_provider", return_value=mock_provider):
            PackageService._push_artifacts_to_svn(task, workspace)

        doc_text = (workspace / "tmp" / "svn_upload" / f"release-{release.version}.md").read_text(encoding="utf-8")
        assert "| 变更内容 | 第一行<br>第二行 |" in doc_text
        assert "| 发布人 | 张三 |" in doc_text
        # 提交信息使用原始发布说明（真实换行），不包含 <br>
        message = mock_provider.import_path.call_args.args[2]
        assert message == f"Release {task.version} artifacts ({task.tag_name})\n\n{release.release_doc}"
        assert "第一行\n第二行" in message
        assert "<br>" not in message

    def test_push_fails_when_directory_exists(self, project, repository, release, svn_credential, tmp_path):
        """SVN 版本目录已存在时推送失败。"""
        task = PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
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

        with patch("apps.package.services.svn.get_provider", return_value=mock_provider):
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

    def test_push_fails_when_release_doc_filename_conflicts(self, project, repository, release, svn_credential, tmp_path):
        """产物中已有同名发布文档时不能静默覆盖。"""
        task = PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
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
        (workspace / "artifacts" / "release-V1.0.0.md").write_text("产物自带文档", encoding="utf-8")

        mock_provider = MagicMock()
        mock_provider.remote_exists.return_value = False

        with patch("apps.package.services.svn.get_provider", return_value=mock_provider):
            with pytest.raises(RuntimeError, match="同名文件"):
                PackageService._push_artifacts_to_svn(task, workspace)
        mock_provider.import_path.assert_not_called()

    def test_push_with_custom_path_template(self, project, repository, release, svn_credential, tmp_path):
        """自定义路径模板正确渲染。"""
        task = PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
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

        with patch("apps.package.services.svn.get_provider", return_value=mock_provider):
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
        custom_script="echo build",
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
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot=PackageService._snapshot(config),
    )

    monkeypatch.setattr(PackageService, "_checkout_source", lambda task, workspace: None)
    monkeypatch.setattr(PackageService, "_run_container", lambda task, workspace: None)
    monkeypatch.setattr(
        PackageService,
        "_scan_artifacts",
        lambda workspace: [{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
    )

    mock_provider = MagicMock()
    mock_provider.remote_exists.return_value = False
    monkeypatch.setattr("apps.package.services.svn.get_provider", lambda vendor, url, cred: mock_provider)

    PackageService.run_task(task)
    task.refresh_from_db()

    assert task.status == "success"
    assert task.stage_info["stage"] == "done"
    assert task.stage_info.get("svn_push") is not None
    assert task.stage_info["svn_push"]["status"] == "success"
    assert task.stage_info["svn_push"]["remote_url"] == "svn://host/releases/V1.0.0"
    mock_provider.import_path.assert_called_once()


@pytest.mark.django_db
def test_run_task_with_svn_push_failure_keeps_task_success(project, repository, release, svn_credential, user, settings, tmp_path, monkeypatch):
    """SVN 推送失败仅作为警告，打包任务与产物仍保持成功。"""
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="SVN 打包配置",
        custom_script="echo build",
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
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot=PackageService._snapshot(config),
    )

    monkeypatch.setattr(PackageService, "_checkout_source", lambda task, workspace: None)
    monkeypatch.setattr(PackageService, "_run_container", lambda task, workspace: None)
    monkeypatch.setattr(
        PackageService,
        "_scan_artifacts",
        lambda workspace: [{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
    )

    mock_provider = MagicMock()
    mock_provider.remote_exists.return_value = True  # 目录已存在
    monkeypatch.setattr("apps.package.services.svn.get_provider", lambda vendor, url, cred: mock_provider)

    PackageService.run_task(task)
    task.refresh_from_db()

    assert task.status == "success"
    assert task.error_message == ""
    assert task.stage_info["svn_push"]["status"] == "failure"
    assert "SVN 目录已存在" in task.stage_info["svn_push"]["error_message"]
    # 产物仍然保留
    assert len(task.artifact_info) == 1

    mock_provider.remote_exists.return_value = False
    PackageService.manual_push_svn(task)
    task.refresh_from_db()
    assert task.status == "success"
    assert task.stage_info["svn_push"]["status"] == "success"
    assert "error_message" not in task.stage_info["svn_push"]


@pytest.mark.django_db
def test_run_task_without_svn_push_has_no_svn_stage(project, repository, release, user, settings, tmp_path, monkeypatch):
    """未启用 SVN 推送时，流程不包含 svn_push 阶段。"""
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="普通打包配置",
        custom_script="echo build",
        svn_push_enabled=False,
    )
    task = PackageTask.objects.create(
        config=config,
        release=release,
        project=project,
        repository=repository,
        name="普通打包任务",
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot=PackageService._snapshot(config),
    )

    monkeypatch.setattr(PackageService, "_checkout_source", lambda task, workspace: None)
    monkeypatch.setattr(PackageService, "_run_container", lambda task, workspace: None)
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
            custom_script="echo build",
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

        with patch("apps.package.services.svn.get_provider", return_value=mock_provider):
            result = PackageService.manual_push_svn(task)

        assert result["remote_url"] == "svn://host/releases/V1.0.0"
        task.refresh_from_db()
        assert task.stage_info.get("svn_push") is not None
        assert task.stage_info["svn_push"]["status"] == "success"
        assert task.stage_info["svn_push"]["remote_url"] == "svn://host/releases/V1.0.0"

    def test_manual_push_fails_when_task_not_success(self, project, repository, release, svn_credential, tmp_path):
        """非成功状态的任务不能手动推送。"""
        from rest_framework import serializers as drf_serializers

        config = PackageConfig.objects.create(
            project=project, repository=repository, name="配置",
            svn_push_enabled=True, svn_url="svn://host/releases", svn_credential=svn_credential,
        )
        task = PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            name="任务", build_type="web", tag_name=release.tag_name, version=release.version,
            status="failure", config_snapshot=PackageService._snapshot(config),
        )
        with pytest.raises(drf_serializers.ValidationError):
            PackageService.manual_push_svn(task)

    def test_manual_push_fails_when_no_artifacts(self, project, repository, release, svn_credential, tmp_path):
        """没有产物的任务不能手动推送。"""
        from rest_framework import serializers as drf_serializers

        config = PackageConfig.objects.create(
            project=project, repository=repository, name="配置",
            svn_push_enabled=True, svn_url="svn://host/releases", svn_credential=svn_credential,
        )
        task = PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            name="任务", build_type="web", tag_name=release.tag_name, version=release.version,
            status="success", artifact_info=[], config_snapshot=PackageService._snapshot(config),
        )
        with pytest.raises(drf_serializers.ValidationError):
            PackageService.manual_push_svn(task)

    def test_manual_push_fails_when_svn_not_configured(self, project, repository, release, tmp_path):
        """配置未启用 SVN 推送时手动推送失败。"""
        config = PackageConfig.objects.create(
            project=project, repository=repository, name="配置",
            svn_push_enabled=False,
        )
        workspace = tmp_path / "workspace"
        (workspace / "artifacts").mkdir(parents=True)
        task = PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            name="任务", build_type="web", tag_name=release.tag_name, version=release.version,
            status="success", workspace_path=str(workspace),
            artifact_info=[{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
            config_snapshot=PackageService._snapshot(config),
        )
        with pytest.raises(RuntimeError, match="未启用 SVN 推送"):
            PackageService.manual_push_svn(task)

    def test_manual_push_fallback_to_config(self, project, repository, release, svn_credential, tmp_path):
        """快照缺少 SVN 配置时回退到 config 当前配置。"""
        config = PackageConfig.objects.create(
            project=project, repository=repository, name="配置",
            svn_push_enabled=True, svn_url="svn://host/releases", svn_credential=svn_credential,
        )
        workspace = tmp_path / "workspace"
        (workspace / "artifacts").mkdir(parents=True)
        (workspace / "artifacts" / "app.tar.gz").write_bytes(b"fake")
        # 快照中不含 SVN 配置（模拟旧任务）
        task = PackageTask.objects.create(
            config=config, release=release, project=project, repository=repository,
            name="任务", build_type="web", tag_name=release.tag_name, version=release.version,
            status="success", workspace_path=str(workspace),
            artifact_info=[{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
        )

        mock_provider = MagicMock()
        mock_provider.remote_exists.return_value = False

        with patch("apps.package.services.svn.get_provider", return_value=mock_provider):
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
        custom_script="echo build",
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


@pytest.mark.django_db
class TestReleaseTypeDistinction:
    """打包任务区分发布类型（正式 / RC / 测试版）。"""

    def _push_remote_url(self, task, workspace, artifacts_name="app.tar.gz"):
        (workspace / "artifacts").mkdir(parents=True, exist_ok=True)
        (workspace / "artifacts" / artifacts_name).write_bytes(b"fake artifact")
        mock_provider = MagicMock()
        mock_provider.remote_exists.return_value = False
        with patch("apps.package.services.svn.get_provider", return_value=mock_provider):
            result = PackageService._push_artifacts_to_svn(task, workspace)
        return result["remote_url"]

    def _make_task(self, project, repository, release, svn_credential, release_type, template="{version}"):
        release.release_type = release_type
        release.save(update_fields=["release_type"])
        return PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
            tag_name=release.tag_name,
            version=release.version,
            release_type=release_type,
            config_snapshot={
                "svn_push_enabled": True,
                "svn_url": "svn://host/releases",
                "svn_credential_id": str(svn_credential.id),
                "svn_path_template": template,
            },
            artifact_info=[{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
        )

    def test_formal_default_template_unchanged(self, project, repository, release, svn_credential, tmp_path):
        """正式版默认模板目录不带后缀（保持既有行为）。"""
        task = self._make_task(project, repository, release, svn_credential, "formal")
        url = self._push_remote_url(task, tmp_path / "ws1")
        assert url == "svn://host/releases/V1.0.0"

    def test_rc_default_template_gets_type_suffix(self, project, repository, release, svn_credential, tmp_path):
        """RC 版默认模板目录自动带 -rc 后缀，不覆盖正式版目录。"""
        task = self._make_task(project, repository, release, svn_credential, "rc")
        url = self._push_remote_url(task, tmp_path / "ws2")
        assert url == "svn://host/releases/V1.0.0-rc"

    def test_beta_default_template_gets_type_suffix(self, project, repository, release, svn_credential, tmp_path):
        """测试版默认模板目录自动带 -beta 后缀。"""
        task = self._make_task(project, repository, release, svn_credential, "beta")
        url = self._push_remote_url(task, tmp_path / "ws3")
        assert url == "svn://host/releases/V1.0.0-beta"

    def test_custom_template_supports_release_type_placeholder(self, project, repository, release, svn_credential, tmp_path):
        """自定义模板支持 {release_type} 占位符。"""
        task = self._make_task(project, repository, release, svn_credential, "rc", template="{release_type}/{version}")
        url = self._push_remote_url(task, tmp_path / "ws4")
        assert url == "svn://host/releases/rc/V1.0.0"

    def test_create_task_carries_release_type(self, project, repository, release, user, monkeypatch):
        """创建打包任务时从发布记录带出发布类型。"""
        image = PackageImage.objects.create(name="Web 镜像", image="trace-ship/web:latest")
        config = PackageConfig.objects.create(
            project=project, repository=repository, name="Web 打包", image=image,
        )
        release.release_type = "rc"
        release.save(update_fields=["release_type"])
        monkeypatch.setattr(PackageService, "dispatch_task", classmethod(lambda cls, task: None))

        task = PackageService.create_task_for_release(config, release, request_user=user)
        assert task.release_type == "rc"


@pytest.mark.django_db
def test_run_task_with_svn_push_for_branch_task(
    project, repository, svn_credential, user, settings, tmp_path, monkeypatch
):
    """分支直打包任务（无发布）启用 SVN 推送时，打包成功后同样推送产物到 SVN。"""
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="SVN 打包配置",
        custom_script="echo build",
        svn_push_enabled=True,
        svn_url="svn://host/releases",
        svn_credential=svn_credential,
        svn_path_template="{version}",
    )
    # 屏蔽任务投递，避免测试环境实际执行打包
    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", lambda task_id: None)
    task = PackageService.create_task_for_branch(config, "feature/demo", request_user=user)

    monkeypatch.setattr(PackageService, "_checkout_source", lambda task, workspace: None)
    monkeypatch.setattr(PackageService, "_run_container", lambda task, workspace: None)
    monkeypatch.setattr(
        PackageService,
        "_scan_artifacts",
        lambda workspace: [{"id": "a1", "name": "app.tar.gz", "path": "app.tar.gz", "size": 100, "sha256": "abc"}],
    )

    mock_provider = MagicMock()
    # remote_exists：对最末目录返回 False（不存在可推送），对父目录 releases/feature 也返回 False（需创建）
    mock_provider.remote_exists.side_effect = lambda url: False
    monkeypatch.setattr("apps.package.services.svn.get_provider", lambda vendor, url, cred: mock_provider)

    PackageService.run_task(task)
    task.refresh_from_db()

    assert task.status == "success"
    assert task.stage_info["svn_push"]["status"] == "success"
    # 默认模板 {version} 即分支名，SVN 目录保留分支层级
    assert task.stage_info["svn_push"]["remote_url"] == "svn://host/releases/feature/demo"
    mock_provider.import_path.assert_called_once()
    # svn import 不会创建父目录：应先用 mkdir 创建 releases/feature
    mock_provider.mkdir.assert_called_once()
    assert mock_provider.mkdir.call_args.args[0] == "svn://host/releases/feature"


@pytest.mark.django_db
def test_ensure_svn_parent_dirs_skips_existing(project, repository, user):
    """SVN 父目录已存在时不重复创建。"""
    provider = MagicMock()
    provider.remote_exists.return_value = True

    PackageService._ensure_svn_parent_dirs(provider, "svn://host/releases", "feature/demo/1.0")

    provider.mkdir.assert_not_called()
    # 存在性检查覆盖 feature 与 feature/demo 两级父目录
    assert provider.remote_exists.call_count == 2


# ---------------------------------------------------------------------------
# 发布文档修改后同步替换 SVN 文档测试
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestSyncReleaseDocToSvn:
    """修改发布文档后同步替换已推送 SVN 的文档。"""

    def _make_pushed_task(
        self, project, repository, release, svn_credential, *, remote_url="svn://host/releases/V1.0.0"
    ):
        """构造一个已成功推送 SVN 的打包任务。"""
        image, _ = PackageImage.objects.get_or_create(
            name="Web 镜像", image="trace-ship/web:latest"
        )
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="Web 打包",
            image=image,
            svn_push_enabled=True,
            svn_url="svn://host/releases",
            svn_credential=svn_credential,
            svn_path_template="{version}",
        )
        return PackageTask.objects.create(
            config=config,
            release=release,
            project=project,
            repository=repository,
            name="Web 打包",
            version=release.version,
            tag_name=release.tag_name,
            status="success",
            config_snapshot={
                "svn_push_enabled": True,
                "svn_url": "svn://host/releases",
                "svn_credential_id": str(svn_credential.id),
                "svn_path_template": "{version}",
            },
            stage_info={"svn_push": {"status": "success", "remote_url": remote_url}},
        )

    def test_sync_success(self, project, repository, release, svn_credential, monkeypatch):
        """已推送 SVN 的任务成功替换文档。"""
        self._make_pushed_task(project, repository, release, svn_credential)
        mock_provider = MagicMock()
        monkeypatch.setattr("apps.package.services.svn.get_provider", lambda vendor, url, cred: mock_provider)

        results = PackageService.sync_release_docs_to_svn(release)

        assert len(results) == 1
        assert results[0]["ok"] is True
        assert results[0]["remote_url"] == "svn://host/releases/V1.0.0"
        mock_provider.replace_file.assert_called_once()
        # 提交说明与目标文件名正确（remote_url/local_path 为位置参数）
        args, kwargs = mock_provider.replace_file.call_args
        assert "release-V1.0.0.md" in args[1]
        assert "doc update" in kwargs["message"]

    def test_sync_failure_not_block(self, project, repository, release, svn_credential, monkeypatch):
        """单个任务同步失败不抛出异常，返回 error。"""
        self._make_pushed_task(project, repository, release, svn_credential)
        mock_provider = MagicMock()
        mock_provider.replace_file.side_effect = RuntimeError("SVN 连接失败")
        monkeypatch.setattr("apps.package.services.svn.get_provider", lambda vendor, url, cred: mock_provider)

        results = PackageService.sync_release_docs_to_svn(release)

        assert len(results) == 1
        assert results[0]["ok"] is False
        assert "SVN 连接失败" in results[0]["error"]

    def test_skip_unpushed_tasks(self, project, repository, release, svn_credential, monkeypatch):
        """未成功推送 SVN 的任务跳过。"""
        image = PackageImage.objects.create(name="Web 镜像", image="trace-ship/web:latest")
        config = PackageConfig.objects.create(
            project=project, repository=repository, name="Web 打包", image=image,
        )
        PackageTask.objects.create(
            config=config,
            release=release,
            project=project,
            repository=repository,
            name="未推送任务",
            version=release.version,
            tag_name=release.tag_name,
            status="success",
            config_snapshot={"svn_push_enabled": True},
            stage_info={},
        )
        mock_provider = MagicMock()
        monkeypatch.setattr("apps.package.services.svn.get_provider", lambda vendor, url, cred: mock_provider)

        results = PackageService.sync_release_docs_to_svn(release)

        assert results == []
        mock_provider.replace_file.assert_not_called()

    def test_skip_empty_doc(self, project, repository, release, svn_credential, monkeypatch):
        """发布文档为空时不执行同步。"""
        self._make_pushed_task(project, repository, release, svn_credential)
        release.release_doc = ""
        release.save(update_fields=["release_doc"])
        mock_provider = MagicMock()
        monkeypatch.setattr("apps.package.services.svn.get_provider", lambda vendor, url, cred: mock_provider)

        results = PackageService.sync_release_docs_to_svn(release)

        assert results == []
        mock_provider.replace_file.assert_not_called()

    def test_sync_multiple_tasks_all_replaced(
        self, project, repository, release, svn_credential, monkeypatch
    ):
        """多个已推送任务全部替换（并行执行）。"""
        self._make_pushed_task(project, repository, release, svn_credential, remote_url="svn://host/releases/V1.0.0")
        self._make_pushed_task(project, repository, release, svn_credential, remote_url="svn://host/releases/V1.0.0-rc")
        mock_provider = MagicMock()
        monkeypatch.setattr("apps.package.services.svn.get_provider", lambda vendor, url, cred: mock_provider)

        results = PackageService.sync_release_docs_to_svn(release)

        assert len(results) == 2
        assert all(r["ok"] for r in results)
        assert {r["remote_url"] for r in results} == {
            "svn://host/releases/V1.0.0",
            "svn://host/releases/V1.0.0-rc",
        }
        assert mock_provider.replace_file.call_count == 2


@pytest.mark.django_db
def test_update_doc_returns_svn_sync_results(
    api_client, project, repository, release, svn_credential
):
    """修改发布文档接口返回 SVN 同步结果字段（无已推送任务时为空列表）。"""
    resp = api_client.post(
        f"/api/releases/{release.id}/update-doc/",
        {"release_doc": "# 新发布说明"},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.data["code"] == 0
    assert resp.data["data"]["svn_sync_results"] == []
    release.refresh_from_db()
    assert release.release_doc == "# 新发布说明"


@pytest.mark.django_db
def test_update_doc_logs_svn_sync_failure(
    api_client, project, repository, release, svn_credential, monkeypatch
):
    """SVN 文档同步失败时记入操作日志（便于追溯）。"""
    from apps.system.models import OperationLog

    image = PackageImage.objects.create(name="Web 镜像", image="trace-ship/web:latest")
    config = PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="Web 打包",
        image=image,
        svn_push_enabled=True,
        svn_url="svn://host/releases",
        svn_credential=svn_credential,
        svn_path_template="{version}",
    )
    PackageTask.objects.create(
        config=config,
        release=release,
        project=project,
        repository=repository,
        name="Web 打包",
        version=release.version,
        tag_name=release.tag_name,
        status="success",
        config_snapshot={
            "svn_push_enabled": True,
            "svn_url": "svn://host/releases",
            "svn_credential_id": str(svn_credential.id),
            "svn_path_template": "{version}",
        },
        stage_info={"svn_push": {"status": "success", "remote_url": "svn://host/releases/V1.0.0"}},
    )
    mock_provider = MagicMock()
    mock_provider.replace_file.side_effect = RuntimeError("SVN 连接失败")
    monkeypatch.setattr("apps.package.services.svn.get_provider", lambda vendor, url, cred: mock_provider)

    resp = api_client.post(
        f"/api/releases/{release.id}/update-doc/",
        {"release_doc": "# 新发布说明"},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.data["data"]["svn_sync_results"][0]["ok"] is False

    logs = OperationLog.objects.filter(
        resource_id=str(release.id), action="update_doc", result="failure"
    )
    assert logs.exists()
    detail = logs.first().detail
    assert detail["svn_sync_failed"][0]["error"] == "SVN 连接失败"
