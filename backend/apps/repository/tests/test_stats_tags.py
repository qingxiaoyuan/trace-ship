"""
仓库统计与标签接口测试
"""
import pytest
from unittest.mock import patch
from rest_framework.test import APIClient

from apps.repository.models import Repository

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client(user):
    """已认证 APIClient"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def test_stats_returns_aggregate_counts(api_client, project, repository):
    """stats 接口返回仓库总数 / 健康 / Git / SVN 聚合数"""
    # 再加一个 SVN 仓库与一个健康 Git 仓库
    Repository.objects.create(
        project=project,
        repo_type="svn",
        vendor="svn",
        name="配置仓库",
        url="svn://svn.example.com/config",
        external_identity="config",
        default_branch="trunk",
        credential_mode="global",
        health_status="healthy",
    )
    Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="健康仓库",
        url="https://gitlab.example.com/test/healthy.git",
        external_identity="test/healthy",
        default_branch="main",
        credential_mode="global",
        health_status="healthy",
    )

    response = api_client.get("/api/repositories/stats/")
    assert response.status_code == 200
    data = response.data["data"]
    assert data["total"] == 3
    assert data["healthy_count"] == 2
    assert data["git_count"] == 2
    assert data["svn_count"] == 1


def test_tags_returns_git_tags(api_client, repository):
    """Git 仓库返回 provider 提供的标签列表"""
    from utils.provider.base import TagInfo

    fake_tags = [
        TagInfo(name="v1.0.0", commit_hash="abc123"),
        TagInfo(name="v1.1.0", commit_hash="def456"),
    ]
    with patch("apps.repository.services.get_provider") as mock_get:
        mock_provider = mock_get.return_value
        mock_provider.list_tags.return_value = fake_tags
        response = api_client.get(f"/api/repositories/{repository.id}/tags/")

    assert response.status_code == 200
    data = response.data["data"]
    assert len(data) == 2
    assert data[0]["name"] == "v1.0.0"
    assert data[0]["commit_hash"] == "abc123"


def test_tags_returns_empty_for_svn(api_client, project):
    """SVN 仓库标签列表为空"""
    repo = Repository.objects.create(
        project=project,
        repo_type="svn",
        vendor="svn",
        name="SVN 仓库",
        url="svn://svn.example.com/repo",
        external_identity="repo",
        default_branch="trunk",
        credential_mode="global",
    )
    response = api_client.get(f"/api/repositories/{repo.id}/tags/")
    assert response.status_code == 200
    assert response.data["data"] == []
