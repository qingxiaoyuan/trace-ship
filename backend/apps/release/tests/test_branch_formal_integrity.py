"""分支正式版的真实分支、固定提交区间和说明身份回归。"""

from datetime import UTC, datetime

import pytest
from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord
from apps.workflow.models import WorkflowDefinition
from utils.provider.base import BranchInfo, CommitInfo, MergeRequestInfo, TagInfo
from utils.provider.exceptions import NotFoundError

pytestmark = pytest.mark.django_db
HEAD, MOVED = "a" * 40, "b" * 40


@pytest.fixture
def remote(monkeypatch):
    """只替换外部 Git 协议，提交列表同时支持分支和其他合法 ref。"""
    class Remote:
        branch_head = HEAD
        commit_list_head = HEAD
        tags = []

        def get_branch(self, repo_identity, branch_name):
            if branch_name not in ("develop", "feature/nested"):
                raise NotFoundError("分支不存在")
            return BranchInfo(name=branch_name, last_commit_hash=self.branch_head)

        def list_tags(self, repo_identity):
            return self.tags

        @staticmethod
        def commit(sha):
            return CommitInfo(hash=sha, author="开发", author_email="",
                              message="A 固定功能" if sha == HEAD else "A 后续功能",
                              committed_at=datetime(2026, 10, 22, tzinfo=UTC))

        def list_commits(self, repo_identity, branch, **kwargs):
            if branch == "missing":
                raise NotFoundError("引用不存在")
            return [self.commit(self.commit_list_head)]

        def compare_commits(self, repo_identity, base, head):
            return self.list_commits(repo_identity, head)

        def list_merge_requests(self, repo_identity, **kwargs):
            return self.list_release_merge_requests(repo_identity)

        def list_release_commits(self, repo_identity, base, head):
            if base == HEAD and head == MOVED:
                return [self.commit(HEAD)]
            if not base and head == MOVED:
                return [self.commit(MOVED)]
            assert base == "" and head == HEAD, "必须读取首次生成时固定的提交区间"
            return [self.commit(HEAD)]

        def get_merge_base(self, repo_identity, refs):
            return refs[0]

        def compare_diff(self, repo_identity, base, head):
            return [{"old_path": "app.py", "new_path": "app.py", "diff": "-旧代码\n+新代码"}]

        def list_release_merge_requests(self, repo_identity):
            return [MergeRequestInfo(number="1", description="A 固定 MR", merge_commit_sha=HEAD),
                    MergeRequestInfo(number="2", description="A 后续 MR", merge_commit_sha=MOVED)]

        def create_tag(self, repo_identity, tag_name, commit_hash, message=""):
            tag = TagInfo(name=tag_name, commit_hash=commit_hash, message=message)
            self.tags.append(tag)
            return tag

    remote = Remote()
    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: remote)
    return remote


@pytest.fixture
def api(user, project, repository, remote):
    client = APIClient()
    client.force_authenticate(user)
    WorkflowDefinition.objects.create(project=project, repository=repository, name="正式审批", release_type="formal",
        node_config=[{"node_id": "check", "node_name": "确认", "mode": "any",
                      "approvers": [{"type": "user", "user_id": str(user.id)}]}])
    return client


def create(api, project, repository, branch="develop"):
    """通过生产 REST 创建正式草稿，不提供客户端提交哈希。"""
    return api.post("/api/releases/", {"project": str(project.id), "repository": str(repository.id),
                    "release_type": "formal", "branch": branch, "version": "VA.1.0.0",
                    "package_config_ids": []}, format="json")


def test_notes_and_approval_use_fixed_sha_after_branch_moves(api, project, repository, remote):
    created = create(api, project, repository)
    assert created.status_code == 201, created.data
    release = ReleaseRecord.objects.get(pk=created.data["data"]["id"])
    remote.branch_head = remote.commit_list_head = MOVED
    url = f"/api/releases/{release.id}/"
    for _ in range(2):
        generated = api.post(url + "generate-doc/")
        assert generated.status_code == 200, generated.data
        assert "后续" not in generated.data["data"]
        assert "固定功能" in generated.data["data"]
        assert list(release.release_commits.filter(is_included=True).values_list("commit__commit_hash", flat=True)) == [HEAD]
        assert list(release.release_mrs.values_list("mr_number", flat=True)) == ["1"]
    assert api.post(url + "submit-audit/").status_code == 200
    release.refresh_from_db()
    task = release.workflow_instance.tasks.get(status="pending")
    assert api.post(f"/api/workflow/tasks/{task.id}/approve/").status_code == 200
    release.refresh_from_db()
    assert release.status == "released" and remote.tags[-1].commit_hash == HEAD


