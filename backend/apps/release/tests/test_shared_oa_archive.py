"""通过公开 REST 和隔离 OA 验证共享版本的归档项目。"""
from shutil import copytree
from uuid import uuid4

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.package.models import PackageTask
from apps.package.tests.test_package_permissions import grant_delete_task_permission
from apps.project.models import Project, ProjectMember
from apps.project.services import ensure_repository_component
from apps.release.tests.test_oa_archive import archive_case as _archive_case
from apps.release.tests.test_oa_archive_submission import oa_http as _oa_http
from apps.software.models import ProjectSoftware, Software

pytestmark = pytest.mark.django_db
archive_case = _archive_case
oa_http = _oa_http


@pytest.fixture
def shared_archive(archive_case, tmp_path):
    origin_client, release, origin_task = archive_case
    software = Software.objects.create(
        repository=release.repository, owner=release.publisher, name="桌面交付软件", slug="desktop",
    )
    release.software = software
    release.tag_name = "desktop/V1.2.3"
    release.save(update_fields=["software", "tag_name"])
    origin_task.software = software
    origin_task.save(update_fields=["software"])
    consumer_user = User.objects.create_user(username="archive-consumer")
    consumer = Project.objects.create(name="归档办理项目", code="OA-CONSUMER", leader=consumer_user)
    ProjectMember.objects.create(project=consumer, user=consumer_user, role="manager")
    ProjectMember.objects.create(project=consumer, user=release.publisher, role="developer")
    ensure_repository_component(release.repository, consumer)
    ProjectSoftware.objects.create(project=consumer, software=software)
    workspace = copytree(origin_task.workspace_path, tmp_path / "consumer-build")
    task = PackageTask.objects.create(
        release=release, software=software, project=consumer, repository=release.repository,
        triggered_by=consumer_user, name="乙项目正式安装包", status="success", version=release.version,
        tag_name=release.tag_name, workspace_path=str(workspace),
        config_snapshot=origin_task.config_snapshot, artifact_info=origin_task.artifact_info,
    )
    client = APIClient()
    client.force_authenticate(consumer_user)
    return client, consumer, task, origin_client, release, origin_task


def archive_url(release, action, project=None):
    query = f"?project={project.pk}" if project else ""
    return f"/api/releases/{release.pk}/oa-archive/{action}/{query}"


def directory(task):
    return {"task_id": str(task.pk), "scope": "directory", "path": "."}


def test_共享归档按任务项目办理并保留已删除任务的申请副本(shared_archive, oa_http):
    client, consumer, task, origin_client, release, origin_task = shared_archive
    release.source_repository_name_snapshot = "归档版本原主仓库名称"
    release.save(update_fields=["source_repository_name_snapshot"])
    options = client.get(archive_url(release, "options", consumer))
    assert options.status_code == 200, options.data
    assert [row["task_id"] for row in options.data["data"]["directories"]] == [str(task.pk)]
    assert client.post(archive_url(release, "prepare", consumer), directory(origin_task), format="json").status_code == 404
    assert client.get(archive_url(release, "records")).status_code == 404

    ready = client.post(archive_url(release, "prepare", consumer), directory(task), format="json")
    assert ready.status_code == 200
    form = ready.data["data"]["form"]
    assert form["soft_name"] == "桌面交付软件"
    assert form["soft_version"] == "V1.2.3"
    assert form["git_svn"] == "main" and form["sn_code"] == "0123456789abcdef0123456789abcdef01234567"
    form["soft_name"] = "本次 OA 副本"
    oa_http.mode = "failure"
    submitted = client.post(archive_url(release, "submit", consumer), {
        **directory(task), "form": form, "submission_id": str(uuid4()),
    }, format="json")
    assert submitted.status_code == 201, submitted.data
    record = submitted.data["data"]
    assert record["form"] == oa_http.requests[0]["body"]
    assert record["source"]["project_id"] == str(consumer.pk)
    assert record["source"]["release_project_id"] == str(release.project_id)
    assert record["source"]["software_name"] == "桌面交付软件"
    assert record["source"]["tag_name"] == "desktop/V1.2.3"
    assert record["source"]["repository_name"] == "归档版本原主仓库名称"
    assert origin_client.get(archive_url(release, "records")).data["data"] == []

    confirm = {"application_id": record["id"], "confirmation": "checked_no_order", "evidence": "隔离 OA 已核对"}
    assert origin_client.post(archive_url(release, "confirm-no-order"), confirm, format="json").status_code == 404
    result = client.post(archive_url(release, "confirm-no-order", consumer), confirm, format="json")
    assert result.status_code == 200
    grant_delete_task_permission(task.triggered_by)
    assert client.delete(f"/api/packages/tasks/{task.pk}/").status_code == 200
    consumer.project_components.filter(repository=release.repository).update(is_active=False)
    assert client.get(archive_url(release, "records", consumer)).data["data"] == [result.data["data"]]
    detail = client.get(f"/api/releases/{release.pk}/", {"project": str(consumer.pk)})
    assert detail.status_code == 200 and detail.data["data"]["project"] == str(consumer.pk)
    assert detail.data["data"]["package_tasks"] == [] and detail.data["data"]["shared_readonly"]
    assert origin_client.get(archive_url(release, "records")).data["data"] == []
    assert len(oa_http.requests) == 1
    assert origin_client.get(archive_url(release, "options")).data["data"]["directories"][0]["task_id"] == str(origin_task.pk)


