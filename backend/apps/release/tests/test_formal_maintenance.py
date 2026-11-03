"""旧分支补丁发布，以及明确删除版本后的同版本重发回归。"""

import pytest
from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord, ReleaseVersionClaim
from apps.workflow.models import WorkflowDefinition
from utils.provider.base import TagInfo

pytestmark = pytest.mark.django_db
BASE, HEAD, OTHER = "a" * 40, "1" * 40, "c" * 40


@pytest.fixture
def api(user, repository, project):
    client = APIClient()
    client.force_authenticate(user)
    WorkflowDefinition.objects.create(
        repository=repository, project=project, name="正式审批", release_type="formal",
        node_config=[{"node_id": "check", "node_name": "确认", "mode": "any",
                      "approvers": [{"type": "user", "user_id": str(user.id)}]}],
    )
    return client


@pytest.fixture
def remote(monkeypatch, mock_git_provider):
    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: mock_git_provider)
    return mock_git_provider


def create_formal(api, project, repository, version):
    result = api.post("/api/releases/", {
        "project": str(project.id), "repository": str(repository.id), "release_type": "formal",
        "branch": "develop", "version": version, "package_config_ids": [],
    }, format="json")
    assert result.status_code == 201, result.data
    return result.data["data"]["id"]


def generate_and_submit(api, identity):
    generated = api.post(f"/api/releases/{identity}/generate-doc/")
    assert generated.status_code == 200, generated.data
    submitted = api.post(f"/api/releases/{identity}/submit-audit/")
    assert submitted.status_code == 200, submitted.data
    return ReleaseRecord.objects.get(pk=identity)


@pytest.mark.parametrize("release_type,suffix", [("formal", ""), ("rc", "-rc"), ("beta", "-alpha")])
@pytest.mark.parametrize("with_date", [False, True])
def test_manual_tag_defines_version_even_with_stale_suggestion(api, repository, project, remote, release_type, suffix, with_date):
    tag = f"VA.5.2.40{suffix}" + ("_20261102" if with_date else "")
    created = api.post("/api/releases/", {
        "project": str(project.id), "repository": str(repository.id), "release_type": release_type,
        "branch": "develop", "version": "VA.5.9.5", "tag_name": tag, "package_config_ids": [],
    }, format="json")
    assert created.status_code == 201, created.data
    assert created.data["data"]["version"] == "VA.5.2.40"
    assert created.data["data"]["tag_name"].startswith(f"VA.5.2.40{suffix}_")


@pytest.mark.parametrize("entry", ["version", "tag", "edit"])
def test_old_branch_patch_uses_5239_instead_of_594(
    api, repository, project, user, remote, monkeypatch, entry,
):
    for version, sha in [("VA.5.2.39", BASE), ("VA.5.9.4", OTHER)]:
        ReleaseRecord.objects.create(
            repository=repository, project=project, publisher=user, release_type="formal",
            version=version, tag_name=version, git_hash=sha, status="released",
        )
        remote.tags.append(TagInfo(name=version, commit_hash=sha))
    monkeypatch.setattr(remote, "get_merge_base", lambda identity, refs: BASE)
    if entry == "tag":
        # 创建页面只提交手工填写的完整 Tag，由服务端反推正式版本号。
        created = api.post("/api/releases/", {
            "project": str(project.id), "repository": str(repository.id), "release_type": "formal",
            "branch": "develop", "tag_name": "VA.5.2.40_20261102", "package_config_ids": [],
        }, format="json")
        assert created.status_code == 201, created.data
        assert created.data["data"]["version"] == "VA.5.2.40"
        identity = created.data["data"]["id"]
    else:
        identity = create_formal(api, project, repository, "VA.5.9.5" if entry == "edit" else "VA.5.2.40")
    if entry == "edit":
        changed = api.patch(f"/api/releases/{identity}/", {"version": "VA.5.2.40"}, format="json")
        assert changed.status_code == 200, changed.data
    preview = api.get(f"/api/releases/{identity}/changes-preview/")
    assert preview.status_code == 200, preview.data
    assert preview.data["data"]["base_tag"] == "VA.5.2.39"
    release = generate_and_submit(api, identity)
    assert release.base_tag == "VA.5.2.39" and release.base_git_hash == BASE


