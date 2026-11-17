"""软件身份和真实发起项目在对外交付中的公开行为。"""
import io
from zipfile import ZipFile

import pytest
from docx import Document
from rest_framework.test import APIClient

from apps.account.models import User
from apps.notification.services import NotificationService
from apps.package.models import PackageTask
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.software.models import Software

pytestmark = pytest.mark.django_db


@pytest.fixture
def software_version(user, project, repository):
    software = Software.objects.create(repository=repository, owner=user, slug="client-a", name="软件新名")
    return ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=user, software=software,
        software_name_snapshot="客户端发布名", source_repository_name_snapshot="原始主仓库", version="VA.9.0.1", tag_name="client-a/VA.9.0.1",
        git_hash="7" * 40, branch="main", status="released",
        release_doc=("保存正文开头\n\n表外甲<br>表外乙与 `表示<br>原文`\n\n"
                     "```html\n  code<br>line\n\n| code starts a table-like line\n  code ends |\n```\n\n| 项目 | 内容 |\n| --- | --- |\n"
                     "| 变更内容 | 原来保存的说明\n内含 A\\|B 分隔符<br />末行与 `单元格<br>原文` |\n\n保存正文末尾"),
    )


def test_release_download_files_keep_the_published_software_identity(software_version, user, settings):
    settings.DOWNLOAD_ALLOWED_CIDRS = "127.0.0.1/32"
    client = APIClient()
    client.force_authenticate(user)
    prefix = f"/api/releases/{software_version.pk}/"
    markdown = client.get(prefix + "export-md/", REMOTE_ADDR="127.0.0.1")
    assert markdown.status_code == 200
    text = markdown.content.decode()
    for value in ("客户端发布名", "client-a/VA.9.0.1", "7" * 40, "原始主仓库", "保存正文末尾"):
        assert value in text
    assert "软件新名" not in text and software_version.repository.name not in text
    assert "  code<br>line\n\n| code starts a table-like line\n  code ends |" in text
    assert "client-a" in markdown["Content-Disposition"]

    word = client.get(prefix + "export-word/", REMOTE_ADDR="127.0.0.1")
    assert word.status_code == 200
    with ZipFile(io.BytesIO(word.content)) as archive:
        assert archive.testzip() is None and "word/document.xml" in archive.namelist()
    document = Document(io.BytesIO(word.content))
    identity = {cell.text for row in document.tables[0].rows for cell in row.cells}
    assert {"客户端发布名", "VA.9.0.1", "client-a/VA.9.0.1", "7" * 40, "原始主仓库"} <= identity
    content = {cell.text for row in document.tables[1].rows for cell in row.cells}
    assert "原来保存的说明\n内含 A|B 分隔符\n末行与 `单元格<br>原文`" in content
    paragraphs = [paragraph.text for paragraph in document.paragraphs]
    body = next(paragraph for paragraph in paragraphs if paragraph.startswith("保存正文开头"))
    assert "表外甲\n表外乙与 `表示<br>原文`" in body
    assert "  code<br>line\n\n| code starts a table-like line\n  code ends |" in body
    assert paragraphs.index(body) < paragraphs.index("保存正文末尾")

    pdf = client.get(prefix + "export-pdf/", REMOTE_ADDR="127.0.0.1")
    assert pdf.status_code == 200
    assert pdf.content.startswith(b"%PDF-") and pdf.content.rstrip().endswith(b"%%EOF")
    assert "client-a" in pdf["Content-Disposition"]
    assert client.get(prefix).data["data"]["release_doc"].endswith("保存正文末尾")


def test_cross_project_build_only_notifies_its_authorized_operator(software_version, user):
    other_user = User.objects.create_user(username="build-consumer", password="test")
    consumer = Project.objects.create(name="使用项目", code="USE")
    link = ProjectMember.objects.create(project=consumer, user=other_user, role="developer")
    task = PackageTask.objects.create(
        project=consumer, repository=software_version.repository, release=software_version,
        software=software_version.software, triggered_by=other_user, name="使用项目任务",
        config_snapshot={"software_name": "构建快照客户端"}, version=software_version.version,
        tag_name=software_version.tag_name, commit_hash=software_version.git_hash, status="success",
    )
    NotificationService.notify_release_released(software_version)
    NotificationService.notify_package_result(task, software_version)

    origin = APIClient()
    origin.force_authenticate(user)
    notified = origin.get("/api/notifications/").data["data"]["results"]
    assert [(item["related_type"], item["related_id"]) for item in notified] == [
        ("release_record", str(software_version.pk)),
    ]
    assert "客户端发布名" in notified[0]["content"] and ("7" * 40) in notified[0]["content"]

    builder = APIClient()
    builder.force_authenticate(other_user)
    notified = builder.get("/api/notifications/").data["data"]["results"]
    assert [(item["related_type"], item["related_id"]) for item in notified] == [("package_task", str(task.pk))]
    assert all(value in notified[0]["content"] for value in (
        "构建快照客户端", "VA.9.0.1", "client-a/VA.9.0.1", "7" * 40,
    ))
    link.delete()
    NotificationService.notify_package_result(task, software_version)
    assert len(builder.get("/api/notifications/").data["data"]["results"]) == 1


def test_approval_and_weekly_read_saved_software_identity_without_cross_project_build_status(software_version, user, settings):
    import csv

    from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask

    release = software_version
    definition = WorkflowDefinition.objects.create(project=release.project, repository=release.repository, biz_type="release")
    instance = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id=str(release.pk), source_project=release.project,
        created_by=user, status="running",
    )
    release.workflow_instance = instance
    release.save(update_fields=["workflow_instance"])
    task = WorkflowTask.objects.create(instance=instance, node_id="first", node_name="交付审批", approver=user, status="pending")
    NotificationService.notify_task_created(task)
    linked = Project.objects.create(code="SHARED-BUILD", name="其他任务项目")
    PackageTask.objects.create(
        project=linked, repository=release.repository, release=release, software=release.software,
        triggered_by=user, name="不可见任务", status="failure",
    )
    settings.DOWNLOAD_ALLOWED_CIDRS = "127.0.0.1/32"
    api = APIClient()
    api.force_authenticate(user)
    detail = api.get(f"/api/workflow/instances/{instance.pk}/").data["data"]
    assert detail["software_name"] == "客户端发布名"
    assert detail["repository_name"] == "原始主仓库"
    assert detail["package_status"] == ""
    reminders = api.get("/api/notifications/remind-summary/").data["data"]
    assert reminders["todo_tasks"][0]["instance_id"] == str(instance.pk)
    assert reminders["todo_tasks"][0]["software_name"] == "客户端发布名"
    notices = api.get("/api/notifications/").data["data"]["results"]
    assert notices[0]["related_id"] == str(instance.pk)
    assert all(value in notices[0]["content"] for value in ("客户端发布名", release.tag_name, release.git_hash))
    report = api.get("/api/releases/dashboard/weekly-report/", REMOTE_ADDR="127.0.0.1")
    assert report.status_code == 200 and report.content.startswith(b"\xef\xbb\xbf")
    [record] = list(csv.DictReader(io.StringIO(report.content.decode("utf-8-sig"))))
    assert (record["软件"], record["发布 Tag"], record["源码 SHA"]) == ("客户端发布名", release.tag_name, release.git_hash)
