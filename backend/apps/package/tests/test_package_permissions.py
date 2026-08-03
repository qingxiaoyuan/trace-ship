"""
打包权限矩阵测试

覆盖项目成员角色对打包操作的权限控制：
- 触发打包：manager / developer / tester
- 取消任务 / 手动推 SVN：manager / developer
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.package.models import PackageConfig, PackageImage, PackageTask
from apps.package.services import PackageService
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository


def auth_client(user):
    """构造已认证客户端"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def users():
    """四种项目角色用户"""
    return {
        role: User.objects.create_user(username=f"pkg_{role}", password="pass")
        for role in ("manager", "developer", "tester", "viewer")
    }


@pytest.fixture
def project(users):
    """包含四种角色成员的项目"""
    manager = users["manager"]
    project = Project.objects.create(
        code="PKGPERM", name="打包权限项目", leader=manager, status=1,
    )
    for role, user in users.items():
        ProjectMember.objects.create(project=project, user=user, role=role)
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
def release(project, repository, users):
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="V1.0.0",
        tag_name="V1.0.0_20260731",
        branch="main",
        release_type="formal",
        status="released",
        publisher=users["manager"],
    )


@pytest.fixture
def package_config(project, repository):
    image = PackageImage.objects.create(name="Web 镜像", image="trace-ship/web:latest")
    return PackageConfig.objects.create(
        project=project, repository=repository, name="Web 打包", image=image,
    )


@pytest.fixture
def queued_task(package_config, release, project, repository, users):
    """排队中的打包任务"""
    return PackageTask.objects.create(
        config=package_config,
        release=release,
        project=project,
        repository=repository,
        triggered_by=users["manager"],
        name="Web 打包 / V1.0.0",
        build_type="web",
        tag_name="V1.0.0_20260731",
        version="V1.0.0",
        status="queued",
    )


@pytest.fixture
def no_dispatch(monkeypatch):
    """屏蔽打包任务投递，避免测试环境真正执行打包"""
    monkeypatch.setattr(PackageService, "dispatch_task", classmethod(lambda cls, task: None))


@pytest.mark.django_db
def test_tester_can_trigger_package(project, package_config, release, users, no_dispatch):
    """测试角色可手动触发打包"""
    response = auth_client(users["tester"]).post(
        f"/api/packages/configs/{package_config.id}/trigger/",
        {"release_id": str(release.id)},
        format="json",
    )

    assert response.status_code == 201


@pytest.mark.django_db
def test_viewer_cannot_trigger_package(project, package_config, release, users, no_dispatch):
    """只读成员不能触发打包"""
    response = auth_client(users["viewer"]).post(
        f"/api/packages/configs/{package_config.id}/trigger/",
        {"release_id": str(release.id)},
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_developer_can_cancel_task(project, queued_task, users):
    """开发角色可取消打包任务"""
    response = auth_client(users["developer"]).post(
        f"/api/packages/tasks/{queued_task.id}/cancel/"
    )

    assert response.status_code == 200
    queued_task.refresh_from_db()
    assert queued_task.status == "canceled"


@pytest.mark.django_db
def test_tester_cannot_cancel_task(project, queued_task, users):
    """测试角色不能取消打包任务"""
    response = auth_client(users["tester"]).post(
        f"/api/packages/tasks/{queued_task.id}/cancel/"
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_tester_cannot_push_svn(project, queued_task, users):
    """测试角色不能手动推 SVN"""
    response = auth_client(users["tester"]).post(
        f"/api/packages/tasks/{queued_task.id}/push-svn/"
    )

    assert response.status_code == 403
