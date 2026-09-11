"""
发布权限矩阵测试

覆盖项目成员角色对发布创建/删除操作的权限控制：
- 创建/编辑：developer 及以上
- 删除：manager 任意草稿/已驳回；developer 仅本人草稿
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository


def auth_client(user):
    """构造已认证客户端"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def manager_user():
    return User.objects.create_user(username="rel_manager", password="pass")


@pytest.fixture
def developer_user():
    return User.objects.create_user(username="rel_developer", password="pass")


@pytest.fixture
def viewer_user():
    return User.objects.create_user(username="rel_viewer", password="pass")


@pytest.fixture
def project(manager_user, developer_user, viewer_user):
    """包含管理员/开发/只读三种成员的项目"""
    project = Project.objects.create(
        code="RELPERM", name="发布权限项目", leader=manager_user, status=1,
    )
    ProjectMember.objects.create(project=project, user=manager_user, role="manager")
    ProjectMember.objects.create(project=project, user=developer_user, role="developer")
    ProjectMember.objects.create(project=project, user=viewer_user, role="viewer")
    return project


@pytest.fixture
def repository(project):
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="后端仓库",
        url="https://gitlab.example.com",
        external_identity="group/backend",
        default_branch="main",
    )


def _make_release(project, repository, publisher, status="draft", version="VA.1.0.0"):
    """直接落库一条发布记录"""
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version=version,
        tag_name=f"{version}_20260731",
        branch="main",
        release_type="formal",
        status=status,
        publisher=publisher,
    )


@pytest.mark.django_db
def test_viewer_cannot_create_release(project, repository, viewer_user):
    """只读成员不能创建发布（创建需 developer 及以上）"""
    response = auth_client(viewer_user).post("/api/releases/", {
        "project": str(project.id),
        "repository": str(repository.id),
        "branch": "main",
        "release_type": "formal",
    }, format="json")

    assert response.status_code == 403


@pytest.mark.django_db
def test_viewer_cannot_delete_release(project, repository, viewer_user, developer_user):
    """只读成员不能删除发布"""
    release = _make_release(project, repository, developer_user)
    response = auth_client(viewer_user).delete(f"/api/releases/{release.id}/")

    assert response.status_code == 403


@pytest.mark.django_db
def test_developer_can_delete_own_draft(project, repository, developer_user):
    """开发人员可删除本人创建的草稿"""
    release = _make_release(project, repository, developer_user)
    response = auth_client(developer_user).delete(f"/api/releases/{release.id}/")

    assert response.status_code == 200
    assert not ReleaseRecord.objects.filter(id=release.id).exists()


@pytest.mark.django_db
def test_developer_cannot_delete_others_draft(project, repository, developer_user, manager_user):
    """开发人员不能删除他人创建的草稿"""
    release = _make_release(project, repository, manager_user)
    response = auth_client(developer_user).delete(f"/api/releases/{release.id}/")

    assert response.status_code == 403
    assert response.data["code"] == 40300
    assert ReleaseRecord.objects.filter(id=release.id).exists()


@pytest.mark.django_db
def test_developer_cannot_delete_own_rejected(project, repository, developer_user):
    """开发人员不能删除本人的已驳回记录（仅草稿可删）"""
    release = _make_release(project, repository, developer_user, status="rejected")
    response = auth_client(developer_user).delete(f"/api/releases/{release.id}/")

    assert response.status_code == 403
    assert ReleaseRecord.objects.filter(id=release.id).exists()


@pytest.mark.django_db
def test_manager_can_delete_others_rejected(project, repository, manager_user, developer_user):
    """管理员可删除他人的已驳回记录"""
    release = _make_release(project, repository, developer_user, status="rejected")
    response = auth_client(manager_user).delete(f"/api/releases/{release.id}/")

    assert response.status_code == 200
    assert not ReleaseRecord.objects.filter(id=release.id).exists()


@pytest.mark.django_db
def test_leader_without_membership_can_delete_rejected():
    """
    项目负责人（leader，无成员记录）视同 manager 可删除已驳回发布

    覆盖 destroy 复用 IsProjectManager 后 leader 等价语义不被走样。
    """
    leader = User.objects.create_user(username="rel_leader_only", password="pass")
    project = Project.objects.create(
        code="RELLEAD", name="Leader 发布项目", leader=leader, status=1,
    )
    repository = Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="Leader 仓库",
        url="https://gitlab.example.com",
        external_identity="group/lead",
        default_branch="main",
    )
    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VL.1.0.0",
        tag_name="VL.1.0.0_20260731",
        branch="main",
        release_type="formal",
        status="rejected",
        publisher=leader,
    )

    response = auth_client(leader).delete(f"/api/releases/{release.id}/")

    assert response.status_code == 200
    assert not ReleaseRecord.objects.filter(id=release.id).exists()


@pytest.mark.django_db
def test_viewer_cannot_delete_released(project, repository, viewer_user, manager_user):
    """只读成员不能删除已发布版本"""
    release = _make_release(project, repository, manager_user, status="released")
    response = auth_client(viewer_user).post(
        f"/api/releases/{release.id}/delete-released/",
        {"tag_name": release.tag_name},
        format="json",
    )

    assert response.status_code == 403
    assert ReleaseRecord.objects.filter(id=release.id).exists()


@pytest.mark.django_db
def test_developer_cannot_delete_released(project, repository, developer_user, manager_user):
    """项目开发成员不能删除已发布版本（需项目管理员）"""
    release = _make_release(project, repository, manager_user, status="released")
    response = auth_client(developer_user).post(
        f"/api/releases/{release.id}/delete-released/",
        {"tag_name": release.tag_name},
        format="json",
    )

    assert response.status_code == 403
    assert response.data["code"] == 40300
    assert ReleaseRecord.objects.filter(id=release.id).exists()


@pytest.mark.django_db
def test_manager_can_delete_released(project, repository, manager_user, monkeypatch):
    """项目管理员可删除已发布版本（含远端 tag 删除调用）"""
    from apps.release.services import ReleaseService

    release = _make_release(project, repository, manager_user, status="released")
    deleted = []

    class FakeProvider:
        def delete_tag(self, repo_identity, tag_name):
            deleted.append(tag_name)

    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None, **_kwargs: FakeProvider())

    response = auth_client(manager_user).post(
        f"/api/releases/{release.id}/delete-released/",
        {"tag_name": release.tag_name},
        format="json",
    )

    assert response.status_code == 200
    assert deleted == [release.tag_name]
    assert not ReleaseRecord.objects.filter(id=release.id).exists()
