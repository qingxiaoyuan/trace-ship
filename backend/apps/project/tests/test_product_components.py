"""产品组件关系接口测试。"""

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import ProductComponent, Project, ProjectMember
from apps.repository.models import Repository

pytestmark = pytest.mark.django_db


@pytest.fixture
def manager():
    """同时管理两个产品的用户。"""
    return User.objects.create_user(username="component-manager", password="pass")


@pytest.fixture
def developer():
    """只有查看权限的产品开发人员。"""
    return User.objects.create_user(username="component-developer", password="pass")


@pytest.fixture
def products(manager, developer):
    """创建仓库登记产品与复用产品。"""
    source = Project.objects.create(code="SOURCE", name="基础能力", leader=manager)
    target = Project.objects.create(code="TARGET", name="SDK 产品", leader=manager)
    for project in (source, target):
        ProjectMember.objects.create(project=project, user=manager, role="manager")
    ProjectMember.objects.create(project=target, user=developer, role="developer")
    return source, target


@pytest.fixture
def repository(products, manager):
    """创建可被多个产品复用的物理仓库。"""
    source, _target = products
    return Repository.objects.create(
        project=source,
        repo_type="git",
        vendor="gitlab",
        name="中台仓库",
        url="https://gitlab.example.com",
        external_identity="platform/core",
        default_branch="develop",
        created_by=manager,
    )


