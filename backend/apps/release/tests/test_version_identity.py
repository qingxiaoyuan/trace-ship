"""通过生产 API 验证版本身份，显示字段不能代替规范化占用。"""

import pytest

from apps.release.models import ReleaseRecord, ReleaseVersionClaim
from apps.release.tests import test_formal_maintenance as maintenance
from apps.release.tests.test_formal_maintenance import generate_and_submit
from apps.workflow.models import WorkflowDefinition

pytestmark = pytest.mark.django_db
api = maintenance.api
remote = maintenance.remote


@pytest.fixture(params=["rc", "beta"])
def release_type(request, api, repository, project):
    workflow = WorkflowDefinition.objects.get(repository=repository, release_type="formal")
    WorkflowDefinition.objects.create(
        repository=repository, project=project, name="确认", release_type=request.param,
        node_config=workflow.node_config,
    )
    return request.param


def create(api, project, repository, release_type, **identity):
    result = api.post("/api/releases/", {
        "project": str(project.id), "repository": str(repository.id), "release_type": release_type,
        "branch": "develop", "package_config_ids": [], **identity,
    }, format="json")
    assert result.status_code == 201, result.data
    return result.data["data"]["id"]


def approve(api, release):
    task = release.workflow_instance.tasks.get(status="pending")
    result = api.post(f"/api/workflow/tasks/{task.id}/approve/")
    assert result.status_code == 200, result.data
    detail = api.get(f"/api/releases/{release.id}/")
    assert detail.status_code == 200, detail.data
    return detail.data["data"]


@pytest.mark.parametrize("entry", ["create_tag", "create_version", "edit_tag", "edit_version"])
@pytest.mark.parametrize("suffix_kind", ["overlap", "date"])
@pytest.mark.parametrize("with_date", [False, True])
def test_saved_version_roundtrip_keeps_complete_suffix_boundary(
    api, project, repository, remote, release_type, entry, suffix_kind, with_date,
):
    suffix = f"{release_type}.5.9.3-tail" if suffix_kind == "overlap" else "_20261028"
    other_type = "beta" if release_type == "rc" else "rc"
    rule = {**repository.version_rule, "with_date": with_date,
            "suffixes": {release_type: suffix, other_type: "tail"}}
    changed = api.patch(f"/api/repositories/{repository.id}/", {"version_rule": rule}, format="json")
    assert changed.status_code == 200, changed.data
    tag = f"VA.1.2.3-{suffix}"
    identity = {"tag_name": tag + ("_20261029" if with_date else "")} if entry.endswith("tag") else {"version": tag}
    if entry.startswith("edit"):
        release_id = create(api, project, repository, release_type, version="VA.1.2.2")
        changed = api.patch(f"/api/releases/{release_id}/", identity, format="json")
        assert changed.status_code == 200, changed.data
    else:
        release_id = create(api, project, repository, release_type, **identity)
    detail = api.get(f"/api/releases/{release_id}/").data["data"]
    assert detail["version"] == "VA.1.2.3"
    if entry.endswith("tag"):
        assert detail["tag_name"] == identity["tag_name"]
    previous = generate_and_submit(api, release_id)
    assert approve(api, previous)["status"] == "released"
    # 后缀中的 5.9.3 不占号：通过完整流程证明另一个编号仍可发布。
    next_id = create(api, project, repository, release_type, version="VA.5.9.3")
    current = generate_and_submit(api, next_id)
    assert approve(api, current)["status"] == "released"
    assert api.get(f"/api/releases/{release_id}/").data["data"]["version"] == "VA.1.2.3"


@pytest.mark.parametrize("history", ["partial_suffix", "stale_prefix"])
@pytest.mark.parametrize("claim_state", ["missing", "owned", "reused"])
@pytest.mark.parametrize("target", ["1.2.3", "5.9.3", "9.8.7"])
def test_historical_identity_uses_own_claim_or_reports_ambiguity(
    api, project, repository, user, remote, release_type, history, claim_state, target,
):
    old_tag = (f"LEGACY.1.2.3-{release_type}.5.9.3-tail" if history == "partial_suffix"
               else f"LEGACY.5.9.3-train.1.2.3-{release_type}")
    old_version = f"LEGACY.1.2.3-{release_type}.5.9.3" if history == "partial_suffix" else "LEGACY.5.9.4"
    previous = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=user, release_type=release_type,
        version=old_version, tag_name=old_tag, git_hash="a" * 40, status="released",
    )
    if claim_state != "missing":
        ReleaseVersionClaim.objects.create(
            repository=repository, release_type=release_type, base_version="1.2.3", release=previous,
            tag_name="ORIGINAL.1.2.3-previous" if claim_state == "reused" else old_tag,
            consumed=True, reused=claim_state == "reused",
        )
    release_id = create(api, project, repository, release_type, version=f"VA.{target}")
    assert api.post(f"/api/releases/{release_id}/generate-doc/").status_code == 200
    submitted = api.post(f"/api/releases/{release_id}/submit-audit/")
    expected = ("版本身份存在歧义" if claim_state == "missing" and target in ("1.2.3", "5.9.3")
                else "不能覆盖" if target == "1.2.3" else "")
    if expected:
        assert submitted.status_code == 400 and expected in submitted.data["message"], submitted.data
        assert api.get(f"/api/releases/{release_id}/").data["data"]["status"] == "draft"
        assert not remote.tags
    else:
        assert submitted.status_code == 200, submitted.data
        assert approve(api, ReleaseRecord.objects.get(pk=release_id))["status"] == "released"
    detail = api.get(f"/api/releases/{previous.id}/").data["data"]
    assert detail["version"] == old_version and detail["tag_name"] == old_tag


@pytest.mark.parametrize("history", ["partial_suffix", "stale_prefix"])
def test_ambiguous_history_restored_during_approval_blocks_push_and_retry(
    api, project, repository, user, remote, release_type, history,
):
    claim = ReleaseVersionClaim.objects.create(
        repository=repository, release_type=release_type, base_version="1.2.3",
        tag_name=f"ORIGINAL.1.2.3-{release_type}", consumed=True,
    )
    release_id = create(api, project, repository, release_type, version="VA.1.2.3")
    release = generate_and_submit(api, release_id)
    previous = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=user, release_type=release_type,
        version=f"LEGACY.1.2.3-{release_type}.5.9.3" if history == "partial_suffix" else "LEGACY.5.9.4",
        tag_name=(f"LEGACY.1.2.3-{release_type}.5.9.3-tail" if history == "partial_suffix"
                  else f"LEGACY.5.9.3-train.1.2.3-{release_type}"),
        git_hash="a" * 40, status="released",
    )
    detail = approve(api, release)
    assert detail["status"] == "rejected" and "版本身份存在歧义" in detail["rejected_reason"]
    assert not remote.tags
    retried = api.post(f"/api/releases/{release_id}/retry-push-tag/")
    assert retried.status_code == 400 and "版本身份存在歧义" in retried.data["message"], retried.data
    claim.refresh_from_db()
    assert claim.release_id == release.id and claim.reused and not claim.consumed
    deleted = api.post(f"/api/releases/{previous.id}/delete-released/", {"tag_name": previous.tag_name})
    assert deleted.status_code == 200, deleted.data
    retried = api.post(f"/api/releases/{release_id}/retry-push-tag/")
    assert retried.status_code == 200, retried.data
    assert api.get(f"/api/releases/{release_id}/").data["data"]["status"] == "released"
