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


def test_other_project_packages_the_published_version_with_its_own_permissions(
    api, project, software_pair, other_project, remote, user, django_capture_on_commit_callbacks, monkeypatch,
):
    from apps.credential.models import CredentialUsageLog
    from apps.package.models import PackageConfig, PackageTask
    from apps.project.models import ProjectMember
    from apps.release.models import ReleaseRecord
    from apps.workflow.models import WorkflowDefinition

    software, unrelated = software_pair
    target, operator = other_project
    WorkflowDefinition.objects.create(
        project=project, repository=software.repository, biz_type="release", release_type="rc",
        name="候选版发布", node_config=[],
    )
    release_url = f"/api/releases/{create_draft(api, project, software).data['data']['id']}/"
    assert api.post(release_url + "generate-doc/").status_code == 200
    assert api.post(release_url + "submit-audit/").status_code == 200
    version = api.get(release_url).data["data"]
    config = PackageConfig.objects.create(software=software, name="麒麟交付", custom_script="echo original")
    wrong = PackageConfig.objects.create(software=unrelated, name="其他软件")
    source_task = PackageTask.objects.create(
        project=project, repository=software.repository, software=software, config=config,
        release_id=version["id"], name="甲的任务", status="success",
    )
    viewer = APIClient()
    viewer.force_authenticate(operator)
    payload = {"release_id": version["id"], "project": str(target.pk), "software": str(software.pk)}
    url = f"/api/packages/configs/{config.pk}/trigger/"
    assert viewer.post(url, {"release_id": version["id"]}, format="json").status_code == 400
    assert viewer.post(url, {**payload, "project": str(project.pk)}, format="json").status_code == 404
    assert viewer.post(f"/api/packages/configs/{wrong.pk}/trigger/", payload, format="json").status_code == 404
    dispatched = []
    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", dispatched.append)
    before = [tag.name for tag in remote.tags]
    with django_capture_on_commit_callbacks(execute=True):
        result = viewer.post(url, payload, format="json")
    assert result.status_code == 201, result.data
    task = viewer.get(f"/api/packages/tasks/{result.data['data']['id']}/").data["data"]
    assert {field: str(task[field]) for field in ("project", "software", "release", "triggered_by")} == {
        "project": str(target.pk), "software": str(software.pk), "release": version["id"],
        "triggered_by": str(operator.pk),
    }
    assert (task["tag_name"], task["commit_hash"], task["version"]) == (
        version["tag_name"], version["git_hash"], version["version"],
    )
    assert "echo original" not in str(task["config_snapshot"])
    assert dispatched == [task["id"]]
    assert [tag.name for tag in remote.tags] == before
    assert ReleaseRecord.objects.count() == 1
    assert CredentialUsageLog.objects.filter(project=target, actor=operator, result="success").exists()
    assert viewer.get(f"/api/packages/tasks/{source_task.pk}/logs/?tail=10").status_code == 404
    assert [row["id"] for row in viewer.get(release_url, {"project": str(target.pk)}).data["data"]["package_tasks"]] == [
        task["id"],
    ]
    ProjectMember.objects.filter(project=target, user=operator).update(role="maintainer")
    target.leader = user
    target.save(update_fields=["leader"])
    assert viewer.post(url, payload, format="json").status_code == 403


def test_release_dispatches_only_the_selected_software_config_in_the_origin_project(
    api, project, software_pair, other_project, remote, django_capture_on_commit_callbacks, monkeypatch,
):
    from apps.package.models import PackageConfig, PackageImage
    from apps.workflow.models import WorkflowDefinition

    software, unrelated = software_pair
    selected = PackageConfig.objects.create(software=software, name="已选配置", auto_package_on_release=True)
    image = PackageImage.objects.create(name="配置停用测试镜像", image="test:software")
    deselected = PackageConfig.objects.create(
        software=software, name="已取消配置", auto_package_on_release=True, image=image,
    )
    wrong = PackageConfig.objects.create(software=unrelated, name="其他软件配置", auto_package_on_release=True)
    inactive = PackageConfig.objects.create(
        software=software, name="已停用配置", auto_package_on_release=True, is_active=False,
    )
    WorkflowDefinition.objects.create(
        project=project, repository=software.repository, biz_type="release", release_type="rc",
        name="候选版发布", node_config=[],
    )
    for unavailable in (wrong, inactive):
        invalid = create_draft(api, project, software, package_config_ids=[str(unavailable.pk)])
        assert invalid.status_code == 400, invalid.data
    response = create_draft(api, project, software, package_config_ids=[str(deselected.pk), str(selected.pk)])
    assert response.status_code == 201, response.data
    draft = response.data["data"]
    assert set(draft["package_config_ids"]) == {str(selected.pk), str(deselected.pk)}
    config_url = f"/api/packages/configs/{deselected.pk}/"
    assert api.delete(config_url).status_code == 400
    disabled = api.patch(config_url, {"is_active": False}, format="json")
    assert disabled.status_code == 200, disabled.data
    url = f"/api/releases/{draft['id']}/"
    assert api.post(url + "generate-doc/").status_code == 200
    dispatched = []
    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", dispatched.append)
    with django_capture_on_commit_callbacks(execute=True):
        assert api.post(url + "submit-audit/").status_code == 200
    release = api.get(url).data["data"]
    tasks = api.get("/api/packages/tasks/", {"release": release["id"]}).data["data"]["results"]
    assert release["status"] == "released"
    assert len(tasks) == 1 and dispatched == [tasks[0]["id"]]
    task = tasks[0]
    assert tuple(str(task[field]) for field in ("config", "project", "software", "tag_name")) == (
        str(selected.pk), str(project.pk), str(software.pk), release["tag_name"],
    )
    assert task["config_snapshot"]["trigger_source"] == "auto_release"


