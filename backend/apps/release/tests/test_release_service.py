"""
发布服务单元测试
"""
from datetime import UTC

import pytest
from django.utils import timezone
from rest_framework import serializers

from apps.release.services import ReleaseService
from utils.provider.exceptions import NotFoundError
from utils.provider.base import TagInfo
from utils.provider.exceptions import ProviderError

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
    from datetime import datetime

    from utils.provider.base import CommitInfo
    return CommitInfo(
        hash=hash,
        author="开发者",
        author_email="",
        message=message,
        committed_at=datetime(2026, 8, 1, 10, 0, 0, tzinfo=UTC),
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


def test_preview_changes_keeps_unparsed_commits_and_parses_fix_feat(repository, monkeypatch):
    """预览保留完整提交区间，普通提交供前端人工录入，fix/feat 自动解析。"""
    from utils.provider.base import TagInfo

    class FakeProvider:
        def list_tags(self, repo_identity):
            return [TagInfo(name="VA.1.0.0_20260701", commit_hash="taghash")]

        def list_commits(self, repo_identity, branch, since=None, until=None, per_page=100):
            return [
                _make_commit("feat1", "feat: 新增发布扫描"),
                _make_commit("manual1", "提交 A 功能"),
                _make_commit("manual2", "修改 B 功能"),
                _make_commit("taghash", "old commit before tag"),
            ]

        def list_merge_requests(self, repo_identity, target_branch, since=None):
            return []

    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: FakeProvider())
    result = ReleaseService.preview_changes(repository, "main")

    assert [commit["hash"] for commit in result["commits"]] == ["feat1", "manual1", "manual2"]
    assert result["parsed_updates"] == [{
        "type": "A", "content": "新增发布扫描", "source": "commit", "source_ref": "feat1",
    }]
    assert [commit["hash"] for commit in result["commits"] if not commit["has_af"]] == [
        "manual1", "manual2",
    ]


def test_preview_changes_falls_back_to_compare_when_tag_not_in_list(repository, monkeypatch):
    """tag commit 不在 100 条提交列表内时，校验为分支祖先后回退到 compare_commits"""
    from utils.provider.base import TagInfo

    compare_called = []

    class FakeProvider:
        def list_tags(self, repo_identity):
            return [TagInfo(name="VA.1.0.0_20260701", commit_hash="veryoldhash")]

        def list_commits(self, repo_identity, branch, since=None, until=None, per_page=100):
            return [_make_commit("new1", AF_MSG)]

        def get_merge_base(self, repo_identity, refs):
            # merge_base 等于 tag commit，说明 tag 是分支祖先，允许回退 compare
            return "veryoldhash"

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


def test_preview_changes_rejects_cross_branch_tag_baseline(repository, monkeypatch):
    """tag commit 不在分支历史上（merge_base 非 tag commit）时，保守取本分支最新提交，不回退 compare"""
    from utils.provider.base import TagInfo

    compare_called = []

    class FakeProvider:
        # 类属性控制 merge_base 返回值，便于切换祖先校验场景
        merge_base_result = "someotherbase"

        def list_tags(self, repo_identity):
            return [TagInfo(name="VA.1.0.0_20260701", commit_hash="otherbranchhash")]

        def list_commits(self, repo_identity, branch, since=None, until=None, per_page=100):
            return [_make_commit("new1", AF_MSG), _make_commit("new2", AF_MSG_2)]

        def get_merge_base(self, repo_identity, refs):
            return self.merge_base_result

        def compare_commits(self, repo_identity, base, head):
            compare_called.append((base, head))
            return [_make_commit("cmp1", AF_MSG), _make_commit("cmp2", AF_MSG_2)]

        def list_merge_requests(self, repo_identity, target_branch, since=None):
            return []

    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: FakeProvider())

    # 场景一：merge_base 不是 tag commit（跨分支 tag），不调用 compare_commits，直接使用本分支最新提交
    FakeProvider.merge_base_result = "someotherbase"
    result = ReleaseService.preview_changes(repository, "main")

    assert compare_called == []
    hashes = [c["hash"] for c in result["commits"]]
    assert "new1" in hashes
    assert "new2" in hashes

    # 场景二：merge_base 等于 tag commit（tag 是分支祖先），回退 compare 取区间差异
    FakeProvider.merge_base_result = "otherbranchhash"
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


