"""通过发布 API 验证正式累计说明使用固定提交区间。"""

from datetime import UTC, datetime

import pytest
from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord
from utils.provider.base import CommitInfo, TagInfo

pytestmark = pytest.mark.django_db
BASE, HEAD = "a" * 40, "b" * 40


@pytest.fixture
def client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def formal(project, repository, user):
    rc = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        publisher=user,
        release_type="rc",
        status="released",
        version="VA.9.0.0",
        tag_name="VA.9.0.0-rc",
        branch="develop",
        git_hash=HEAD,
    )
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        publisher=user,
        release_type="formal",
        status="draft",
        version="VA.1.0.2",
        tag_name="VA.1.0.2",
        branch="develop",
        git_hash=HEAD,
        source_rc=rc,
        source_rc_version=rc.version,
        source_rc_tag=rc.tag_name,
        source_rc_git_hash=HEAD,
    )


@pytest.fixture
def remote(monkeypatch):
    class Remote:
        tags = [TagInfo(name="VA.1.0.1", commit_hash=BASE), TagInfo(name="VA.8.0.0", commit_hash="f" * 40)]
        ancestry = BASE

        def list_tags(self, identity):
            return self.tags

        def get_merge_base(self, identity, refs):
            return self.ancestry

        def list_release_commits(self, identity, base, head):
            if (base, head) != (BASE, HEAD):
                raise AssertionError("必须使用固定提交区间")
            return [
                CommitInfo(
                    hash=HEAD,
                    author="开发",
                    author_email="",
                    message="feat: 累计功能",
                    committed_at=datetime(2026, 10, 1, tzinfo=UTC),
                )
            ]

        def list_release_merge_requests(self, identity):
            return []

        def list_commits(self, *args, **kwargs):
            raise AssertionError("正式说明不能读取分支")

        def compare_commits(self, *args, **kwargs):
            raise AssertionError("正式说明不能用移动 Tag 比较")

    remote = Remote()
    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: remote)
    return remote


def test_generate_formal_notes_uses_highest_lower_version_and_fixed_sha(client, formal, remote):
    response = client.post(f"/api/releases/{formal.id}/generate-doc/", {}, format="json")
    assert response.status_code == 200, response.data
    assert "累计功能" in response.data["data"]
    detail = client.get(f"/api/releases/{formal.id}/").data["data"]
    assert detail["base_tag"] == "VA.1.0.1"
    assert detail["base_git_hash"] == BASE
    assert detail["changes_initialized"] is True
    remote.tags = [TagInfo(name="VA.1.0.1", commit_hash="c" * 40)]
    regenerated = client.post(f"/api/releases/{formal.id}/generate-doc/", {}, format="json")
    assert regenerated.status_code == 200
    assert "累计功能" in regenerated.data["data"]
    commits = client.get(f"/api/releases/{formal.id}/commits/").data["data"]["results"]
    assert len(commits) == 1


def test_formal_preview_includes_all_commits_and_only_proven_mrs(client, formal, remote, monkeypatch):
    from utils.provider.base import MergeRequestInfo

    commits = [
        CommitInfo(
            hash=f"{i:040x}",
            author="开发",
            author_email="",
            message=f"feat: 功能{i}",
            committed_at=datetime(2026, 10, 1, tzinfo=UTC),
        )
        for i in range(1, 13)
    ]
    monkeypatch.setattr(remote, "list_release_commits", lambda *args: commits)
    monkeypatch.setattr(
        remote,
        "list_release_merge_requests",
        lambda *args: [
            MergeRequestInfo(number="1", description="fix: 区间内 MR", merge_commit_sha=commits[0].hash),
            MergeRequestInfo(number="2", description="fix: RC 之后 MR", merge_commit_sha="f" * 40),
            MergeRequestInfo(number="3", description="fix: 无法证明 MR"),
        ],
    )
    result = client.get(f"/api/releases/{formal.id}/changes-preview/")
    assert result.status_code == 200, result.data
    data = result.data["data"]
    assert len(data["commits"]) == 12
    assert len(data["parsed_updates"]) == 13
    assert [mr["number"] for mr in data["merge_requests"]] == ["1"]
    assert "!3" in data["warnings"][0]
    doc = client.post(f"/api/releases/{formal.id}/generate-doc/", {}, format="json").data["data"]
    assert "功能12" in doc and "区间内 MR" in doc
    assert "RC 之后 MR" not in doc and "无法证明 MR" not in doc