@pytest.mark.parametrize("legacy_orphan", [False, True])
def test_deleted_formal_record_and_tag_allow_same_version_again(
    api, repository, project, remote, legacy_orphan,
):
    identity = create_formal(api, project, repository, "VA.5.9.3")
    release = generate_and_submit(api, identity)
    task = release.workflow_instance.tasks.get(status="pending")
    approved = api.post(f"/api/workflow/tasks/{task.id}/approve/")
    assert approved.status_code == 200, approved.data
    release.refresh_from_db()
    assert release.status == "released" and release.version_claims.get().consumed
    old_tag = release.tag_name
    if legacy_orphan:
        # 模拟旧版删除行为遗留的已消费孤立占用，远端 Tag 已经移除。
        remote.tags = []
        release.delete()
        assert ReleaseVersionClaim.objects.get().release_id is None
    else:
        deleted = api.post(f"/api/releases/{identity}/delete-released/", {"tag_name": old_tag})
        assert deleted.status_code == 200, deleted.data
        assert not ReleaseRecord.objects.filter(pk=identity).exists()
        assert not remote.tags
    next_version = api.get(f"/api/repositories/{repository.id}/next-version/?release_type=formal")
    assert next_version.status_code == 200, next_version.data
    assert next_version.data["data"]["next_version"] == "VA.1.0.0"
    new_id = create_formal(api, project, repository, "VA.5.9.3")
    replacement = generate_and_submit(api, new_id)
    task = replacement.workflow_instance.tasks.get(status="pending")
    approved = api.post(f"/api/workflow/tasks/{task.id}/approve/")
    assert approved.status_code == 200, approved.data
    replacement.refresh_from_db()
    assert replacement.status == "released"
    assert remote.tags[-1].commit_hash == HEAD


@pytest.mark.parametrize("conflict", ["remote", "released", "pending", "lookup_failure"])
def test_legacy_orphan_reuse_still_checks_remote_and_existing_records(
    api, repository, project, user, remote, monkeypatch, conflict,
):
    from utils.provider.exceptions import ConnectionError

    claim = ReleaseVersionClaim.objects.create(
        repository=repository, release_type="formal", base_version="5.9.3",
        tag_name="VA.5.9.3_20261029", consumed=True,
    )
    identity = create_formal(api, project, repository, "VA.5.9.3")
    generated = api.post(f"/api/releases/{identity}/generate-doc/")
    assert generated.status_code == 200, generated.data
    if conflict == "remote":
        # 日期不同仍是同一版本，不能因为孤立占用而覆盖远端。
        remote.tags = [TagInfo(name="VA.5.9.3_20261030", commit_hash=OTHER)]
    elif conflict == "lookup_failure":
        def fail(identity):
            raise ConnectionError("远端暂不可用")
        monkeypatch.setattr(remote, "list_tags", fail)
    else:
        from apps.project.models import Project

        other_project = Project.objects.create(code="OTHER", name="共享仓库的另一项目", leader=user)
        ReleaseRecord.objects.create(
            repository=repository, project=other_project, publisher=user, release_type="formal",
            version="VA.5.9.3", tag_name="VA.5.9.3_20261030", git_hash=OTHER, status=conflict,
        )
    submitted = api.post(f"/api/releases/{identity}/submit-audit/")
    assert submitted.status_code == (502 if conflict == "lookup_failure" else 400), submitted.data
    claim.refresh_from_db()
    assert claim.consumed and claim.release_id is None
    release = ReleaseRecord.objects.get(pk=identity)
    assert release.status == "draft" and release.workflow_instance_id is None