@pytest.mark.parametrize("field", ["version", "tag_name"])
def test_version_change_invalidates_notes_and_rejects_stale_identity(api, project, repository, remote, field):
    created = create(api, project, repository)
    assert created.status_code == 201, created.data
    release = ReleaseRecord.objects.get(pk=created.data["data"]["id"])
    url = f"/api/releases/{release.id}/"
    old_doc = api.post(url + "generate-doc/").data["data"]
    changed = api.patch(url, {field: "VA.1.0.1"}, format="json")
    assert changed.status_code == 200, changed.data
    release.refresh_from_db()
    assert release.release_doc == "" and not release.changes_initialized
    assert not release.release_commits.exists() and not release.release_mrs.exists()
    assert api.post(url + "submit-audit/").status_code == 400
    stale = api.post(url + "update-doc/", {"release_doc": old_doc}, format="json")
    assert stale.status_code == 400, stale.data
    generated = api.post(url + "generate-doc/")
    assert generated.status_code == 200, generated.data
    assert "| 当前发布版本号 | VA.1.0.1 |" in generated.data["data"]
    stale = api.post(url + "update-doc/", {"release_doc": old_doc}, format="json")
    assert stale.status_code == 400, stale.data
    # 直接保存错误身份模拟存量脏数据，提审仍须重新核验。
    ReleaseRecord.objects.filter(pk=release.pk).update(release_doc=old_doc)
    assert api.post(url + "submit-audit/").status_code == 400


@pytest.mark.parametrize("branch", ["only-tag", HEAD, "develop..only-tag", "missing"])
def test_only_real_branches_can_create_formal_release(api, project, repository, remote, branch):
    remote.tags = [TagInfo(name="only-tag", commit_hash=HEAD)]
    response = create(api, project, repository, branch)
    assert response.status_code == 400, response.data
    assert "分支" in response.data["message"]
    assert not ReleaseRecord.objects.exists()


def test_branch_endpoint_head_wins_over_generic_commit_order(api, project, repository, remote):
    remote.commit_list_head = MOVED
    created = create(api, project, repository, "feature/nested")
    assert created.status_code == 201, created.data
    assert created.data["data"]["git_hash"] == HEAD


def test_edit_cannot_replace_branch_with_tag(api, project, repository, remote):
    created = create(api, project, repository)
    assert created.status_code == 201, created.data
    url = f"/api/releases/{created.data['data']['id']}/"
    doc = api.post(url + "generate-doc/").data["data"]
    remote.tags = [TagInfo(name="only-tag", commit_hash=HEAD)]
    changed = api.patch(url, {"branch": "only-tag"}, format="json")
    assert changed.status_code == 400, changed.data
    detail = api.get(url).data["data"]
    assert detail["branch"] == "develop" and detail["git_hash"] == HEAD
    assert detail["release_doc"] == doc


@pytest.mark.parametrize("identity", ["VA.1.0.0", HEAD])
def test_formal_identity_cannot_be_forged_in_notes(api, project, repository, remote, identity):
    created = create(api, project, repository)
    assert created.status_code == 201, created.data
    url = f"/api/releases/{created.data['data']['id']}/"
    doc = api.post(url + "generate-doc/").data["data"]
    forged = api.post(url + "update-doc/", {"release_doc": doc.replace(identity, "伪造")}, format="json")
    assert forged.status_code == 400, forged.data
    edited = api.post(url + "update-doc/", {"release_doc": doc.replace("固定功能", "固定功能（补充说明）")}, format="json")
    assert edited.status_code == 200, edited.data


@pytest.mark.parametrize("failure", ["commits", "mrs", "empty"])
def test_incomplete_formal_changes_never_fall_back_to_branch(api, project, repository, remote, monkeypatch, failure):
    """完整区间获取失败时不生成可提审的空壳说明，也不回退分支。"""
    from utils.provider.exceptions import ConnectionError

    created = create(api, project, repository)
    assert created.status_code == 201, created.data
    url = f"/api/releases/{created.data['data']['id']}/"

    def unavailable(*args):
        raise ConnectionError("固定区间接口不可用")

    if failure == "empty":
        monkeypatch.setattr(remote, "list_release_commits", lambda *args: [])
    else:
        method = "list_release_commits" if failure == "commits" else "list_release_merge_requests"
        monkeypatch.setattr(remote, method, unavailable)
    response = api.post(url + "generate-doc/")
    assert response.status_code == (400 if failure == "empty" else 502), response.data
    release = ReleaseRecord.objects.get(pk=created.data["data"]["id"])
    assert not release.release_doc and not release.changes_initialized
    assert not release.release_commits.exists() and not release.release_mrs.exists()
    assert api.post(url + "submit-audit/").status_code == 400