@pytest.mark.parametrize("mode", ["first", "same", "fork", "failure"])
def test_formal_boundaries_are_explicit(client, formal, remote, monkeypatch, mode):
    from utils.provider.exceptions import ConnectionError

    if mode == "first":
        remote.tags = []

        def first_history(identity, base, head):
            assert base == "" and head == HEAD
            return [
                CommitInfo(
                    hash=HEAD,
                    author="开发",
                    author_email="",
                    message="feat: 首次完整历史",
                    committed_at=datetime(2026, 10, 1, tzinfo=UTC),
                )
            ]

        monkeypatch.setattr(remote, "list_release_commits", first_history)
    elif mode == "same":
        remote.tags = [TagInfo(name="VA.1.0.1", commit_hash=HEAD)]
    elif mode == "fork":
        remote.ancestry = "c" * 40
    else:

        def fail(*args):
            raise ConnectionError("远端暂不可用")

        monkeypatch.setattr(remote, "list_release_commits", fail)
    preview = client.get(f"/api/releases/{formal.id}/changes-preview/")
    result = client.post(f"/api/releases/{formal.id}/generate-doc/", {}, format="json")
    if mode in ("first", "same"):
        assert preview.status_code == result.status_code == 200
        assert ("首次正式发布" if mode == "first" else "无新增代码") in result.data["data"]
    else:
        assert preview.status_code == result.status_code == (400 if mode == "fork" else 502)
        formal.refresh_from_db()
        assert not formal.changes_initialized and not formal.release_doc


def test_formal_identity_is_readonly_but_notes_are_editable(client, formal, remote):
    doc = client.post(f"/api/releases/{formal.id}/generate-doc/", {}, format="json").data["data"]
    result = client.post(
        f"/api/releases/{formal.id}/update-doc/", {"release_doc": doc.replace(HEAD, "伪造来源")}, format="json"
    )
    assert result.status_code == 400
    result = client.post(
        f"/api/releases/{formal.id}/update-doc/",
        {"release_doc": doc.replace("累计功能", "累计功能（人工补充）")},
        format="json",
    )
    assert result.status_code == 200
    assert "人工补充" in result.data["data"]["release_doc"]


def test_source_change_invalidates_all_formal_changes(client, formal, remote):
    client.post(f"/api/releases/{formal.id}/generate-doc/", {}, format="json")
    new_rc = ReleaseRecord.objects.create(
        project=formal.project,
        repository=formal.repository,
        publisher=formal.publisher,
        release_type="rc",
        status="released",
        version="VA.9.0.1",
        tag_name="VA.9.0.1-rc",
        branch="develop",
        git_hash="c" * 40,
    )
    remote.tags.append(TagInfo(name=new_rc.tag_name, commit_hash=new_rc.git_hash))
    result = client.patch(f"/api/releases/{formal.id}/", {"source_rc": str(new_rc.id)}, format="json")
    assert result.status_code == 200, result.data
    data = result.data["data"]
    assert not data["changes_initialized"] and not data["base_git_hash"] and not data["changes_warnings"]
    assert not data["release_doc"] and not data["base_tag"]
    assert not formal.release_commits.exists() and not formal.release_mrs.exists()


def test_formal_cannot_bypass_range_validation_with_manual_doc(client, formal):
    formal.release_doc = "手动说明"
    formal.save(update_fields=["release_doc"])
    result = client.post(f"/api/releases/{formal.id}/submit-audit/", {}, format="json")
    assert result.status_code == 400
    assert "生成" in result.data["message"]


def test_formal_includes_illegal_commit_and_preserves_submit_gate(client, formal, remote, commit):
    commit.commit_hash = HEAD
    commit.review_status = "illegal"
    commit.save()
    client.post(f"/api/releases/{formal.id}/generate-doc/", {"commit_ids": ["nonexistent"]}, format="json")
    result = client.post(f"/api/releases/{formal.id}/submit-audit/", {}, format="json")
    assert result.status_code == 400
    assert "非法提交" in result.data["message"]