@pytest.mark.django_db(transaction=True)
@pytest.mark.parametrize("operation", ["cleanup", "consumer"])
def test_postgresql_shared_package_serializes_cleanup_and_consumer_delete(
    project, software_pair, other_project, user, remote, monkeypatch, operation,
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from django.db import close_old_connections, connection

    from apps.package.models import PackageConfig
    from apps.package.services import tasks
    from apps.release.models import ReleaseRecord
    from utils.provider.base import TagInfo

    if connection.vendor != "postgresql":
        pytest.skip("跨项目任务与删除竞争需要真实 PostgreSQL")
    software = software_pair[0]
    target, operator = other_project
    identity = {"project": project, "repository": software.repository, "software": software,
                "publisher": user, "status": "released", "git_hash": "a" * 40}
    rc = ReleaseRecord.objects.create(
        **identity, release_type="rc", version="VA.8.0.0", tag_name="client-a/VA.8.0.0-rc",
    )
    formal = ReleaseRecord.objects.create(
        **identity, release_type="formal", version="VA.8.0.0", tag_name="client-a/VA.8.0.0", source_rc=rc,
    )
    remote.tags = [TagInfo(name=item.tag_name, commit_hash=item.git_hash) for item in (rc, formal)]
    config = PackageConfig.objects.create(software=software, name="并发共享配置")
    checked, resume, starting_delete, finished_delete = Event(), Event(), Event(), Event()
    original_resolve = tasks.resolve_credential

    def pause_with_repository_locked(*args, **kwargs):
        value = original_resolve(*args, **kwargs)
        checked.set()
        assert resume.wait(12)
        return value

    monkeypatch.setattr(tasks, "resolve_credential", pause_with_repository_locked)
    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", lambda *_: None)

    def request(create):
        close_old_connections()
        client = APIClient()
        client.force_authenticate(operator if create or operation == "consumer" else user)
        try:
            if create:
                return client.post(f"/api/packages/configs/{config.pk}/trigger/", {
                    "release_id": str(rc.pk), "project": str(target.pk), "software": str(software.pk),
                }, format="json")
            starting_delete.set()
            if operation == "consumer":
                return client.delete(f"/api/projects/{target.pk}/")
            return client.post(f"/api/releases/{rc.pk}/cleanup-tag/", {"tag_name": rc.tag_name}, format="json")
        finally:
            if not create:
                finished_delete.set()
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as workers:
        creating = workers.submit(request, True)
        try:
            assert checked.wait(10)
            removing = workers.submit(request, False)
            assert starting_delete.wait(10)
            assert not finished_delete.wait(1), "删除没有等待乙项目首个任务的仓库锁"
        finally:
            resume.set()
        created = creating.result(timeout=10)
        result = removing.result(timeout=10)

    assert created.status_code == 201, created.data
    if operation == "consumer":
        assert result.status_code == 400 and "排队或运行" in str(result.data)
    else:
        assert result.data["data"]["status"] == "blocked"
        assert "排队或运行" in result.data["data"]["reason"]
    assert rc.tag_name in {tag.name for tag in remote.tags}


@pytest.mark.django_db(transaction=True)
def test_postgresql_consumer_deletion_waits_for_archive_protection(
    project, software_pair, other_project, user,
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from uuid import uuid4

    from django.db import close_old_connections, connection, transaction

    from apps.package.models import PackageTask
    from apps.release.models import OaArchiveApplication, ReleaseRecord
    from apps.repository.models import Repository

    if connection.vendor != "postgresql":
        pytest.skip("跨项目归档引用保护竞争需要真实 PostgreSQL")
    software = software_pair[0]
    target, operator = other_project
    release = ReleaseRecord.objects.create(
        project=project, repository=software.repository, software=software, publisher=user,
        release_type="formal", status="released", version="VA.8.1.0", tag_name="client-a/VA.8.1.0",
        git_hash="a" * 40,
    )
    task = PackageTask.objects.create(
        project=target, repository=software.repository, software=software, release=release, status="success",
        name="乙的归档来源私有任务",
    )
    protected, resume, starting_delete, finished_delete = Event(), Event(), Event(), Event()

    def protect():
        close_old_connections()
        try:
            with transaction.atomic():
                Repository.objects.select_for_update(no_key=True).get(pk=software.repository_id)
                ReleaseRecord.objects.select_for_update().get(pk=release.pk)
                PackageTask.objects.select_for_update().get(pk=task.pk)
                # 模拟已持锁的归档事实，OA 跨项目准备及发送由后续切片接入。
                OaArchiveApplication.objects.create(
                    submission_id=uuid4(), release=release, task=task, protected_release=release,
                    protected_task=task, operator=operator, artifact_path=".", status="sending",
                )
                protected.set()
                assert resume.wait(12)
        finally:
            close_old_connections()

    def delete():
        close_old_connections()
        try:
            client = APIClient()
            client.force_authenticate(operator)
            starting_delete.set()
            return client.delete(f"/api/projects/{target.pk}/")
        finally:
            finished_delete.set()
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as workers:
        saving = workers.submit(protect)
        try:
            assert protected.wait(10)
            removing = workers.submit(delete)
            assert starting_delete.wait(10)
            assert not finished_delete.wait(1)
        finally:
            resume.set()
        saving.result(timeout=10)
        result = removing.result(timeout=10)
    assert result.status_code == 400
    assert "OA 归档" in str(result.data) and task.name not in str(result.data)
    assert OaArchiveApplication.objects.filter(protected_task=task, status="sending").exists()


def test_retry_uses_original_protected_snapshot_and_rechecks_project(
    api, project, software_pair, other_project, user, django_capture_on_commit_callbacks, monkeypatch, tmp_path,
):
    from apps.account.models import User
    from apps.package.models import PackageConfig, PackageImage, PackageTask
    from apps.project.models import ProjectMember
    from apps.release.models import ReleaseRecord

    software = software_pair[0]
    target, operator = other_project
    release = ReleaseRecord.objects.create(
        project=project, repository=software.repository, software=software, publisher=user, status="released",
        version="VA.8.0.0", tag_name="client-a/VA.8.0.0", git_hash="a" * 40,
    )
    image = PackageImage.objects.create(name="重试测试镜像", image="test:retry")
    config = PackageConfig.objects.create(software=software, name="原配置", image=image, custom_script="echo first")
    config_url = f"/api/packages/configs/{config.pk}/"
    issued = []
    workspace_file = tmp_path / "保留失败日志.txt"
    workspace_file.write_text("首次尝试结果")
    def dispatch(task_id):
        task = PackageTask.objects.get(pk=task_id)
        issued.append(task.config_snapshot["custom_script"])
        if len(issued) == 1:
            PackageTask.objects.filter(pk=task_id).update(status="failure", workspace_path=str(tmp_path))

    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", dispatch)
    viewer = APIClient()
    viewer.force_authenticate(operator)
    with django_capture_on_commit_callbacks(execute=True):
        initial = viewer.post(config_url + "trigger/", {
            "release_id": str(release.pk), "project": str(target.pk), "software": str(software.pk),
        }, format="json")
    assert initial.status_code == 201, initial.data
    first = initial.data["data"]
    task_url = f"/api/packages/tasks/{first['id']}/"
    assert viewer.get(task_url).data["data"]["can_retry"]
    assert api.patch(config_url, {"custom_script": "echo updated"}, format="json").status_code == 200
    readonly = User.objects.create_user(username="retry_maintainer")
    ProjectMember.objects.create(project=target, user=readonly, role="maintainer")
    reader = APIClient()
    reader.force_authenticate(readonly)
    assert not reader.get(task_url).data["data"]["can_retry"]
    assert reader.post(task_url + "retry/").status_code == 403
    with django_capture_on_commit_callbacks(execute=True):
        result = viewer.post(task_url + "retry/")
    assert result.status_code == 201, result.data
    replacement = result.data["data"]
    assert str(replacement["retry_of"]) == first["id"]
    for field in ("project", "software", "release", "tag_name", "commit_hash", "version"):
        assert replacement[field] == first[field]
    assert issued == ["echo first", "echo first"]
    assert "echo first" not in str(replacement)
    assert viewer.get(task_url).data["data"]["status"] == "failure"
    again = viewer.post(task_url + "retry/")
    assert again.status_code == 200 and again.data["data"]["id"] == replacement["id"]
    administrator = User.objects.create_user(username="retry_superuser", is_superuser=True)
    admin = APIClient()
    admin.force_authenticate(administrator)
    blocked = admin.delete(task_url)
    assert blocked.status_code == 400 and "保留原打包记录" in str(blocked.data)
    assert workspace_file.read_text() == "首次尝试结果"
    link = ProjectSoftware.objects.get(project=target, software=software)
    stopped = viewer.patch(f"/api/projects/{target.pk}/software/{link.pk}/", {"is_active": False}, format="json")
    assert stopped.status_code == 200, stopped.data
    assert viewer.post(task_url + "retry/").status_code == 400
    assert viewer.get(task_url).status_code == 200


def test_software_tag_deletion_preserves_ambiguous_and_changed_remote_references(
    api, project, software_pair, other_project, user, remote,
):
    from apps.package.models import PackageTask
    from apps.release.models import ReleaseRecord
    from utils.provider.base import TagInfo

    software = software_pair[0]
    target, operator = other_project
    original = ReleaseRecord.objects.create(
        project=project, repository=software.repository, software=software, publisher=user, release_type="formal",
        status="released", version="VA.8.0.0", tag_name="client-a/VA.8.0.0", git_hash="a" * 40,
    )
    url = f"/api/releases/{original.pk}/"
    payload = {"tag_name": original.tag_name}
    remote.tags = [TagInfo(name=original.tag_name, commit_hash="b" * 40)]
    drift = api.post(url + "delete-released/", payload, format="json")
    assert drift.status_code == 400 and "快照不一致" in str(drift.data)
    assert remote.tags[0].commit_hash == "b" * 40
    remote.tags[0].commit_hash = original.git_hash
    duplicate = ReleaseRecord.objects.create(
        project=target, repository=software.repository, publisher=operator, release_type="formal",
        status="released", version="乙未归属私有记录", tag_name=original.tag_name, git_hash=original.git_hash,
    )
    PackageTask.objects.create(
        project=target, repository=software.repository, release=duplicate, name="乙私有执行名称", status="success",
    )
    reject = api.post(url + "delete-released/", payload, format="json")
    assert reject.status_code == 400 and "同名 Tag" in str(reject.data)
    assert "乙" not in str(reject.data)
    assert remote.tags[0].name == original.tag_name
    duplicate.delete()
    assert api.post(url + "cleanup-tag/", payload, format="json").status_code == 400
    assert api.post(url + "delete-released/", payload, format="json").status_code == 200
    assert not remote.tags


def test_archive_api_hides_a_reused_task_from_the_origin_project(
    api, project, software_pair, other_project, user,
):
    from uuid import uuid4

    from apps.package.models import PackageTask
    from apps.release.models import ReleaseRecord

    software = software_pair[0]
    target, operator = other_project
    release = ReleaseRecord.objects.create(
        project=project, repository=software.repository, software=software, publisher=user, release_type="formal",
        status="released", version="VA.8.0.0", tag_name="client-a/VA.8.0.0", git_hash="a" * 40,
    )
    task = PackageTask.objects.create(
        project=target, repository=software.repository, release=release, software=software, triggered_by=operator,
        name="乙复用的归档产物", status="success",
    )
    url = f"/api/releases/{release.pk}/oa-archive/"
    assert api.get(url + "options/").data["data"] == {"artifacts": [], "svn_tasks": [], "directories": []}
    form = {"docCreator": "申请人", "soft_name": "软件", "soft_version": "8.0.0", "developer": "开发人员"}
    for action in ("prepare", "submit"):
        args = {"scope": "directory", "path": ".", "source_kind": "local"}
        if action == "submit":
            args.update({"submission_id": str(uuid4()), "form": form})
        protected = api.post(url + action + "/", {**args, "task_id": str(task.pk)}, format="json")
        nonexistent = api.post(url + action + "/", {**args, "task_id": str(uuid4())}, format="json")
        assert protected.status_code == nonexistent.status_code == 404
        assert protected.data == nonexistent.data
