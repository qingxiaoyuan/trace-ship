"""按软件发布的公开接口与 Git 来源边界。"""

import pytest
from rest_framework.test import APIClient

from apps.software.models import ProjectSoftware, Software

pytestmark = pytest.mark.django_db


@pytest.fixture
def api(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def software_pair(repository, project, user):
    items = [
        Software.objects.create(repository=repository, slug=slug, name=name, owner=user)
        for slug, name in (("client-a", "客户端"), ("server-b", "服务端"))
    ]
    for software in items:
        ProjectSoftware.objects.create(project=project, software=software)
    return items


@pytest.fixture
def remote(monkeypatch, mock_git_provider):
    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: mock_git_provider)
    return mock_git_provider


def create_draft(api, project, software, **overrides):
    return api.post("/api/releases/", {
        "project": str(project.id), "software": str(software.id), "branch": "develop",
        "release_type": "rc", "tag_name": "VA.1.0.1-rc", **overrides,
    }, format="json")


def test_software_draft_uses_verified_repository_and_tag_namespace(api, project, software_pair, remote):
    client, server = software_pair
    bypass = api.post("/api/releases/", {
        "project": str(project.pk), "repository": str(client.repository_id), "release_type": "rc",
        "branch": "develop", "version": "VA.1.0.1",
    }, format="json")
    assert bypass.status_code == 400, bypass.data
    wrong = create_draft(api, project, client, tag_name="server-b/VA.1.0.1-rc")
    assert wrong.status_code == 400
    result = create_draft(api, project, client)
    assert result.status_code == 201, result.data
    draft = result.data["data"]
    assert draft["software"] == str(client.id)
    assert str(draft["repository"]) == str(client.repository_id)
    assert draft["tag_name"].startswith("client-a/VA.1.0.1-rc")
    assert draft["git_hash"] == "1" * 40
    assert draft["package_config_ids"] == []
    assert api.patch(f"/api/releases/{draft['id']}/", {"software": str(server.id)}, format="json").status_code == 400


def test_version_suggestion_uses_target_namespace(api, project, software_pair, remote):
    from utils.provider.base import TagInfo

    client, server = software_pair
    remote.tags = [
        TagInfo(name="VA.1.0.91-rc"),
        TagInfo(name="server-b/VA.1.0.24-rc"),
        TagInfo(name="client-a/VA.1.0.7-rc"),
    ]
    draft = create_draft(api, project, client, tag_name="VA.1.0.99-rc")
    assert draft.status_code == 201, draft.data
    for software, expected in ((client, "VA.1.0.8"), (server, "VA.1.0.25")):
        result = api.get("/api/releases/next-version/", {
            "project": str(project.id), "software": str(software.id), "release_type": "rc",
        })
        assert result.status_code == 200, result.data
        assert result.data["data"]["next_version"] == expected
        assert result.data["data"]["next_tag_name"].startswith(f"{software.slug}/{expected}-rc")


def test_two_software_use_same_number_and_repository_approval(api, project, software_pair, user, remote):
    from apps.workflow.models import WorkflowDefinition

    repository = software_pair[0].repository
    WorkflowDefinition.objects.create(
        project=project, repository=repository, biz_type="release", release_type="formal", name="正式审批",
        node_config=[{"node_id": "check", "node_name": "复核", "mode": "any",
                      "approvers": [{"type": "user", "user_id": str(user.id)}]}],
    )
    workflow_ids = []
    for software in software_pair:
        result = create_draft(api, project, software, release_type="formal", tag_name="VA.1.0.1")
        assert result.status_code == 201, result.data
        draft = result.data["data"]
        url = f"/api/releases/{draft['id']}/"
        assert api.post(url + "submit-audit/").status_code == 400
        generated = api.post(url + "generate-doc/")
        assert generated.status_code == 200, generated.data
        assert f"| 软件 | {software.name} |" in generated.data["data"]
        assert f"| 发布 Tag | {draft['tag_name']} |" in generated.data["data"]
        assert api.get(url).data["data"]["base_tag"] == ""
        submitted = api.post(url + "submit-audit/")
        assert submitted.status_code == 200, submitted.data
        workflow_id = submitted.data["data"]["workflow_instance_id"]
        workflow_ids.append(workflow_id)
        from apps.workflow.models import WorkflowTask
        task_id = WorkflowTask.objects.get(instance_id=workflow_id, status="pending").id
        approved = api.post(f"/api/workflow/tasks/{task_id}/approve/")
        assert approved.status_code == 200, approved.data
        saved = api.get(url).data["data"]
        assert saved["status"] == "released"
        assert saved["package_tasks"] == []
        assert remote.tags[-1].name == draft["tag_name"]
        assert remote.tags[-1].commit_hash == "1" * 40
    assert len(set(workflow_ids)) == 2