@pytest.mark.parametrize("failure", [None, "second_page", "repeat_page", "jump_page", "mr_failure"])
def test_gitlab_http_pagination_is_complete_or_fails(client, formal, failure):
    """真实 GitLab 适配器接发布 API，仅替代外部 HTTP，验证固定区间与第二页。"""
    import json
    from urllib.parse import parse_qs, urlparse

    import responses

    root = "https://gitlab.example.com/api/v4/projects/release%2Fbackend"

    def commits_callback(request):
        query = parse_qs(urlparse(request.url).query)
        assert query["ref_name"] == [f"{BASE}..{HEAD}"]
        page = int(query["page"][0])
        if page == 2 and failure == "second_page":
            return 503, {}, json.dumps({"message": "unavailable"})
        if failure == "jump_page":
            return 200, {"X-Next-Page": "3"}, json.dumps([{"id": HEAD, "message": "feat: 跳页"}])
        indexes = range(1, 101) if page == 1 or failure == "repeat_page" else [101]
        # 不提供分页头：满页仍应继续探测，不能当作只有第一页。
        return (
            200,
            {},
            json.dumps(
                [
                    {"id": f"{i:040x}", "message": f"feat: HTTP功能{i}", "committed_date": "2026-10-01T00:00:00Z"}
                    for i in indexes
                ]
            ),
        )

    with responses.RequestsMock() as http:
        http.get(f"{root}/repository/tags", json=[{"name": "VA.1.0.1", "commit": {"id": BASE}}])
        http.get(f"{root}/repository/merge_base", json={"id": BASE})
        http.add_callback(responses.GET, f"{root}/repository/commits", callback=commits_callback)
        if failure not in ("second_page", "repeat_page", "jump_page"):
            if failure == "mr_failure":
                http.get(f"{root}/merge_requests", status=503, json={"message": "unavailable"})
            else:
                http.get(
                    f"{root}/merge_requests",
                    json=[{"iid": 1, "description": "fix: 分页MR", "squash_commit_sha": f"{101:040x}"}],
                    headers={"X-Next-Page": "2"},
                )
                http.get(f"{root}/merge_requests", json=[{"iid": 2, "merge_commit_sha": "f" * 40}])
        result = client.post(f"/api/releases/{formal.id}/generate-doc/", {}, format="json")
    if failure:
        assert result.status_code == 502, result.data
        if failure == "jump_page":
            assert "分页异常" in result.data["message"]
        formal.refresh_from_db()
        assert not formal.changes_initialized and not formal.release_commits.exists()
    else:
        assert result.status_code == 200, result.data
        assert "HTTP功能101" in result.data["data"] and "分页MR" in result.data["data"]
        data = client.get(f"/api/releases/{formal.id}/commits/").data["data"]
        assert data["total"] == 101


def test_first_baseline_stays_empty_after_new_formal_tag(client, formal, remote, monkeypatch):
    remote.tags = []
    calls = []

    def history(identity, base, head):
        calls.append((base, head))
        return [
            CommitInfo(
                hash=HEAD,
                author="开发",
                author_email="",
                message="feat: 第一版",
                committed_at=datetime(2026, 10, 1, tzinfo=UTC),
            )
        ]

    monkeypatch.setattr(remote, "list_release_commits", history)
    assert client.post(f"/api/releases/{formal.id}/generate-doc/", {}, format="json").status_code == 200
    remote.tags = [TagInfo(name="VA.1.0.1", commit_hash=BASE)]
    assert client.post(f"/api/releases/{formal.id}/generate-doc/", {}, format="json").status_code == 200
    assert calls == [("", HEAD), ("", HEAD)]


def test_formal_history_snapshot_survives_remote_tag_movement(client, formal, remote):
    from apps.project.models import Project

    previous_project = Project.objects.create(code="OTHER", name="复用同仓库的项目")
    ReleaseRecord.objects.create(
        project=previous_project,
        repository=formal.repository,
        publisher=formal.publisher,
        release_type="formal",
        status="released",
        version="VA.1.0.1",
        tag_name="VA.1.0.1",
        git_hash=BASE,
    )
    remote.tags = [TagInfo(name="VA.1.0.1", commit_hash="e" * 40), TagInfo(name="VA.1.0.9-rc", commit_hash="f" * 40)]
    result = client.post(f"/api/releases/{formal.id}/generate-doc/", {}, format="json")
    assert result.status_code == 200, result.data
    formal.refresh_from_db()
    assert formal.base_git_hash == BASE


def test_target_version_change_invalidates_baseline_and_stale_manual_doc(client, formal, remote):
    doc = client.post(f"/api/releases/{formal.id}/generate-doc/", {}, format="json").data["data"]
    result = client.patch(f"/api/releases/{formal.id}/", {"version": "VA.1.0.3"}, format="json")
    assert result.status_code == 200, result.data
    assert not result.data["data"]["changes_initialized"] and not result.data["data"]["release_doc"]
    result = client.post(f"/api/releases/{formal.id}/update-doc/", {"release_doc": doc}, format="json")
    assert result.status_code == 400
