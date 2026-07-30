"""
仓库分支同步测试

覆盖分支同步落库、删除远端已不存在分支、分支列表读取、SVN 拒绝同步等场景。
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from rest_framework.test import APIClient

from apps.repository.models import RepositoryBranch, RepositoryTag
from utils.provider.base import BranchInfo, TagInfo


def _dt(*args):
    """构造带时区的 datetime，避免 naive datetime 警告"""
    return datetime(*args, tzinfo=timezone.utc)


@pytest.fixture
def api_client(user):
    """已认证 APIClient"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _make_provider(branches, tags=None):
    """构造 mock provider，list_branches/list_tags 返回指定列表"""
    mock = MagicMock()
    mock.list_branches.return_value = branches
    mock.list_tags.return_value = tags or []
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
def test_sync_branches_skips_stale_branches(api_client, repository):
    """测试同步时跳过 3 个月无提交的 stale 分支，默认分支不受限"""
    branches = [
        BranchInfo(name="main", is_default=True, last_commit_hash="h1", last_commit_author="张三",
                   last_commit_message="m1", last_commit_at=_dt(2026, 1, 1)),
        BranchInfo(name="feature/active", is_default=False, last_commit_hash="h2", last_commit_author="李四",
                   last_commit_message="m2", last_commit_at=_dt(2026, 7, 20)),
        BranchInfo(name="feature/stale", is_default=False, last_commit_hash="h3", last_commit_author="王五",
                   last_commit_message="m3", last_commit_at=_dt(2026, 1, 15)),
    ]
    # 预置一条本地 stale 分支，验证同步后会被清除
    RepositoryBranch.objects.create(
        repository=repository, name="feature/stale", last_commit_hash="h3",
        last_commit_author="王五", last_commit_message="m3", last_commit_at=_dt(2026, 1, 15),
    )
    with patch("apps.repository.services.get_provider", return_value=_make_provider(branches)):
        response = api_client.post(f"/api/repositories/{repository.id}/sync-branches/")

    assert response.status_code == 200
    assert response.data["data"]["synced_count"] == 2
    assert response.data["data"]["total"] == 3
    names = set(RepositoryBranch.objects.filter(repository=repository).values_list("name", flat=True))
    # stale 非默认分支被过滤；默认分支即使超过 3 个月也保留
    assert names == {"main", "feature/active"}


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
def test_branches_action_auto_syncs_when_empty(api_client, repository):
    """测试本地无分支数据时自动从远端同步一次并落库"""
    branches = [
        BranchInfo(name="main", is_default=True, last_commit_hash="h1", last_commit_author="张三",
                   last_commit_message="feat: 初始化", last_commit_at=_dt(2026, 7, 10, 10, 0, 0)),
    ]
    mock_provider = _make_provider(branches)
    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        response = api_client.get(f"/api/repositories/{repository.id}/branches/")

    assert response.status_code == 200
    assert response.data["code"] == 0
    data = response.data["data"]
    assert len(data) == 1
    assert data[0]["name"] == "main"
    mock_provider.list_branches.assert_called_once()
    # 自动同步结果已落库
    assert RepositoryBranch.objects.filter(repository=repository, name="main").exists()


@pytest.mark.django_db
def test_branches_action_auto_sync_failure_returns_error(api_client, repository):
    """测试自动同步失败时返回可读错误而非静默空列表"""
    mock_provider = _make_provider([])
    mock_provider.list_branches.side_effect = RuntimeError("远端连接失败")
    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        response = api_client.get(f"/api/repositories/{repository.id}/branches/")

    assert response.status_code == 500
    assert response.data["code"] == 50000
    assert "远端连接失败" in response.data["message"]


@pytest.mark.django_db
def test_branches_action_svn_returns_empty_without_sync(api_client, project, credential):
    """测试 SVN 仓库分支列表为空且不触发远端同步"""
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
    with patch("apps.repository.services.get_provider") as mock_factory:
        response = api_client.get(f"/api/repositories/{svn_repo.id}/branches/")

    assert response.status_code == 200
    assert response.data["data"] == []
    mock_factory.assert_not_called()


@pytest.mark.django_db
def test_sync_branches_also_scans_tags(api_client, repository):
    """测试同步分支时按版本规则扫描 tag，仅正则匹配的入库"""
    repository.project.version_rule = {"prefix": "VB", "suffixes": {"rc": "rc", "beta": "beta"}}
    repository.project.save(update_fields=["version_rule"])
    branches = [
        BranchInfo(name="main", is_default=True, last_commit_hash="h1", last_commit_author="张三",
                   last_commit_message="m1", last_commit_at=_dt(2026, 7, 10)),
    ]
    tags = [
        TagInfo(name="VB.1.1.1_20251014", commit_hash="t1"),
        TagInfo(name="VB.1.1.2-rc_20260816", commit_hash="t2"),
        TagInfo(name="v1.0.0", commit_hash="t3"),
        TagInfo(name="VB.1.1.3_20251340", commit_hash="t4"),
    ]
    with patch("apps.repository.services.get_provider", return_value=_make_provider(branches, tags)):
        response = api_client.post(f"/api/repositories/{repository.id}/sync-branches/")

    assert response.status_code == 200
    assert response.data["data"]["tag_synced_count"] == 2
    assert response.data["data"]["tag_total"] == 4

    saved = {t.name: t for t in RepositoryTag.objects.filter(repository=repository)}
    # 无日期段的 v1.0.0 与非法日期 20251340 均不入库
    assert set(saved) == {"VB.1.1.1_20251014", "VB.1.1.2-rc_20260816"}
    formal = saved["VB.1.1.1_20251014"]
    assert (formal.major, formal.minor, formal.patch) == (1, 1, 1)
    assert formal.suffix == ""
    assert formal.tag_date.isoformat() == "2025-10-14"
    assert formal.commit_hash == "t1"
    rc = saved["VB.1.1.2-rc_20260816"]
    assert rc.suffix == "rc"
    assert rc.tag_date.isoformat() == "2026-08-16"


@pytest.mark.django_db
def test_sync_tags_removes_stale_local_tags(api_client, repository):
    """测试再次同步时清除远端已不存在或不再匹配规则的本地 tag"""
    repository.project.version_rule = {"prefix": "VB", "suffixes": {"rc": "rc", "beta": "beta"}}
    repository.project.save(update_fields=["version_rule"])
    RepositoryTag.objects.create(
        repository=repository, name="VB.9.9.9_20250101", commit_hash="old",
        major=9, minor=9, patch=9, tag_date="2025-01-01",
    )
    RepositoryTag.objects.create(
        repository=repository, name="legacy-tag", commit_hash="old",
    )
    branches = [
        BranchInfo(name="main", is_default=True, last_commit_hash="h1", last_commit_author="张三",
                   last_commit_message="m1", last_commit_at=_dt(2026, 7, 10)),
    ]
    tags = [TagInfo(name="VB.1.0.0_20260701", commit_hash="t1")]
    with patch("apps.repository.services.get_provider", return_value=_make_provider(branches, tags)):
        api_client.post(f"/api/repositories/{repository.id}/sync-branches/")

    names = set(RepositoryTag.objects.filter(repository=repository).values_list("name", flat=True))
    assert names == {"VB.1.0.0_20260701"}


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