def auth_client(user):
    """构造已认证 API 客户端。"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_repository_create_api_creates_default_component(manager, products):
    """沿用旧仓库创建接口时，自动补齐所属产品的默认组件。"""
    source, _target = products
    response = auth_client(manager).post(
        "/api/repositories/",
        {
            "project": str(source.id),
            "repo_type": "git",
            "vendor": "gitlab",
            "name": "Web 前端",
            "url": "https://gitlab.example.com/team/web.git",
            "external_identity": "team/web",
            "default_branch": "main",
            "credential_mode": "project",
        },
        format="json",
    )

    assert response.status_code == 201
    component = ProductComponent.objects.get(repository_id=response.data["data"]["id"])
    assert component.project == source
    assert component.component_code == "web"
    assert component.default_branch == "main"


def test_same_repository_can_be_attached_to_another_product(manager, products, repository):
    """同一物理仓库可以被第二个产品配置为组件。"""
    _source, target = products
    response = auth_client(manager).post(
        f"/api/projects/{target.id}/components/",
        {
            "repository": str(repository.id),
            "component_code": "middleware",
            "display_name": "SDK 中台",
            "default_branch": "sdk-release",
        },
        format="json",
    )

    assert response.status_code == 201
    component = ProductComponent.objects.get(project=target, repository=repository)
    assert component.component_code == "middleware"
    assert component.default_branch == "sdk-release"

    list_response = auth_client(manager).get(f"/api/projects/{target.id}/components/")
    assert list_response.status_code == 200
    assert list_response.data["data"][0]["repository_detail"]["name"] == "中台仓库"


def test_remove_component_does_not_delete_repository(manager, products, repository):
    """解除产品组件关系时保留物理仓库。"""
    _source, target = products
    component = ProductComponent.objects.create(
        project=target,
        repository=repository,
        component_code="core",
        display_name="中台",
        default_branch="main",
    )

    response = auth_client(manager).delete(
        f"/api/projects/{target.id}/components/{component.id}/"
    )

    assert response.status_code == 200
    assert not ProductComponent.objects.filter(id=component.id).exists()
    assert Repository.objects.filter(id=repository.id).exists()


def test_developer_cannot_attach_repository(developer, products, repository):
    """普通开发人员可查看组件，但不能维护产品组合。"""
    _source, target = products
    response = auth_client(developer).post(
        f"/api/projects/{target.id}/components/",
        {"repository": str(repository.id)},
        format="json",
    )

    assert response.status_code == 403


def test_repository_project_filter_includes_reused_component(manager, products, repository):
    """旧仓库列表的 project 参数兼容新的产品组件关系。"""
    _source, target = products
    ProductComponent.objects.create(
        project=target,
        repository=repository,
        component_code="core",
        display_name="中台",
        default_branch="main",
    )

    response = auth_client(manager).get(f"/api/repositories/?project={target.id}")

    assert response.status_code == 200
    ids = {item["id"] for item in response.data["data"]["results"]}
    assert str(repository.id) in ids


def test_catalog_keeps_already_linked_repository_for_multiple_roles(manager, products, repository):
    """同一物理仓库已关联后仍可被选为产品内另一个组件角色。"""
    _source, target = products
    client = auth_client(manager)
    before = client.get(f"/api/projects/{target.id}/components/available/")
    assert str(repository.id) in {item["id"] for item in before.data["data"]}

    ProductComponent.objects.create(
        project=target,
        repository=repository,
        component_code="core",
        display_name="中台",
    )
    after = client.get(f"/api/projects/{target.id}/components/available/")
    assert str(repository.id) in {item["id"] for item in after.data["data"]}


def test_delete_registration_project_preserves_shared_repository(products, repository):
    """删除最初登记仓库的产品，不得破坏其他产品正在使用的物理仓库。"""
    source, target = products
    ProductComponent.objects.create(
        project=source,
        repository=repository,
        component_code="source-core",
        display_name="源产品中台",
    )
    target_component = ProductComponent.objects.create(
        project=target,
        repository=repository,
        component_code="sdk-core",
        display_name="SDK 中台",
    )

    source.delete()

    repository.refresh_from_db()
    assert repository.project_id is None
    assert ProductComponent.objects.filter(id=target_component.id).exists()


def test_cannot_attach_repository_when_owner_not_in_product(manager, products):
    """仓库所有者不在目标产品成员中时，不能关联该仓库。"""
    source, target = products
    owner = User.objects.create_user(username="repo-owner", password="pass", nickname="仓库所有者")
    ProjectMember.objects.create(project=source, user=owner, role="developer")
    repository = Repository.objects.create(
        project=source,
        repo_type="git",
        vendor="gitlab",
        name="仅源产品仓库",
        url="https://gitlab.example.com",
        external_identity="platform/owned",
        default_branch="main",
        created_by=owner,
    )

    response = auth_client(manager).post(
        f"/api/projects/{target.id}/components/",
        {"repository": str(repository.id), "component_code": "owned"},
        format="json",
    )

    assert response.status_code == 400
    assert "仓库所有者" in str(response.data)
    assert not ProductComponent.objects.filter(project=target, repository=repository).exists()


def test_can_attach_after_owner_joins_product(manager, products):
    """仓库所有者加入目标产品后即可关联，从而把凭证授权给该产品。"""
    source, target = products
    owner = User.objects.create_user(username="join-owner", password="pass", nickname="待加入所有者")
    ProjectMember.objects.create(project=source, user=owner, role="developer")
    repository = Repository.objects.create(
        project=source,
        repo_type="git",
        vendor="gitlab",
        name="待共享仓库",
        url="https://gitlab.example.com",
        external_identity="platform/shared",
        default_branch="main",
        created_by=owner,
    )
    ProjectMember.objects.create(project=target, user=owner, role="developer")

    response = auth_client(manager).post(
        f"/api/projects/{target.id}/components/",
        {"repository": str(repository.id), "component_code": "shared"},
        format="json",
    )

    assert response.status_code == 201
    assert ProductComponent.objects.filter(project=target, repository=repository).exists()


def test_cannot_remove_owner_while_repository_is_linked(manager, products, repository):
    """仓库所有者仍被当前产品关联时，不能从成员中移除。"""
    _source, target = products
    ProductComponent.objects.create(
        project=target,
        repository=repository,
        component_code="core",
        display_name="中台",
    )
    member = ProjectMember.objects.get(project=target, user=manager)
    response = auth_client(manager).delete(
        f"/api/projects/{target.id}/members/{member.id}/"
    )
    assert response.status_code == 409
    assert ProjectMember.objects.filter(id=member.id).exists()


def test_inactive_component_cannot_create_release(manager, products, repository):
    """停用产品关联后，不能再从该产品对仓库发版本。"""
    from rest_framework import serializers as drf_serializers

    from apps.release.models import ReleaseRecord
    from apps.release.services import ReleaseService

    source, _target = products
    ProductComponent.objects.create(
        project=source,
        repository=repository,
        component_code="core",
        display_name="中台",
        is_active=False,
    )

    with pytest.raises(drf_serializers.ValidationError) as exc:
        ReleaseService.create_release(
            project=source,
            repository=repository,
            release_type="formal",
            branch="main",
            publisher=manager,
            version="VA.1.0.0",
        )
    assert "未在当前产品中启用" in str(exc.value)
    assert not ReleaseRecord.objects.filter(project=source, repository=repository).exists()