def test_failed_tag_deletion_keeps_record_and_consumed_claim(api, repository, project, user, remote, monkeypatch):
    from utils.provider.exceptions import ConnectionError

    release = ReleaseRecord.objects.create(
        repository=repository, project=project, publisher=user, release_type="formal",
        version="VA.5.9.3", tag_name="VA.5.9.3", git_hash=HEAD, status="released",
    )
    claim = ReleaseVersionClaim.objects.create(
        repository=repository, release_type="formal", base_version="5.9.3",
        release=release, tag_name=release.tag_name, consumed=True,
    )
    remote.tags = [TagInfo(name=release.tag_name, commit_hash=HEAD)]
    def fail(**kwargs):
        raise ConnectionError("删除结果未确认")
    monkeypatch.setattr(remote, "delete_tag", fail)
    deleted = api.post(f"/api/releases/{release.id}/delete-released/", {"tag_name": release.tag_name})
    assert deleted.status_code == 502, deleted.data
    assert ReleaseRecord.objects.filter(pk=release.pk, status="released").exists()
    claim.refresh_from_db()
    assert claim.consumed and claim.release_id == release.pk


@pytest.mark.parametrize("release_type,suffix", [("formal", ""), ("rc", "-rc"), ("beta", "-alpha")])
@pytest.mark.parametrize("remote_state", ["same_tag", "other_date", "without_date", "zero_padded", "missing", "other_version"])
def test_legacy_claim_checks_old_tag_after_rule_change(
    api, repository, project, user, remote, release_type, suffix, remote_state,
):
    # 模拟旧版删除后的孤立占用；远端可能由管理员恢复旧规则的 Tag。
    old_version_tag = f"VA.5.9.3{suffix}"
    old_tag = f"{old_version_tag}_20261029"
    claim = ReleaseVersionClaim.objects.create(
        repository=repository, release_type=release_type, base_version="5.9.3",
        tag_name=old_tag, consumed=True,
    )
    remote_name = {
        "same_tag": old_tag,
        "other_date": f"{old_version_tag}_20261030",
        "without_date": old_version_tag,
        "zero_padded": f"VA.05.09.003{suffix}_20261030",
        "missing": None,
        "other_version": f"VA.5.9.2{suffix}_20261029",
    }[remote_state]
    if remote_name:
        remote.tags = [TagInfo(name=remote_name, commit_hash=OTHER)]
    changed = api.patch(f"/api/repositories/{repository.id}/", {
        "version_rule": {**repository.version_rule, "prefix": "VB",
                         "suffixes": {"rc": "candidate", "beta": "preview"}},
    }, format="json")
    assert changed.status_code == 200, changed.data
    if release_type != "formal":
        WorkflowDefinition.objects.create(
            repository=repository, project=project, name="确认", release_type=release_type,
            node_config=[{"node_id": "check", "node_name": "确认", "mode": "any",
                          "approvers": [{"type": "user", "user_id": str(user.id)}]}],
        )
    created = api.post("/api/releases/", {
        "project": str(project.id), "repository": str(repository.id), "release_type": release_type,
        "branch": "develop", "version": "VB.5.9.3", "package_config_ids": [],
    }, format="json")
    assert created.status_code == 201, created.data
    identity = created.data["data"]["id"]
    generated = api.post(f"/api/releases/{identity}/generate-doc/")
    assert generated.status_code == 200, generated.data
    submitted = api.post(f"/api/releases/{identity}/submit-audit/")
    claim.refresh_from_db()
    release = ReleaseRecord.objects.get(pk=identity)
    if remote_state in ("same_tag", "other_date", "without_date", "zero_padded"):
        assert submitted.status_code == 400, submitted.data
        assert "不能覆盖" in submitted.data["message"]
        assert claim.consumed and claim.release_id is None and claim.tag_name == old_tag
        assert release.status == "draft" and release.workflow_instance_id is None
    else:
        assert submitted.status_code == 200, submitted.data
        assert not claim.consumed and claim.release_id == release.id and claim.tag_name == old_tag
        task = release.workflow_instance.tasks.get(status="pending")
        approved = api.post(f"/api/workflow/tasks/{task.id}/approve/")
        assert approved.status_code == 200, approved.data
        release.refresh_from_db()
        assert release.status == "released"
    if remote_name:
        assert remote.tags[0].name == remote_name and remote.tags[0].commit_hash == OTHER