def test_refresh_requires_confirmation_of_current_heads(api, project, repository, remote):
    created = create(api, project, repository)
    url = f"/api/releases/{created.data['data']['id']}/"
    doc = api.post(url + "generate-doc/").data["data"]
    remote.branch_head = MOVED
    preview = api.get(url + "branch-update/")
    assert preview.status_code == 200, preview.data
    assert preview.data["data"]["old_hash"] == HEAD
    assert preview.data["data"]["new_hash"] == MOVED
    assert preview.data["data"]["commits"][0]["hash"] == HEAD
    assert preview.data["data"]["diffs"][0]["diff"] == "-旧代码\n+新代码"
    remote.branch_head = "c" * 40
    stale = api.post(url + "branch-update/", {"old_hash": HEAD, "new_hash": MOVED}, format="json")
    assert stale.status_code == 400, stale.data
    assert api.get(url).data["data"]["release_doc"] == doc
    remote.branch_head = MOVED
    result = api.post(url + "branch-update/", {"old_hash": HEAD, "new_hash": MOVED}, format="json")
    assert result.status_code == 200, result.data
    detail = api.get(url).data["data"]
    assert detail["git_hash"] == MOVED and detail["release_doc"] == ""
    assert api.post(url + "update-doc/", {"release_doc": doc}, format="json").status_code == 400
    assert api.post(url + "submit-audit/").status_code == 400


@pytest.mark.parametrize("release_type", ["rc", "beta"])
def test_updated_nonformal_notes_use_confirmed_commit(api, project, repository, remote, release_type):
    created = api.post("/api/releases/", {"project": str(project.id), "repository": str(repository.id),
        "release_type": release_type, "branch": "develop", "version": "VA.1.0.0"}, format="json")
    assert created.status_code == 201, created.data
    url = f"/api/releases/{created.data['data']['id']}/"
    assert api.post(url + "generate-doc/").status_code == 200
    remote.branch_head = MOVED
    assert api.post(url + "branch-update/", {"old_hash": HEAD, "new_hash": MOVED}, format="json").status_code == 200
    assert api.get(url).data["data"]["release_doc"] == ""
    assert api.post(url + "submit-audit/").status_code == 400
    remote.branch_head = "c" * 40
    remote.list_commits = lambda identity, ref, **kwargs: [remote.commit(ref if ref != "develop" else "c" * 40)]
    generated = api.post(url + "generate-doc/")
    assert generated.status_code == 200, generated.data
    assert "后续功能" in generated.data["data"]
    assert "后续 MR" in generated.data["data"]
    assert "固定 MR" not in generated.data["data"]
    commits = api.get(url + "commits/").data["data"]["results"]
    assert [item["commit_hash"] for item in commits] == [MOVED]
    regenerated = api.post(url + "generate-doc/")
    assert "后续功能" in regenerated.data["data"] and "固定 MR" not in regenerated.data["data"]


def test_branch_update_requires_publisher_and_draft(api, user, project, repository, remote):
    from apps.account.models import User
    from apps.project.models import ProjectMember

    created = create(api, project, repository)
    url = f"/api/releases/{created.data['data']['id']}/"
    other = User.objects.create_user(username="other", password="test")
    ProjectMember.objects.create(project=project, user=other, role="developer")
    api.force_authenticate(other)
    assert api.get(url + "branch-update/").status_code == 403
    assert api.post(url + "branch-update/", {"old_hash": HEAD, "new_hash": MOVED}, format="json").status_code == 403
    api.force_authenticate(user)
    ReleaseRecord.objects.filter(pk=created.data["data"]["id"]).update(status="pending")
    assert api.get(url + "branch-update/").status_code == 400
    assert api.post(url + "branch-update/", {"old_hash": HEAD, "new_hash": MOVED}, format="json").status_code == 400


def test_existing_patch_cannot_silently_refresh_moved_head(api, project, repository, remote):
    created = create(api, project, repository)
    url = f"/api/releases/{created.data['data']['id']}/"
    remote.branch_head = MOVED
    assert api.patch(url, {"branch": "develop"}, format="json").status_code == 400
    assert api.get(url).data["data"]["git_hash"] == HEAD


def test_existing_draft_can_switch_branches(api, project, repository, remote):
    created = create(api, project, repository)
    url = f"/api/releases/{created.data['data']['id']}/"
    assert api.post(url + "generate-doc/").status_code == 200
    remote.branch_head = MOVED
    changed = api.patch(url, {"branch": "feature/nested"}, format="json")
    assert changed.status_code == 200, changed.data
    assert changed.data["data"]["git_hash"] == MOVED and not changed.data["data"]["release_doc"]
    assert api.post(url + "submit-audit/").status_code == 400


def test_direct_confirmation_cannot_bypass_nonancestor_guard(api, project, repository, remote):
    created = create(api, project, repository)
    url = f"/api/releases/{created.data['data']['id']}/"
    remote.branch_head = MOVED
    remote.get_merge_base = lambda identity, refs: "c" * 40
    assert api.post(url + "branch-update/", {"old_hash": HEAD, "new_hash": MOVED}, format="json").status_code == 400
    assert api.get(url).data["data"]["git_hash"] == HEAD
