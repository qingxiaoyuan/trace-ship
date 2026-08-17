"""
打包权限矩阵测试

覆盖项目成员角色对打包操作的权限控制：
- 触发打包：manager / developer / tester
- 取消任务 / 手动推 SVN：manager / developer
- 打包配置增删改：仅 software_admin（软件管理员）
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import Permission, Role, User, UserRole
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
    """五种项目角色用户"""
    return {
        role: User.objects.create_user(username=f"pkg_{role}", password="pass")
        for role in ("manager", "developer", "tester", "viewer", "software_admin")
    }


@pytest.fixture
def project(users):
    """包含五种角色成员的项目（负责人为 manager 用户）"""
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
def image():
    """打包镜像 fixture，被 package_config 与新建配置测试共用"""
    return PackageImage.objects.create(name="Web 镜像", image="trace-ship/web:latest")


@pytest.fixture
def package_config(project, repository, image):
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
def test_tester_can_trigger_branch_package(project, package_config, users, no_dispatch):
    """测试角色可按分支最新代码触发打包。"""
    response = auth_client(users["tester"]).post(
        f"/api/packages/configs/{package_config.id}/trigger-branch/",
        {"branch": "feature/demo"},
        format="json",
    )

    assert response.status_code == 201
    data = response.data["data"]
    assert data["release"] is None
    assert data["name"] == "Web 打包 / feature/demo"
    assert data["version"] == "feature/demo"
    assert data["tag_name"] == "feature/demo"


@pytest.mark.django_db
def test_viewer_cannot_trigger_branch_package(project, package_config, users, no_dispatch):
    """只读成员不能按分支触发打包。"""
    response = auth_client(users["viewer"]).post(
        f"/api/packages/configs/{package_config.id}/trigger-branch/",
        {"branch": "main"},
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_trigger_branch_requires_branch(project, package_config, users, no_dispatch):
    """分支直打包必须指定分支名。"""
    response = auth_client(users["manager"]).post(
        f"/api/packages/configs/{package_config.id}/trigger-branch/",
        {},
        format="json",
    )

    assert response.status_code == 400


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


# ---------------------------------------------------------------------------
# 打包任务删除权限：由系统角色独立分配
# ---------------------------------------------------------------------------

@pytest.fixture
def finished_task(queued_task):
    """已结束任务可作为删除权限的测试目标。"""
    queued_task.status = "success"
    queued_task.save(update_fields=["status"])
    return queued_task


def grant_delete_task_permission(user):
    """通过临时系统角色为用户授予删除打包任务记录权限。"""
    permission, _ = Permission.objects.get_or_create(
        code="package.task.delete",
        defaults={"name": "删除打包任务记录", "module": "package"},
    )
    role = Role.objects.create(name=f"删除任务_{user.username}", code=f"delete_task_{user.username}")
    role.permissions.add(permission)
    UserRole.objects.create(user=user, role=role)


@pytest.mark.django_db
def test_project_manager_cannot_delete_task_without_dedicated_permission(project, finished_task, users):
    """项目管理员不再因项目角色自动获得删除任务记录权限。"""
    response = auth_client(users["manager"]).delete(f"/api/packages/tasks/{finished_task.id}/")

    assert response.status_code == 403
    assert PackageTask.objects.filter(id=finished_task.id).exists()


@pytest.mark.django_db
def test_user_with_dedicated_permission_can_delete_visible_finished_task(project, finished_task, users):
    """拥有独立权限且可见项目的用户可删除已结束任务。"""
    user = users["developer"]
    grant_delete_task_permission(user)

    response = auth_client(user).delete(f"/api/packages/tasks/{finished_task.id}/")

    assert response.status_code == 200, response.data
    assert not PackageTask.objects.filter(id=finished_task.id).exists()


# ---------------------------------------------------------------------------
# 打包配置写权限：项目管理员 / 软件管理员
# ---------------------------------------------------------------------------

def _config_payload(project, repository, image, name="权限测试配置"):
    return {
        "project": str(project.id),
        "repository": str(repository.id),
        "name": name,
        "executor_type": "local_docker",
        "image": str(image.id),
        "build_path": ".",
        "output_path": "dist",
    }


@pytest.mark.django_db
def test_software_admin_can_create_config(project, repository, image, users):
    """软件管理员可创建打包配置"""
    response = auth_client(users["software_admin"]).post(
        "/api/packages/configs/", _config_payload(project, repository, image), format="json",
    )
    assert response.status_code == 200, response.data


@pytest.mark.django_db
def test_manager_can_create_config(project, repository, image, users):
    """项目管理员可创建打包配置"""
    response = auth_client(users["manager"]).post(
        "/api/packages/configs/", _config_payload(project, repository, image), format="json",
    )
    assert response.status_code == 200, response.data


@pytest.mark.django_db
def test_developer_cannot_create_config(project, repository, image, users):
    """开发角色不能创建打包配置"""
    response = auth_client(users["developer"]).post(
        "/api/packages/configs/", _config_payload(project, repository, image), format="json",
    )
    assert response.status_code == 403


@pytest.mark.django_db
def test_tester_viewer_cannot_create_config(project, repository, image, users):
    """测试 / 只读角色不能创建打包配置"""
    for role in ("tester", "viewer"):
        response = auth_client(users[role]).post(
            "/api/packages/configs/", _config_payload(project, repository, image), format="json",
        )
        assert response.status_code == 403


@pytest.mark.django_db
def test_software_admin_can_update_and_delete_config(project, package_config, users):
    """软件管理员可修改/删除打包配置"""
    client = auth_client(users["software_admin"])
    response = client.patch(
        f"/api/packages/configs/{package_config.id}/", {"name": "改名"}, format="json",
    )
    assert response.status_code == 200, response.data
    response = client.delete(f"/api/packages/configs/{package_config.id}/")
    assert response.status_code == 200


@pytest.mark.django_db
def test_manager_can_update_and_delete_config(project, package_config, users):
    """项目管理员可修改/删除打包配置"""
    client = auth_client(users["manager"])
    response = client.patch(
        f"/api/packages/configs/{package_config.id}/", {"name": "改名"}, format="json",
    )
    assert response.status_code == 200, response.data
    response = client.delete(f"/api/packages/configs/{package_config.id}/")
    assert response.status_code == 200


@pytest.mark.django_db
def test_developer_cannot_update_or_delete_config(project, package_config, users):
    """开发角色不能修改/删除打包配置"""
    client = auth_client(users["developer"])
    response = client.patch(
        f"/api/packages/configs/{package_config.id}/", {"name": "改名"}, format="json",
    )
    assert response.status_code == 403
    response = client.delete(f"/api/packages/configs/{package_config.id}/")
    assert response.status_code == 403
