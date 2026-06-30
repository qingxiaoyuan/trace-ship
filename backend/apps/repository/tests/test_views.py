"""
仓库视图测试

覆盖仓库列表、创建、vendor 校验、commit 同步以及提交复核接口。
"""
import pytest
from unittest.mock import patch
from rest_framework.test import APIClient

from apps.repository.models import CommitRecord


@pytest.fixture
def api_client(user):
    """已认证 APIClient"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_list_repositories(api_client, repository):
    """测试仓库列表接口"""
    response = api_client.get("/api/repositories/")
    assert response.status_code == 200
    assert response.data["code"] == 0
    assert response.data["data"]["total"] == 1


@pytest.mark.django_db
def test_create_repository(api_client, project, credential):
    """测试创建仓库"""
    payload = {
        "project": str(project.id),
        "repo_type": "git",
        "vendor": "gitlab",
        "name": "前端仓库",
        "url": "https://gitlab.example.com/test/frontend.git",
        "external_identity": "test/frontend",
        "default_branch": "main",
        "credential": str(credential.id),
        "credential_mode": "project",
    }
    response = api_client.post("/api/repositories/", payload, format="json")
    assert response.status_code == 201
    assert response.data["code"] == 0
    assert response.data["data"]["name"] == "前端仓库"


@pytest.mark.django_db
def test_create_repository_rejects_invalid_vendor(api_client, project, credential):
    """测试 Git 仓库拒绝 SVN vendor"""
    payload = {
        "project": str(project.id),
        "repo_type": "git",
        "vendor": "svn",
        "name": "错误仓库",
        "url": "https://gitlab.example.com/test/wrong.git",
        "external_identity": "test/wrong",
        "default_branch": "main",
        "credential": str(credential.id),
        "credential_mode": "project",
    }

    response = api_client.post("/api/repositories/", payload, format="json")

    assert response.status_code == 400
    assert "vendor" in response.data["data"]


@pytest.mark.django_db
def test_sync_commits(api_client, repository):
    """测试手动同步 commits"""
    fake_commit = type("CommitInfo", (), {
        "hash": "def456",
        "author": "李四",
        "author_email": "",
        "message": "变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A yyy",
        "committed_at": None,
    })()
    with patch("apps.repository.services.RepositoryService.list_commits", return_value=[fake_commit]):
        response = api_client.post(
            f"/api/repositories/{repository.id}/sync-commits/",
            {"branch": "develop"},
            format="json",
        )
    assert response.status_code == 200
    assert response.data["code"] == 0
    assert response.data["data"]["synced_count"] == 1
    assert CommitRecord.objects.filter(commit_hash="def456").exists()


@pytest.mark.django_db
def test_commit_review(api_client, commit):
    """测试提交复核"""
    response = api_client.post(
        f"/api/commits/{commit.id}/review/",
        {"review_status": "illegal", "reason": "测试标记"},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["code"] == 0
    assert response.data["data"]["review_status"] == "illegal"


@pytest.mark.django_db
def test_unauthorized_access_other_project(api_client):
    """测试未参与项目时仓库列表为空"""
    # api_client 用户没有 project 2 的权限
    response = api_client.get("/api/repositories/")
    assert response.status_code == 200
    assert response.data["data"]["total"] == 0