@pytest.fixture
def other_project(project, software_pair, user):
    from apps.account.models import User
    from apps.project.models import Project, ProjectMember
    from apps.project.services import ensure_repository_component

    operator = User.objects.create_user(username="second-project-member")
    other = Project.objects.create(code="SECOND", name="第二个项目", leader=operator)
    ProjectMember.objects.create(project=other, user=operator, role="manager")
    ProjectMember.objects.create(project=other, user=user, role="developer")
    ensure_repository_component(software_pair[0].repository, other)
    ProjectSoftware.objects.create(project=other, software=software_pair[0])
    return other, operator


def test_shared_read_only_projects_are_isolated(api, project, software_pair, other_project, remote):
    from apps.package.models import PackageConfig, PackageTask
    from apps.project.models import ProjectComponent
    from apps.release.models import ReleaseRecord
    from apps.workflow.models import WorkflowDefinition

    software = software_pair[0]
    other, other_user = other_project
    draft = create_draft(api, project, software, updates=[{"type": "A", "content": "原申请表单私有草稿"}]).data["data"]
    pending = create_draft(api, project, software, tag_name="VA.1.0.2-rc").data["data"]
    WorkflowDefinition.objects.create(
        project=project, repository=software.repository, biz_type="release", release_type="rc",
        name="候选版发布", node_config=[],
    )
    source_url = f"/api/releases/{draft['id']}/"
    generated = api.post(source_url + "generate-doc/")
    assert generated.status_code == 200
    assert "原申请表单私有草稿" in generated.data["data"]
    assert api.post(source_url + "submit-audit/").status_code == 200
    saved_identity = ("| 项目 |", "|------|", "| 当前发布版本号 |", "| Git提交hash |", "| 软件 |",
                      "| 软件标识 |", "| 主仓库 |", "| 发布 Tag |")
    edited_doc = "\n".join(line for line in generated.data["data"].splitlines() if line.startswith(saved_identity))
    edited_doc += "\n\n公开说明已移除原申请的手工更新条目。"
    saved = api.post(source_url + "update-doc/", {"release_doc": edited_doc}, format="json")
    assert saved.status_code == 200, saved.data
    original = ReleaseRecord.objects.get(pk=draft["id"])
    config = PackageConfig.objects.create(
        project_component=ProjectComponent.objects.get(project=project, repository=original.repository),
        name="旧仓库配置", is_active=True,
    )
    legacy_repackage = api.post(f"/api/packages/configs/{config.pk}/trigger/", {
        "release_id": str(original.pk),
    }, format="json")
    assert legacy_repackage.status_code == 400 and "共享软件版本" in str(legacy_repackage.data), legacy_repackage.data
    private_task = PackageTask.objects.create(
        project=project, repository=original.repository, release=original,
        name="不公开的打包任务", status="success",
    )
    own_task = PackageTask.objects.create(
        project=other, repository=original.repository, release=original,
        name="第二个项目打包任务", status="success",
    )
    viewer = APIClient()
    viewer.force_authenticate(other_user)
    shared = viewer.get(source_url)
    assert shared.status_code == 200, shared.data
    data = shared.data["data"]
    assert data["software"] == str(software.id) and data["shared_readonly"]
    assert data["project"] == str(other.pk) and "第二个项目" == data["project_name"]
    assert "发布 Tag" in data["release_doc"]
    assert {row["id"] for row in data["package_tasks"]} == {str(own_task.pk)}
    assert not data.get("workflow_instance") and not data.get("publisher")
    assert viewer.get(f"/api/releases/{pending['id']}/").status_code == 404
    for action, method in (("oa-archive/records/", "get"), ("update-doc/", "post"),
                           ("delete-released/", "post"), ("commits/", "get")):
        assert getattr(viewer, method)(source_url + action).status_code == 404
    assert viewer.get(f"/api/packages/tasks/{private_task.pk}/").status_code == 404
    delete = viewer.post(
        f"/api/repositories/{original.repository_id}/delete-tag/",
        {"tag_name": original.tag_name}, format="json",
    )
    assert delete.status_code == 400 and "共享软件版本" in str(delete.data["data"]), delete.data
    assert any(tag.name == original.tag_name for tag in remote.tags)
    params = {"project": str(other.pk), "software": str(software.pk)}
    releases = viewer.get("/api/releases/", params).data["data"]["results"]
    assert {str(row["id"]) for row in releases} == {draft["id"]}
    assert releases[0]["package_summary"]["task_id"] == str(own_task.pk)
    assert "原申请表单私有草稿" not in releases[0]["update_summary"]
    catalog = viewer.get("/api/releases/catalog/", params).data["data"]
    assert {str(row["id"]) for row in catalog["rc"]} == {draft["id"]}
    assert "原申请表单私有草稿" not in catalog["rc"][0]["update_summary"]


