"""
项目统计接口与 count 字段测试
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import Project, ProjectMember
from apps.repository.models import Repository
from apps.release.models import ReleaseRecord

pytestmark = pytest.mark.django_db


@pytest.fixture
def manager():
    """项目管理员"""
    return User.objects.create_user(username="pmanager", password="pass", nickname="项目经理")


@pytest.fixture
def project(manager):
    """测试项目，含 2 个仓库、2 个成员"""
    project = Project.objects.create(
        code="STAT",
        name="统计项目",
        leader=manager,
        status=1,
        version_rule={"format": "V.{major}.{minor}.{patch}", "initial": "V.1.0.0"},
        release_rule={"formal_branch": "main", "test_prefix": "test", "release_cycle_days": 3},
    )
    ProjectMember.objects.create(project=project, user=manager, role="manager")
    Repository.objects.create(project=project, repo_type="git", name="repo-a", url="https://a")
    Repository.objects.create(project=project, repo_type="git", name="repo-b", url="https://b")
    return project


@pytest.fixture
def client(manager):
    """已认证客户端"""
    c = APIClient()
    c.force_authenticate(user=manager)
    return c


def test_stats_returns_aggregate_counts(client, project):
    """stats 接口返回项目总数 / 启用中 / 关联仓库 / 项目成员聚合数"""
    resp = client.get("/api/projects/stats/")
    assert resp.status_code == 200
    data = resp.data["data"]
    assert data["total"] == 1
    assert data["active_count"] == 1
    assert data["repo_total"] == 2
    assert data["member_total"] == 1


def test_list_returns_repo_and_member_count(client, project):
    """列表项返回 repo_count / member_count"""
    resp = client.get("/api/projects/")
    assert resp.status_code == 200
    results = resp.data["data"]["results"]
    target = next(item for item in results if item["id"] == str(project.id))
    assert target["repo_count"] == 2
    assert target["member_count"] == 1


def test_detail_returns_all_counts(client, project):
    """详情返回仓库 / Jenkins / 成员 / 累计发布四个 count"""
    ReleaseRecord.objects.create(
        project=project,
        repository=project.repositories.first(),
        publisher=project.leader,
        version="V.1.0.0",
        release_type="formal",
        source_branch="develop",
        target_branch="main",
        status="draft",
    )
    resp = client.get(f"/api/projects/{project.id}/")
    assert resp.status_code == 200
    data = resp.data["data"]
    assert data["repo_count"] == 2
    assert data["member_count"] == 1
    assert data["jenkins_count"] == 0
    assert data["release_count"] == 1
