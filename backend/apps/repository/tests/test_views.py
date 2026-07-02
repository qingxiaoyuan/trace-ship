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
def test_repository_commits_returns_data(api_client, repository, commit):
    """测试仓库详情 commits 接口返回该仓库的提交记录"""
    response = api_client.get(f"/api/repositories/{repository.id}/commits/")
    assert response.status_code == 200
    assert response.data["code"] == 0
    results = response.data["data"]["results"]
    assert len(results) == 1
    assert results[0]["commit_hash"] == commit.commit_hash


@pytest.mark.django_db
def test_repository_commits_filter_by_branch(api_client, repository, project):
    """测试仓库详情 commits 接口支持按分支筛选"""
    CommitRecord.objects.create(
        project=project,
        repository=repository,
        commit_hash="main-001",
        author="张三",
        message="feat: main",
        committed_at="2026-06-22T10:00:00+08:00",
        branch="main",
    )
    CommitRecord.objects.create(
        project=project,
        repository=repository,
        commit_hash="dev-001",
        author="李四",
        message="feat: dev",
        committed_at="2026-06-21T10:00:00+08:00",
        branch="develop",
    )
    response = api_client.get(f"/api/repositories/{repository.id}/commits/?branch=main")
    assert response.status_code == 200
    assert response.data["code"] == 0
    results = response.data["data"]["results"]
    assert len(results) == 1
    assert results[0]["commit_hash"] == "main-001"
    assert results[0]["branch"] == "main"


@pytest.mark.django_db
def test_unauthorized_access_other_project(api_client):
    """测试未参与项目时仓库列表为空"""
    # api_client 用户没有 project 2 的权限
    response = api_client.get("/api/repositories/")
    assert response.status_code == 200
    assert response.data["data"]["total"] == 0


@pytest.mark.django_db
def test_review_range_returns_audited_commits(api_client, repository):
    """测试按 Tag 区间拉取并审查提交（不落库）"""
    from datetime import datetime
    from unittest.mock import MagicMock

    from utils.provider.base import CommitInfo, TagInfo

    fake_tags = [
        TagInfo(name="v1.1.0", commit_hash="h2", created_at=datetime(2026, 6, 20, 12, 0, 0)),
        TagInfo(name="v1.0.0", commit_hash="h1", created_at=datetime(2026, 6, 10, 12, 0, 0)),
    ]
    fake_commits = [
        CommitInfo(
            hash="c1",
            author="张三",
            author_email="",
            message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A 新增功能",
            committed_at=datetime(2026, 6, 18, 10, 0, 0),
        ),
        CommitInfo(
            hash="c2",
            author="李四",
            author_email="",
            message="修复登录页样式问题",
            committed_at=datetime(2026, 6, 19, 10, 0, 0),
        ),
    ]
    mock_provider = MagicMock()
    mock_provider.list_tags.return_value = fake_tags
    mock_provider.compare_commits.return_value = fake_commits
    mock_provider.list_merge_requests.return_value = []

    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        response = api_client.get(f"/api/repositories/{repository.id}/review-range/?tag=v1.1.0")

    assert response.status_code == 200
    assert response.data["code"] == 0
    data = response.data["data"]
    # 选 v1.1.0 时，base 应为上一个 tag v1.0.0
    assert data["base"] == "v1.0.0"
    assert data["head"] == "v1.1.0"
    commits = data["commits"]
    assert len(commits) == 2
    # 第一条合规
    assert commits[0]["review_status"] == "pass"
    # 第二条不合规（缺变更类型），归为非法
    assert commits[1]["review_status"] == "illegal"
    # 统计：pass=1, warning=1（illegal 计入 warning）
    assert data["stats"]["pass"] == 1
    assert data["stats"]["warning"] == 1


@pytest.mark.django_db
def test_review_range_latest_uses_branch_head(api_client, repository):
    """测试 tag=latest 时 base 为最新 tag、head 为默认分支"""
    from datetime import datetime
    from unittest.mock import MagicMock

    from utils.provider.base import CommitInfo, TagInfo

    fake_tags = [
        TagInfo(name="v1.1.0", commit_hash="h2", created_at=datetime(2026, 6, 20, 12, 0, 0)),
        TagInfo(name="v1.0.0", commit_hash="h1", created_at=datetime(2026, 6, 10, 12, 0, 0)),
    ]
    mock_provider = MagicMock()
    mock_provider.list_tags.return_value = fake_tags
    mock_provider.compare_commits.return_value = []
    mock_provider.list_merge_requests.return_value = []

    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        response = api_client.get(f"/api/repositories/{repository.id}/review-range/")

    assert response.status_code == 200
    data = response.data["data"]
    assert data["base"] == "v1.1.0"
    assert data["head"] == repository.default_branch