def test_confirmed_history_preserves_original_release_and_enters_software_sequence(
    api, project, software_pair, user, remote, tmp_path,
):
    import json
    from io import StringIO

    from django.core.management import call_command

    from apps.release.models import ReleaseRecord, ReleaseVersionClaim
    from utils.provider.base import TagInfo

    software = software_pair[0]
    record = ReleaseRecord.objects.create(
        project=project, repository=software.repository, publisher=user, release_type="formal",
        version="OLD.1.0.7", tag_name="OLD.1.0.7", release_doc="已保存的历史说明",
        git_hash="b" * 40, status="released",
    )
    claim = ReleaseVersionClaim.objects.create(
        repository=software.repository, release=record, base_version="1.0.7",
        release_type="formal", tag_name=record.tag_name, consumed=True,
    )
    remote.tags = [TagInfo(name=record.tag_name, commit_hash=record.git_hash)]
    mapping = tmp_path / "confirmed.json"
    mapping.write_text(json.dumps([{
        "release": str(record.pk), "software": str(software.pk), "basis": "已核对原版本计划与归档交付物",
    }]), encoding="utf-8")
    kwargs = {"mapping": mapping, "confirmed_by": user.username}
    report = StringIO()
    call_command("assign_software_release_history", stdout=report, **kwargs)
    data = json.loads(report.getvalue())
    assert data["proposals"][0]["status"] == "ready"
    url = f"/api/releases/{record.pk}/"
    assert api.get(url).data["data"]["software"] is None
    assert len(remote.tags) == 1
    for expected in ("confirmed", "unchanged"):
        report = StringIO()
        call_command("assign_software_release_history", stdout=report, apply=True, **kwargs)
        result = json.loads(report.getvalue())
        assert result["proposals"][0]["status"] == expected
        assert result["before"]["counts"]["claims"] == result["after"]["counts"]["claims"] == 1
    payload = api.get(url).data["data"]
    assert payload["software"] == str(software.pk)
    assert payload["tag_name"] == "OLD.1.0.7" and payload["release_doc"] == "已保存的历史说明"
    claim.refresh_from_db()
    assert claim.tag_name == "OLD.1.0.7" and claim.software_id is None
    params = {"project": str(project.pk), "software": str(software.pk), "release_type": "formal"}
    assert api.get("/api/releases/next-version/", params).data["data"]["next_version"] == "VA.1.0.8"
    draft = create_draft(api, project, software, release_type="formal", tag_name="VA.1.0.8").data["data"]
    doc = api.post(f"/api/releases/{draft['id']}/generate-doc/")
    assert doc.status_code == 200, doc.data
    assert api.get(f"/api/releases/{draft['id']}/").data["data"]["base_tag"] == "OLD.1.0.7"