def test_preview_changes_uses_latest_tag_of_given_release_type(repository, monkeypatch):
    """preview_changes 按 release_type 取对应类型（formal/rc/beta）的最新 tag 作为基线"""
    from utils.provider.base import TagInfo

    # 仓库同时存在正式与 rc tag，且 rc tag 版本更高（更晚）
    # 注：项目 version_rule 的 beta 后缀配置为 alpha（见 conftest）
    class FakeProvider:
        def list_tags(self, repo_identity):
            return [
                TagInfo(name="VA.1.0.0_20260101", commit_hash="formalhash"),
                TagInfo(name="VA.1.0.5-rc_20260601", commit_hash="rchash"),
                TagInfo(name="VA.1.0.2-alpha_20260201", commit_hash="betahash"),
            ]

        def list_commits(self, repo_identity, branch, since=None, until=None, per_page=100):
            return [
                _make_commit("new1", AF_MSG),
                _make_commit("rchash", AF_MSG),
                _make_commit("formalhash", AF_MSG_2),
            ]

        def get_merge_base(self, repo_identity, refs):
            # beta 场景：merge_base 返回 tag commit，视为分支祖先，允许回退 compare
            return "betahash"

        def compare_commits(self, repo_identity, base, head):
            return []

        def list_merge_requests(self, repo_identity, target_branch, since=None):
            return []

    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: FakeProvider())

    # rc 发布：以最新 -rc tag 为基线，只取 rchash 之后的提交
    result_rc = ReleaseService.preview_changes(repository, "main", release_type="rc")
    assert result_rc["last_tag"] == "VA.1.0.5-rc_20260601"
    hashes_rc = [c["hash"] for c in result_rc["commits"]]
    assert "new1" in hashes_rc
    assert "rchash" not in hashes_rc
    assert "formalhash" not in hashes_rc

    # formal 发布：以最新正式 tag 为基线，取 formalhash 之后的提交（含 rchash 之后的所有提交）
    result_formal = ReleaseService.preview_changes(repository, "main", release_type="formal")
    assert result_formal["last_tag"] == "VA.1.0.0_20260101"
    hashes_formal = [c["hash"] for c in result_formal["commits"]]
    assert "new1" in hashes_formal
    assert "rchash" in hashes_formal
    assert "formalhash" not in hashes_formal

    # beta 发布：以最新 beta 类型（配置后缀为 alpha）tag 为基线，但 beta tag 的 commit 不在提交列表中，回退到 compare_commits（返回空）
    result_beta = ReleaseService.preview_changes(repository, "main", release_type="beta")
    assert result_beta["last_tag"] == "VA.1.0.2-alpha_20260201"
    assert result_beta["commits"] == []


def test_preview_changes_provider_failure_returns_empty(repository, monkeypatch):
    """provider 拉取 tag/提交/MR 均失败时，预览降级为空结果而非抛异常"""
    class BrokenProvider:
        server_url = "https://gitlab.example.com"

        def list_tags(self, repo_identity):
            raise ProviderError("远端不可用")

        def list_commits(self, repo_identity, branch, since=None, until=None, per_page=100):
            raise ProviderError("远端不可用")

        def list_merge_requests(self, repo_identity, target_branch, since=None):
            raise ProviderError("远端不可用")

    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: BrokenProvider())

    result = ReleaseService.preview_changes(repository, "main")

    assert result["last_tag"] is None
    assert result["commits"] == []
    assert result["merge_requests"] == []


def _cached_tags_provider(server_url="https://gitlab.example.com"):
    """构造带 server_url 的 FakeProvider，记录 list_tags 调用次数"""
    class FakeProvider:
        def __init__(self):
            self.server_url = server_url
            self.tags_calls = 0

        def list_tags(self, repo_identity):
            self.tags_calls += 1
            return [TagInfo(name="VA.1.0.0_20260101", commit_hash="a")]

    return FakeProvider()


def test_list_tags_cached_hits_cache_within_ttl():
    """60s 短缓存：同仓库重复请求命中缓存不重复拉取；失效后重新拉取"""
    from django.core.cache import cache

    from apps.release.services import list_tags_cached

    provider = _cached_tags_provider()
    first = list_tags_cached(provider, "group/repo")
    second = list_tags_cached(provider, "group/repo")
    assert first == second
    assert provider.tags_calls == 1

    cache.delete("trace-ship:repo-tags:https://gitlab.example.com:group/repo")
    list_tags_cached(provider, "group/repo")
    assert provider.tags_calls == 2