@pytest.mark.parametrize("action", ["approve", "reject", "delete"])
@pytest.mark.parametrize("same_tag", [False, True])
def test_reused_claim_keeps_old_identity_until_explicit_deletion(api, repository, project, remote, action, same_tag):
    old_tag = "VA.5.9.3" if same_tag else "VA.5.9.3_20261029"
    claim = ReleaseVersionClaim.objects.create(
        repository=repository, release_type="formal", base_version="5.9.3", tag_name=old_tag, consumed=True,
    )
    changed = api.patch(f"/api/repositories/{repository.id}/", {
        "version_rule": {**repository.version_rule, "prefix": "VA" if same_tag else "VB", "with_date": False},
    }, format="json")
    assert changed.status_code == 200, changed.data
    identity = create_formal(api, project, repository, "VA.5.9.3" if same_tag else "VB.5.9.3")
    release = generate_and_submit(api, identity)
    claim.refresh_from_db()
    assert claim.reused
    # 外部恢复旧 Tag 发生于提审之后，推送阶段仍需使用原占用依据检查。
    remote.tags = [TagInfo(name="VA.05.09.003_20261030", commit_hash=OTHER)]
    task = release.workflow_instance.tasks.get(status="pending")
    result = api.post(f"/api/workflow/tasks/{task.id}/{'approve' if action == 'approve' else 'reject'}/",
                      {"comment": "终止本次发布"}, format="json")
    assert result.status_code == 200, result.data
    release.refresh_from_db()
    assert release.status == "rejected"
    assert len(remote.tags) == 1 and remote.tags[0].commit_hash == OTHER
    claim.refresh_from_db()
    assert claim.tag_name == old_tag
    if action == "approve":
        assert "不能覆盖" in release.rejected_reason
        assert not claim.consumed and claim.release_id == release.id
        remote.tags = []
        retried = api.post(f"/api/releases/{identity}/retry-push-tag/")
        assert retried.status_code == 200, retried.data
        release.refresh_from_db()
        assert release.status == "released"
    else:
        assert claim.consumed and claim.release_id is None and not claim.reused
        if action == "delete":
            deleted = api.delete(f"/api/releases/{identity}/")
            assert deleted.status_code == 200, deleted.data
        if same_tag:
            changed = api.patch(f"/api/repositories/{repository.id}/", {
                "version_rule": {**repository.version_rule, "prefix": "VB", "with_date": False},
            }, format="json")
            assert changed.status_code == 200, changed.data
        next_id = create_formal(api, project, repository, "VB.5.9.3")
        generated = api.post(f"/api/releases/{next_id}/generate-doc/")
        assert generated.status_code == 200, generated.data
        submitted = api.post(f"/api/releases/{next_id}/submit-audit/")
        assert submitted.status_code == 400, submitted.data


