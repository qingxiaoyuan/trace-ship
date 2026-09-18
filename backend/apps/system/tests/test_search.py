"""
全局聚合搜索接口测试（GET /api/search/?q=）

覆盖四类场景：命中、无命中、权限隔离（非成员搜不到）、q 为空。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.package.models import PackageConfig, PackageTask
from apps.project.models import Project, ProjectComponent, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository
from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask

pytestmark = pytest.mark.django_db


@pytest.fixture
def user():
    """项目成员用户"""
    return User.objects.create_user(username="searchuser", password="testpass", nickname="搜索用户")


@pytest.fixture
def outsider():
    """非项目成员用户（用于权限隔离测试）"""
    return User.objects.create_user(username="outsider", password="testpass", nickname="外部用户")


@pytest.fixture
def project(user):
    """测试项目，user 为管理员成员"""
    project = Project.objects.create(code="SEARCH", name="搜索测试项目", leader=user, status=1)
    ProjectMember.objects.create(project=project, user=user, role="manager")
    return project


@pytest.fixture
def repository(project, user):
    """测试仓库，并通过组件挂到项目下"""
    repo = Repository.objects.create(
        repo_type="git",
        vendor="gitlab",
        name="搜索后端仓库",
        url="https://gitlab.example.com/search/backend.git",
        external_identity="search/backend",
        default_branch="develop",
        created_by=user,
    )
    ProjectComponent.objects.create(
        project=project,
        repository=repo,
        component_code="backend",
        display_name="后端组件",
        is_active=True,
    )
    return repo


@pytest.fixture
def release(project, repository, user):
    """测试发布记录"""
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="V1.2.0",
        tag_name="V1.2.0",
        branch="develop",
        release_type="formal",
        status="pending",
        publisher=user,
    )


@pytest.fixture
def workflow_instance(repository, project, release, user):
    """关联发布记录的流程实例"""
    definition = WorkflowDefinition.objects.create(
        repository=repository,
        project=project,
        name="正式发布审批",
        biz_type="release",
        node_config=[
            {"node_id": "approval_1", "node_name": "仓库拥有者审批", "mode": "any", "approvers": [{"type": "repo_owner"}]},
        ],
        is_active=True,
        created_by=user,
    )
    return WorkflowInstance.objects.create(
        definition=definition,
        biz_type="release",
        biz_id=str(release.id),
        status="running",
        current_node_id="approval_1",
        created_by=user,
    )


@pytest.fixture
def package_task(project, repository, user):
    """测试打包任务"""
    component = ProjectComponent.objects.get(project=project, repository=repository)
    config = PackageConfig.objects.create(
        project_component=component,
        name="后端打包配置",
        executor_type="local_docker",
    )
    return PackageTask.objects.create(
        config=config,
        project=project,
        repository=repository,
        triggered_by=user,
        name="后端打包任务",
        version="V1.2.0",
        tag_name="V1.2.0",
        status="success",
    )


def _authed_client(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_search_hit_all_groups(user, project, repository, release, workflow_instance, package_task):
    """成员按关键词搜索，五个分组均能命中并返回预期字段"""
    client = _authed_client(user)
    response = client.get("/api/search/", {"q": "搜索"})
    assert response.status_code == 200
    data = response.data["data"]
    assert [item["id"] for item in data["projects"]] == [str(project.id)]
    assert data["projects"][0]["path"] == f"/projects/{project.id}"
    assert [item["id"] for item in data["repositories"]] == [str(repository.id)]
    assert data["repositories"][0]["subtitle"] == "GitLab · develop"

    # 版本号关键词命中发布、审批单、打包任务
    response = client.get("/api/search/", {"q": "V1.2"})
    data = response.data["data"]
    assert [item["id"] for item in data["releases"]] == [str(release.id)]
    assert data["releases"][0]["path"] == f"/releases/{release.id}"
    assert [item["id"] for item in data["workflows"]] == [str(workflow_instance.id)]
    assert data["workflows"][0]["path"] == f"/workflows/{workflow_instance.id}"
    assert "V1.2.0" in data["workflows"][0]["name"]

    # 配置名关键词命中打包任务
    response = client.get("/api/search/", {"q": "后端打包"})
    data = response.data["data"]
    assert [item["id"] for item in data["packages"]] == [str(package_task.id)]
    assert data["packages"][0]["path"] == f"/packages/{package_task.id}"


def test_search_no_hit(user, project, repository, release, workflow_instance, package_task):
    """无命中关键词时各分组均为空数组"""
    client = _authed_client(user)
    response = client.get("/api/search/", {"q": "不存在的关键词xyz"})
    assert response.status_code == 200
    data = response.data["data"]
    assert data == {"projects": [], "repositories": [], "releases": [], "workflows": [], "packages": []}


def test_search_permission_isolation(outsider, project, repository, release, workflow_instance, package_task):
    """非项目成员搜不到该项目下的任何数据"""
    client = _authed_client(outsider)
    response = client.get("/api/search/", {"q": "V1.2"})
    assert response.status_code == 200
    data = response.data["data"]
    assert data == {"projects": [], "repositories": [], "releases": [], "workflows": [], "packages": []}

    response = client.get("/api/search/", {"q": "搜索"})
    data = response.data["data"]
    assert data["projects"] == []
    assert data["repositories"] == []


def test_search_includes_specified_approver_workflows(outsider, release, workflow_instance):
    """指定审批人不是项目成员时，仍能按版本号搜到自己的审批单"""
    WorkflowTask.objects.create(
        instance=workflow_instance,
        node_id="approval_1",
        node_name="指定人员审批",
        approver=outsider,
        mode="any",
        status="pending",
    )
    client = _authed_client(outsider)
    response = client.get("/api/search/", {"q": "V1.2"})
    assert response.status_code == 200
    data = response.data["data"]
    assert [item["id"] for item in data["workflows"]] == [str(workflow_instance.id)]
    assert data["releases"] == []
    assert data["projects"] == []


def test_search_empty_query_returns_empty_groups(user, project, repository):
    """q 为空 / 未传时各分组返回空数组"""
    client = _authed_client(user)
    for params in ({}, {"q": ""}, {"q": "   "}):
        response = client.get("/api/search/", params)
        assert response.status_code == 200
        assert response.data["data"] == {
            "projects": [], "repositories": [], "releases": [], "workflows": [], "packages": [],
        }


def test_search_requires_authentication():
    """未登录访问返回 401/403"""
    response = APIClient().get("/api/search/", {"q": "搜索"})
    assert response.status_code in (401, 403)