@pytest.mark.django_db(transaction=True)
def test_postgresql_same_software_across_projects_claims_once(api, user, project, software_pair, other_project, remote):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connection

    from apps.workflow.models import WorkflowDefinition

    if connection.vendor != "postgresql":
        pytest.skip("需要 PostgreSQL 仓库行锁和独立连接")
    client, server = software_pair
    other, _ = other_project
    WorkflowDefinition.objects.create(
        project=project, repository=client.repository, biz_type="release", release_type="rc", name="候选版审批",
        node_config=[{"node_id": "review", "node_name": "确认", "mode": "any",
                      "approvers": [{"type": "user", "user_id": str(user.id)}]}],
    )
    ids = []
    for selected_project, software, date in (
        (project, client, "20261009"), (other, client, "20261010"), (project, server, "20261010"),
    ):
        created = create_draft(api, selected_project, software, tag_name=f"VA.1.0.1-rc_{date}")
        assert created.status_code == 201, created.data
        identity = created.data["data"]["id"]
        generated = api.post(f"/api/releases/{identity}/generate-doc/")
        assert generated.status_code == 200, generated.data
        ids.append(identity)
    start = Barrier(len(ids))

    def submit(identity):
        close_old_connections()
        parallel_client = APIClient()
        parallel_client.force_authenticate(user)
        try:
            start.wait(timeout=10)
            return parallel_client.post(f"/api/releases/{identity}/submit-audit/")
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=len(ids)) as executor:
        results = list(executor.map(submit, ids))
    assert sorted(result.status_code for result in results[:2]) == [200, 400]
    assert results[2].status_code == 200, results[2].data
    client_index = next(index for index, result in enumerate(results[:2]) if result.status_code == 200)
    assert "已有同版本在发布" in results[1 - client_index].data["message"]
    winning_instance = results[client_index].data["data"]["workflow_instance_id"]
    assert winning_instance != results[2].data["data"]["workflow_instance_id"]
    repeat = api.post(f"/api/releases/{ids[client_index]}/submit-audit/")
    assert repeat.status_code == 200 and repeat.data["data"]["workflow_instance_id"] == winning_instance


def test_pending_software_occupancy_only_advances_its_suggestion(api, project, software_pair, user, remote):
    from apps.workflow.models import WorkflowDefinition

    client, server = software_pair
    WorkflowDefinition.objects.create(
        project=project, repository=client.repository, biz_type="release", release_type="rc", name="候选审批",
        node_config=[{"node_id": "review", "node_name": "核对", "mode": "any",
                      "approvers": [{"type": "user", "user_id": str(user.id)}]}],
    )
    created = create_draft(api, project, client, tag_name="VA.1.0.7-rc").data["data"]
    url = f"/api/releases/{created['id']}/"

    def suggestion(software):
        return api.get("/api/releases/next-version/", {
            "project": str(project.pk), "software": str(software.pk), "release_type": "rc",
        }).data["data"]

    assert suggestion(client)["next_version"] == "VA.1.0.0"
    assert api.post(url + "generate-doc/").status_code == 200
    submitted = api.post(url + "submit-audit/")
    assert submitted.status_code == 200, submitted.data
    assert suggestion(client)["next_version"] == "VA.1.0.8"
    assert suggestion(client)["latest_tag"] is None
    assert suggestion(server)["next_version"] == "VA.1.0.0"
    workflow_id = submitted.data["data"]["workflow_instance_id"]
    revoked = api.post(f"/api/workflow/instances/{workflow_id}/revoke/", {"comment": "终止此次发布"}, format="json")
    assert revoked.status_code == 200, revoked.data
    assert suggestion(client)["next_version"] == "VA.1.0.0"


def test_legacy_namespaced_tag_stays_unassigned_until_confirmed(api, project, software_pair, user, remote):
    from apps.release.models import ReleaseRecord
    from apps.workflow.models import WorkflowDefinition
    from utils.provider.base import TagInfo

    software = software_pair[0]
    WorkflowDefinition.objects.create(
        project=project, repository=software.repository, biz_type="release", release_type="rc",
        name="候选版发布", node_config=[],
    )
    legacy = ReleaseRecord.objects.create(
        project=project, repository=software.repository, publisher=user, release_type="rc",
        version="VA.1.0.91", tag_name="client-a/VA.1.0.91-rc_20261009",
        git_hash="b" * 40, status="released",
    )
    remote.tags = [TagInfo(name=legacy.tag_name, commit_hash=legacy.git_hash)]
    response = api.get("/api/releases/next-version/", {
        "project": str(project.pk), "software": str(software.pk), "release_type": "rc",
    })
    assert response.data["data"]["next_version"] == "VA.1.0.0"
    assert create_draft(api, project, software, tag_name=legacy.tag_name).status_code == 400
    remote.tags = []
    existing_name = create_draft(api, project, software, tag_name=legacy.tag_name)
    assert existing_name.status_code == 400, existing_name.data
    assert "历史" in existing_name.data["message"]
    another_date = create_draft(api, project, software, tag_name="client-a/VA.1.0.91-rc_20261010")
    assert another_date.status_code == 201, another_date.data
    draft = another_date.data["data"]
    ReleaseRecord.objects.create(
        project=project, repository=software.repository, publisher=user, release_type="rc",
        version=draft["version"], tag_name=draft["tag_name"], git_hash="b" * 40, status="released",
    )
    url = f"/api/releases/{draft['id']}/"
    assert api.post(url + "generate-doc/").status_code == 200
    conflict = api.post(url + "submit-audit/")
    # 仓库模板应存在，否则无法到达占用核验。
    assert conflict.status_code == 400 and "历史" in conflict.data["message"], conflict.data