@pytest.mark.parametrize("release_type,suffix", [("formal", ""), ("rc", "-rc"), ("beta", "-alpha")])
@pytest.mark.parametrize("remaining", ["released", "pending", "push_failed", "draft", "rejected", "other_version", "other_type"])
def test_old_rule_release_history_controls_orphan_reuse(
    api, repository, project, user, remote, release_type, suffix, remaining,
):
    from apps.project.models import Project
    from apps.workflow.models import WorkflowInstance

    # 旧版同编号的另一条记录在共享项目中保留，远端 Tag 已删除。
    other_project = Project.objects.create(code="LEGACY", name="旧发布所属项目", leader=user)
    workflow = WorkflowDefinition.objects.get(repository=repository, release_type="formal")
    if release_type != "formal":
        workflow = WorkflowDefinition.objects.create(
            repository=repository, project=project, name="确认", release_type=release_type,
            node_config=workflow.node_config,
        )
    old_tag = f"VA.5.9.3{suffix}_20261029"
    claim = ReleaseVersionClaim.objects.create(
        repository=repository, release_type=release_type, base_version="5.9.3", tag_name=old_tag, consumed=True,
    )
    previous_type = ("beta" if release_type != "beta" else "rc") if remaining == "other_type" else release_type
    previous_suffix = {"formal": "", "rc": "-rc", "beta": "-alpha"}[previous_type]
    previous = ReleaseRecord.objects.create(
        repository=repository, project=other_project, publisher=user,
        release_type=previous_type,
        version="VA.5.9.2" if remaining == "other_version" else "VA.5.9.3",
        tag_name=f"VA.05.09.00{2 if remaining == 'other_version' else 3}{previous_suffix}_20261028",
        git_hash=OTHER,
        status="rejected" if remaining == "push_failed" else (
            "released" if remaining in ("other_version", "other_type") else remaining
        ),
    )
    if remaining in ("push_failed", "rejected"):
        previous.workflow_instance = WorkflowInstance.objects.create(
            definition=workflow, biz_type="release", biz_id=str(previous.id), created_by=user,
            status="completed" if remaining == "push_failed" else "rejected",
        )
        previous.save(update_fields=["workflow_instance"])
    updated = api.patch(f"/api/repositories/{repository.id}/", {
        "version_rule": {**repository.version_rule, "prefix": "VB",
                         "suffixes": {"rc": "candidate", "beta": "preview"}},
    }, format="json")
    assert updated.status_code == 200, updated.data
    created = api.post("/api/releases/", {
        "project": str(project.id), "repository": str(repository.id), "release_type": release_type,
        "branch": "develop", "version": "VB.5.9.3", "package_config_ids": [],
    }, format="json")
    assert created.status_code == 201, created.data
    identity = created.data["data"]["id"]
    assert api.post(f"/api/releases/{identity}/generate-doc/").status_code == 200
    submitted = api.post(f"/api/releases/{identity}/submit-audit/")
    release = ReleaseRecord.objects.get(pk=identity)
    claim.refresh_from_db()
    if remaining in ("released", "pending", "push_failed"):
        assert submitted.status_code == 400, submitted.data
        expected_message = "不能覆盖" if remaining == "released" else "已有同版本在发布"
        assert expected_message in submitted.data["message"]
        assert release.status == "draft" and release.workflow_instance_id is None
        assert claim.release_id is None and claim.consumed and not claim.reused
        assert claim.tag_name == old_tag and not remote.tags
    else:
        assert submitted.status_code == 200, submitted.data
        task = release.workflow_instance.tasks.get(status="pending")
        assert api.post(f"/api/workflow/tasks/{task.id}/approve/").status_code == 200
        release.refresh_from_db()
        assert release.status == "released" and remote.tags[-1].name == release.tag_name


def test_old_rule_history_is_rechecked_at_approval_and_retry(api, repository, project, user, remote):
    claim = ReleaseVersionClaim.objects.create(
        repository=repository, release_type="formal", base_version="5.9.3",
        tag_name="VA.5.9.3_20261029", consumed=True,
    )
    changed = api.patch(f"/api/repositories/{repository.id}/", {
        "version_rule": {**repository.version_rule, "prefix": "VB"},
    }, format="json")
    assert changed.status_code == 200, changed.data
    identity = create_formal(api, project, repository, "VB.5.9.3")
    release = generate_and_submit(api, identity)
    # 提审后恢复的旧记录也参与推送和重试核验，不能只在首次复用时检查。
    previous = ReleaseRecord.objects.create(
        repository=repository, project=project, publisher=user, release_type="formal",
        version="VA.5.9.3", tag_name="VA.05.09.003_20261028", git_hash=OTHER, status="released",
    )
    task = release.workflow_instance.tasks.get(status="pending")
    assert api.post(f"/api/workflow/tasks/{task.id}/approve/").status_code == 200
    release.refresh_from_db()
    assert release.status == "rejected" and "不能覆盖" in release.rejected_reason
    claim.refresh_from_db()
    assert claim.release_id == release.id and claim.reused and not claim.consumed
    assert not remote.tags
    retried = api.post(f"/api/releases/{identity}/retry-push-tag/")
    assert retried.status_code == 400 and not remote.tags
    deleted = api.post(f"/api/releases/{previous.id}/delete-released/", {"tag_name": previous.tag_name})
    assert deleted.status_code == 200, deleted.data
    retried = api.post(f"/api/releases/{identity}/retry-push-tag/")
    assert retried.status_code == 200, retried.data
    release.refresh_from_db()
    assert release.status == "released" and remote.tags[-1].name == release.tag_name
