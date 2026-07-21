"""
仓库分支同步测试

覆盖分支同步落库、删除远端已不存在分支、分支列表读取、SVN 拒绝同步等场景。
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from rest_framework.test import APIClient

from apps.repository.models import RepositoryBranch
from utils.provider.base import BranchInfo


def _dt(*args):
    """构造带时区的 datetime，避免 naive datetime 警告"""
    return datetime(*args, tzinfo=timezone.utc)


@pytest.fixture
def api_client(user):
    """已认证 APIClient"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_provider(branches):
    """构造 mock provider，list_branches 返回指定分支列表"""
    mock = MagicMock()
    mock.list_branches.return_value = branches
    mock.get_commit.return_value = MagicMock(
        author="兜底作者", committed_at=_dt(2026, 7, 1, 10, 0, 0), message="兜底信息"
    )
    return mock


@pytest.mark.django_db
def test_sync_branches_persists_to_db(api_client, repository):
    """测试同步分支落库，包含作者/时间/信息"""
    branches = [
        BranchInfo(
            name="main",
            is_default=True,
            last_commit_hash="h1",
            last_commit_author="张三",
            last_commit_message="feat: 初始化",
            last_commit_at=_dt(2026, 7, 10, 10, 0, 0),
        ),
        BranchInfo(
            name="develop",
            is_default=False,
            last_commit_hash="h2",
            last_commit_author="李四",
            last_commit_message="fix: 修复",
            last_commit_at=_dt(2026, 7, 11, 12, 0, 0),
        ),
    ]
    with patch("apps.repository.services.get_provider", return_value=_make_provider(branches)):
        response = api_client.post(f"/api/repositories/{repository.id}/sync-branches/")

    assert response.status_code == 200
    assert response.data["code"] == 0
    assert response.data["data"]["synced_count"] == 2

    # 默认分支排在前面
    saved = list(RepositoryBranch.objects.filter(repository=repository).order_by("-is_default"))
    assert len(saved) == 2
    assert saved[0].name == "main"
    assert saved[0].is_default is True
    assert saved[0].last_commit_author == "张三"
    assert saved[0].last_commit_message == "feat: 初始化"
    assert saved[0].last_commit_at is not None
    assert saved[1].name == "develop"
    assert saved[1].last_commit_author == "李四"


@pytest.mark.django_db
def test_sync_branches_removes_deleted_remote_branch(api_client, repository):
    """测试同步时删除远端已不存在的分支"""
    # 先同步两个分支
    branches = [
        BranchInfo(name="main", is_default=True, last_commit_hash="h1", last_commit_author="张三",
                   last_commit_message="m1", last_commit_at=_dt(2026, 7, 10)),
        BranchInfo(name="feature/x", is_default=False, last_commit_hash="h2", last_commit_author="李四",
                   last_commit_message="m2", last_commit_at=_dt(2026, 7, 11)),
    ]
    with patch("apps.repository.services.get_provider", return_value=_make_provider(branches)):
        api_client.post(f"/api/repositories/{repository.id}/sync-branches/")
    assert RepositoryBranch.objects.filter(repository=repository).count() == 2

    # 再次同步，远端只剩 main（feature/x 被删）
    branches2 = [
        BranchInfo(name="main", is_default=True, last_commit_hash="h3", last_commit_author="张三",
                   last_commit_message="m3", last_commit_at=_dt(2026, 7, 12)),
    ]
    with patch("apps.repository.services.get_provider", return_value=_make_provider(branches2)):
        api_client.post(f"/api/repositories/{repository.id}/sync-branches/")

    names = set(RepositoryBranch.objects.filter(repository=repository).values_list("name", flat=True))
    assert names == {"main"}
    # main 的 hash 更新为最新
    main = RepositoryBranch.objects.get(repository=repository, name="main")
    assert main.last_commit_hash == "h3"


@pytest.mark.django_db
def test_sync_branches_fallback_get_commit(api_client, repository):
    """测试分支接口未返回作者/时间时，按 hash 调 get_commit 补全"""
    branches = [
        BranchInfo(name="main", is_default=True, last_commit_hash="h1",
                   last_commit_author="", last_commit_message="", last_commit_at=None),
    ]
    mock_provider = _make_provider(branches)
    mock_provider.get_commit.return_value = MagicMock(
        author="补全作者", committed_at=_dt(2026, 7, 1, 9, 0, 0), message="补全信息"
    )
    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        api_client.post(f"/api/repositories/{repository.id}/sync-branches/")

    branch = RepositoryBranch.objects.get(repository=repository, name="main")
    assert branch.last_commit_author == "补全作者"
    assert branch.last_commit_message == "补全信息"
    assert branch.last_commit_at is not None
    mock_provider.get_commit.assert_called_once()


@pytest.mark.django_db
def test_branches_action_reads_db(api_client, repository):
    """测试 branches 接口从本地数据库读取"""
    RepositoryBranch.objects.create(
        repository=repository,
        name="main",
        is_default=True,
        last_commit_hash="h1",
        last_commit_author="张三",
        last_commit_message="feat: 初始化",
        last_commit_at=_dt(2026, 7, 10, 10, 0, 0),
    )
    response = api_client.get(f"/api/repositories/{repository.id}/branches/")
    assert response.status_code == 200
    assert response.data["code"] == 0
    data = response.data["data"]
    assert len(data) == 1
    assert data[0]["name"] == "main"
    assert data[0]["is_default"] is True
    assert data[0]["last_commit_author"] == "张三"
    assert data[0]["last_commit_at"] is not None


@pytest.mark.django_db
def test_branches_action_empty_when_not_synced(api_client, repository):
    """测试未同步时分支列表为空"""
    response = api_client.get(f"/api/repositories/{repository.id}/branches/")
    assert response.status_code == 200
    assert response.data["data"] == []


@pytest.mark.django_db
def test_sync_branches_rejects_svn(api_client, project, credential, user):
    """测试 SVN 仓库拒绝分支同步"""
    from apps.repository.models import Repository

    svn_repo = Repository.objects.create(
        project=project,
        repo_type="svn",
        vendor="svn",
        name="SVN 仓库",
        url="http://svn.example.com/svn/test",
        external_identity="test",
        default_branch="trunk",
        credential=credential,
        credential_mode="project",
    )
    response = api_client.post(f"/api/repositories/{svn_repo.id}/sync-branches/")
    assert response.status_code == 400
    assert response.data["code"] == 40001
    assert RepositoryBranch.objects.filter(repository=svn_repo).count() == 0
