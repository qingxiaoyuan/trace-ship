"""打包视图接口测试。"""
from io import BytesIO
from pathlib import Path
import zipfile

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