def test_list_tags_cached_key_is_isolated_by_server_url():
    """缓存键含服务端地址：同一仓库不同 GitLab 地址互不串缓存"""
    from apps.release.services import list_tags_cached

    provider_a = _cached_tags_provider("https://a.example.com")
    provider_b = _cached_tags_provider("https://b.example.com")

    list_tags_cached(provider_a, "group/repo")
    list_tags_cached(provider_b, "group/repo")

    assert provider_a.tags_calls == 1
    assert provider_b.tags_calls == 1


def _make_released(repository, project, user, tag_name="VA.1.0.0_20260814"):
    """直接落库一条已发布记录"""
    from apps.release.models import ReleaseRecord

    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name=tag_name,
        branch="main",
        release_type="formal",
        status="released",
        publisher=user,
        released_at=timezone.now(),
    )


def test_delete_released_tag_success(repository, project, user, mock_git_provider, monkeypatch):
    """删除已发布版本：远端 tag 删除成功且本地记录删除"""
    from apps.release.models import ReleaseRecord

    release = _make_released(repository, project, user)
    mock_git_provider.tags = [TagInfo(name=release.tag_name, commit_hash="head")]
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: mock_git_provider)

    result = ReleaseService.delete_released_tag(release, release.tag_name, request_user=user)

    assert result["tag_name"] == release.tag_name
    assert result["remote_deleted"] is True
    assert mock_git_provider.tags == []
    assert not ReleaseRecord.objects.filter(id=release.id).exists()


def test_delete_released_tag_requires_released_status(repository, project, user, mock_git_provider, monkeypatch):
    """非 released 状态不允许删除"""
    from apps.release.models import ReleaseRecord

    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="draft",
        publisher=user,
    )
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: mock_git_provider)

    with pytest.raises(serializers.ValidationError, match="仅已发布状态可删除版本"):
        ReleaseService.delete_released_tag(release, release.tag_name, request_user=user)
    assert ReleaseRecord.objects.filter(id=release.id).exists()


def test_delete_released_tag_requires_matching_tag_name(repository, project, user, mock_git_provider, monkeypatch):
    """输入的 tag 名称与发布记录不一致时拒绝删除"""
    from apps.release.models import ReleaseRecord

    release = _make_released(repository, project, user)
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: mock_git_provider)

    with pytest.raises(serializers.ValidationError, match="输入的 Tag 名称与发布版本不一致"):
        ReleaseService.delete_released_tag(release, "VA.9.9.9_99999999", request_user=user)
    assert ReleaseRecord.objects.filter(id=release.id).exists()


def test_delete_released_tag_tolerates_missing_remote_tag(repository, project, user, mock_git_provider, monkeypatch):
    """远端 tag 已不存在时幂等删除本地记录并标记 remote_deleted=False"""
    from apps.release.models import ReleaseRecord

    release = _make_released(repository, project, user)

    def raise_not_found(repo_identity, tag_name):
        raise NotFoundError(f"tag 不存在: {tag_name}")

    mock_git_provider.delete_tag = raise_not_found
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: mock_git_provider)

    result = ReleaseService.delete_released_tag(release, release.tag_name, request_user=user)

    assert result["remote_deleted"] is False
    assert not ReleaseRecord.objects.filter(id=release.id).exists()


def test_delete_released_tag_provider_error_keeps_record(repository, project, user, mock_git_provider, monkeypatch):
    """远端删除失败（认证/连接错误）时保留本地记录并抛出异常"""
    from apps.release.models import ReleaseRecord

    release = _make_released(repository, project, user)

    def raise_provider_error(repo_identity, tag_name):
        raise ProviderError("远端不可用")

    mock_git_provider.delete_tag = raise_provider_error
    monkeypatch.setattr(ReleaseService, "_get_provider", lambda repo, request_user=None: mock_git_provider)

    with pytest.raises(ProviderError):
        ReleaseService.delete_released_tag(release, release.tag_name, request_user=user)
    assert ReleaseRecord.objects.filter(id=release.id).exists()