def test_history_confirmation_rejects_two_software_for_same_rc_source(project, software_pair, user, remote, tmp_path):
    import json
    from io import StringIO

    from django.core.management import call_command
    from django.core.management.base import CommandError

    from apps.release.models import ReleaseRecord
    from utils.provider.base import TagInfo

    client, server = software_pair
    values = {"project": project, "repository": client.repository, "publisher": user, "version": "VA.1.0.1",
              "status": "released", "git_hash": "a" * 40}
    rc = ReleaseRecord.objects.create(**values, tag_name="VA.1.0.1-rc", release_type="rc")
    formal = ReleaseRecord.objects.create(**values, tag_name="VA.1.0.1", release_type="formal", source_rc=rc)
    remote.tags = [TagInfo(name=release.tag_name, commit_hash=release.git_hash) for release in (rc, formal)]
    proposals = [
        {"release": str(record.pk), "software": str(software.pk), "basis": "原审批与 Tag"}
        for record, software in ((rc, client), (formal, server))
    ]
    mapping = tmp_path / "mapping.json"
    mapping.write_text(json.dumps(proposals), encoding="utf-8")
    report = StringIO()
    with pytest.raises(CommandError):
        call_command("assign_software_release_history", mapping=mapping, confirmed_by=user.username, apply=True, stdout=report)
    assert all(row["status"] == "blocked" for row in json.loads(report.getvalue())["proposals"])
    mapping.write_text(json.dumps(proposals[:1]), encoding="utf-8")
    call_command("assign_software_release_history", mapping=mapping, confirmed_by=user.username, apply=True, stdout=StringIO())
    mapping.write_text(json.dumps(proposals[1:]), encoding="utf-8")
    with pytest.raises(CommandError):
        call_command("assign_software_release_history", mapping=mapping, confirmed_by=user.username, apply=True, stdout=StringIO())
    formal.refresh_from_db()
    assert formal.source_rc_id == rc.pk and formal.software_id is None


@pytest.mark.parametrize("kind,suffix", [("rc", "rc"), ("beta", "alpha")])
def test_software_candidates_keep_illegal_commit_in_fixed_review_scope(api, project, software_pair, user, remote, kind, suffix):
    from apps.repository.models import CommitRecord
    from apps.workflow.models import WorkflowDefinition

    software = software_pair[0]
    WorkflowDefinition.objects.create(
        project=project, repository=software.repository, biz_type="release", release_type=kind,
        name="独立版本审核", node_config=[],
    )
    CommitRecord.objects.create(
        project=project, repository=software.repository, commit_hash="1" * 40,
        message="普通提交", author="原审查人", committed_at="2026-10-22T10:00:00+08:00",
        review_status="illegal", review_reason="历史提交缺少规范信息",
    )
    draft = create_draft(api, project, software, release_type=kind, tag_name=f"VA.1.0.1-{suffix}").data["data"]
    url = f"/api/releases/{draft['id']}/"
    assert api.post(url + "generate-doc/").status_code == 200
    commits = api.get(url + "commits/").data["data"]["results"]
    assert len(commits) == 1
    assert commits[0]["review_status"] == "illegal" and commits[0]["review_reason"] == "历史提交缺少规范信息"
    assert api.post(url + "submit-audit/").status_code == 200