def test_维保兼任其他项目管理员仍无法办理当前项目归档(shared_archive):
    client, consumer, task, _, release, _ = shared_archive
    user = task.triggered_by
    consumer.leader = release.publisher
    consumer.save(update_fields=["leader"])
    ProjectMember.objects.filter(project=consumer, user=user).update(role="maintainer")
    ProjectMember.objects.create(project=release.project, user=user, role="manager")
    assert client.get(archive_url(release, "records", consumer)).data["data"] == []
    assert client.get(archive_url(release, "options", consumer)).status_code == 403
    assert client.post(archive_url(release, "prepare", consumer), directory(task), format="json").status_code == 403


def test_工作台和搜索共享版本且不泄漏原项目任务(shared_archive):
    from django.utils import timezone

    client, consumer, task, _, release, origin_task = shared_archive
    release.released_at = timezone.now()
    release.save(update_fields=["released_at"])
    summary = client.get("/api/releases/dashboard/maintainer-summary/").data["data"]
    assert summary["software_count"] == summary["stats"]["released_count"] == 1
    assert summary["projects"][0]["software"][0]["id"] == str(release.software_id)
    assert [item["id"] for item in summary["recent_tasks"]] == [str(task.pk)]
    matches = client.get("/api/search/", {"q": release.software.name}).data["data"]
    assert [item["id"] for item in matches["releases"]] == [str(release.pk)]
    assert matches["releases"][0]["path"] == f"/releases/{release.pk}?project={consumer.pk}"
    results = client.get("/api/search/", {"q": release.version}).data["data"]
    assert [item["id"] for item in results["packages"]] == [str(task.pk)]
    assert client.get(f"/api/packages/tasks/{origin_task.pk}/").status_code == 404

    ProjectMember.objects.create(project=release.project, user=task.triggered_by, role="maintainer")
    ProjectSoftware.objects.create(project=release.project, software=release.software)
    summary = client.get("/api/releases/dashboard/maintainer-summary/").data["data"]
    assert summary["software_count"] == summary["stats"]["released_count"] == 1
    assert all(row["release_count"] == 1 for row in summary["projects"])
    consumer.project_components.filter(repository=release.repository).update(is_active=False)
    summary = client.get("/api/releases/dashboard/maintainer-summary/").data["data"]
    assert next(row for row in summary["projects"] if row["id"] == str(consumer.pk))["release_count"] == 0
    assert summary["stats"]["package_total"] == 2


def test_项目详情和打包速览只统计有权的版本和任务(shared_archive):
    from apps.package.models import PackageConfig

    client, consumer, task, _, release, origin_task = shared_archive
    config = PackageConfig.objects.create(software=release.software, name="桌面打包")
    PackageTask.objects.filter(pk__in=[task.pk, origin_task.pk]).update(config=config, triggered_by=task.triggered_by)
    PackageTask.objects.filter(pk=origin_task.pk).update(status="failure")
    selected = client.get(f"/api/projects/{consumer.pk}/").data["data"]
    assert selected["software_count"] == selected["published_version_count"] == selected["package_count"] == 1
    assert client.get(f"/api/projects/{release.project_id}/").status_code == 404

    favorite = client.post(f"/api/packages/configs/{config.pk}/favorite/", {"project": str(consumer.pk)}, format="json")
    assert favorite.status_code == 200, favorite.data
    overview = client.get("/api/packages/configs/favorites/").data["data"]
    assert [item["last_task"]["id"] for item in overview] == [str(task.pk)]
    stats = client.get("/api/packages/tasks/stats/").data["data"]
    assert stats["total"] == 1 and stats["success"] == 1 and stats["failure"] == 0
    assert client.get(f"/api/packages/tasks/{origin_task.pk}/").status_code == 404
    ProjectMember.objects.filter(project=consumer, user=task.triggered_by).delete()
    assert client.get("/api/packages/configs/favorites/").data["data"] == []
    assert client.get("/api/packages/tasks/stats/").data["data"]["total"] == 0


def test_维保待归属范围与旧仓库书签各自匹配列表和摘要(shared_archive):
    from apps.release.models import ReleaseRecord

    _, _, _, origin_client, release, _ = shared_archive
    ProjectSoftware.objects.create(project=release.project, software=release.software)
    old = ReleaseRecord.objects.create(project=release.project, repository=release.repository,
                                       version="旧版", tag_name="v0.0.1", status="released")
    params = {"project": str(release.project_id), "repository": str(release.repository_id), "status": "released"}
    old_scope = origin_client.get("/api/releases/", {**params, "unassigned": True}).data["data"]
    assert [row["id"] for row in old_scope["results"]] == [str(old.pk)]
    old_bookmark = origin_client.get("/api/releases/", params).data["data"]
    assert {row["id"] for row in old_bookmark["results"]} == {str(old.pk), str(release.pk)}
    summary = origin_client.get("/api/releases/dashboard/maintainer-summary/").data["data"]
    [project] = [item for item in summary["projects"] if item["id"] == str(release.project_id)]
    legacy = next(item for item in project["software"] if item["software_id"] is None)
    assert "未分组" in legacy["name"] and legacy["release_count"] == old_scope["total"]
