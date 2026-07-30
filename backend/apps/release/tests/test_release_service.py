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
