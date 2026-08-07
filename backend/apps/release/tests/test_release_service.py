"""
发布服务单元测试
"""
import pytest
from django.utils import timezone
from rest_framework import serializers

from apps.release.services import ReleaseService
from utils.provider.exceptions import ProviderError
from utils.provider.base import TagInfo


pytestmark = pytest.mark.django_db

TODAY = timezone.now().strftime("%Y%m%d")


def test_create_release_rejects_existing_tag(repository, project, user, mock_git_provider, monkeypatch):
    """创建发布草稿前校验远端同名 tag（含日期段）。"""
    mock_git_provider.tags = [TagInfo(name=f"VA.1.0.0_{TODAY}", commit_hash="old")]
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: mock_git_provider)
    monkeypatch.setattr(ReleaseService, "_resolve_branch_head_hash", lambda repo, branch, request_user=None: "head")

    with pytest.raises(serializers.ValidationError, match="Tag 已存在"):
        ReleaseService.create_release(
            project=project,
            repository=repository,
            release_type="formal",
            branch="main",
            publisher=user,
            version="VA.1.0.0",
        )


def test_create_release_rejects_existing_tag_after_suffix_normalized(
    repository,
    project,
    user,
    mock_git_provider,
    monkeypatch,
):
    """rc/beta 自动补齐后缀与日期段后按最终 tag 查重。"""
    mock_git_provider.tags = [TagInfo(name=f"VA.1.0.0-alpha_{TODAY}", commit_hash="old")]
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: mock_git_provider)
    monkeypatch.setattr(ReleaseService, "_resolve_branch_head_hash", lambda repo, branch, request_user=None: "head")

    with pytest.raises(serializers.ValidationError, match="Tag 已存在"):
        ReleaseService.create_release(
            project=project,
            repository=repository,
            release_type="beta",
            branch="develop",
            publisher=user,
            version="VA.1.0.0",
        )


def test_push_tag_rejects_release_when_tag_already_exists(
    repository,
    project,
    user,
    mock_git_provider,
    monkeypatch,
):
    """审批后推 tag 前再次查重，发现同名 tag 时发布转为已驳回。"""
    from apps.release.models import ReleaseRecord

    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="pending",
        publisher=user,
    )
    mock_git_provider.tags = [TagInfo(name="VA.1.0.0", commit_hash="old")]
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: mock_git_provider)

    with pytest.raises(serializers.ValidationError, match="Tag 已存在"):
        ReleaseService.push_tag(release, request_user=user)

    release.refresh_from_db()
    assert release.status == "rejected"
    assert "Tag 已存在" in release.rejected_reason


def test_push_tag_keeps_pending_when_tag_check_failed(
    repository,
    project,
    user,
    mock_git_provider,
    monkeypatch,
):
    """推 tag 前查询 tag 失败时不把发布永久驳回，允许后续重试。"""
    from apps.release.models import ReleaseRecord

    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="pending",
        publisher=user,
    )

    def raise_provider_error(repo_identity):
        raise ProviderError("远端临时不可用")

    mock_git_provider.list_tags = raise_provider_error
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: mock_git_provider)

    with pytest.raises(serializers.ValidationError, match="校验 tag 是否存在失败"):
        ReleaseService.push_tag(release, request_user=user)

    release.refresh_from_db()
    assert release.status == "pending"
    assert release.rejected_reason == ""


# ======================== preview_changes 测试 ========================


def _make_commit(hash, message):
    """构造 CommitInfo"""
    from datetime import datetime, timezone as tz
    from utils.provider.base import CommitInfo
    return CommitInfo(
        hash=hash,
        author="开发者",
        author_email="",
        message=message,
        committed_at=datetime(2026, 8, 1, 10, 0, 0, tzinfo=tz.utc),
    )


AF_MSG = "变更类型：\n☑ 无配置项改动\n\n更新内容：\n1. A 新增功能"
AF_MSG_2 = "变更类型：\n☑ 无配置项改动\n\n更新内容：\n1. F 修复问题"


def test_preview_changes_truncates_at_tag_commit(repository, monkeypatch):
    """preview_changes 在 list_commits 结果中找到 tag commit 后正确截断"""
    from utils.provider.base import TagInfo

    class FakeProvider:
        def list_tags(self, repo_identity):
            return [TagInfo(name="VA.1.0.0_20260701", commit_hash="taghash")]

        def list_commits(self, repo_identity, branch, since=None, until=None, per_page=100):
            return [
                _make_commit("new1", AF_MSG),
                _make_commit("new2", AF_MSG_2),
                _make_commit("taghash", "old commit before tag"),
            ]

        def compare_commits(self, repo_identity, base, head):
            return []

        def list_merge_requests(self, repo_identity, target_branch, since=None):
            return []

    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: FakeProvider())
    result = ReleaseService.preview_changes(repository, "main")

    # 只应包含 tag 之后的 2 条提交（new1, new2），不含 taghash
    hashes = [c["hash"] for c in result["commits"]]
    assert "new1" in hashes
    assert "new2" in hashes
    assert "taghash" not in hashes
    assert result["last_tag"] == "VA.1.0.0_20260701"


def test_preview_changes_falls_back_to_compare_when_tag_not_in_list(repository, monkeypatch):
    """tag commit 不在 100 条提交列表内时，回退到 compare_commits"""
    from utils.provider.base import TagInfo

    compare_called = []

    class FakeProvider:
        def list_tags(self, repo_identity):
            return [TagInfo(name="VA.1.0.0_20260701", commit_hash="veryoldhash")]

        def list_commits(self, repo_identity, branch, since=None, until=None, per_page=100):
            return [_make_commit("new1", AF_MSG)]

        def compare_commits(self, repo_identity, base, head):
            compare_called.append((base, head))
            return [_make_commit("cmp1", AF_MSG), _make_commit("cmp2", AF_MSG_2)]

        def list_merge_requests(self, repo_identity, target_branch, since=None):
            return []

    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: FakeProvider())
    result = ReleaseService.preview_changes(repository, "main")

    assert len(compare_called) == 1
    assert compare_called[0][0] == "VA.1.0.0_20260701"
    hashes = [c["hash"] for c in result["commits"]]
    assert "cmp1" in hashes
    assert "cmp2" in hashes


def test_preview_changes_no_tag_uses_all_commits(repository, monkeypatch):
    """无匹配 tag 时，直接使用 list_commits 全部结果"""
    class FakeProvider:
        def list_tags(self, repo_identity):
            return []

        def list_commits(self, repo_identity, branch, since=None, until=None, per_page=100):
            return [_make_commit("c1", AF_MSG), _make_commit("c2", AF_MSG_2)]

        def compare_commits(self, repo_identity, base, head):
            return []

        def list_merge_requests(self, repo_identity, target_branch, since=None):
            return []

    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: FakeProvider())
    result = ReleaseService.preview_changes(repository, "main")

    assert result["last_tag"] is None
    hashes = [c["hash"] for c in result["commits"]]
    assert "c1" in hashes
    assert "c2" in hashes
