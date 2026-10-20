"""通过 REST API 验证维保人员读取任务日志与产物的边界。"""
import subprocess
import sys
import zipfile
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from pytest_django.fixtures import Settings
from rest_framework.test import APIClient

from apps.account.models import User
from apps.package.models import PackageConfig, PackageImage, PackageTask
from apps.project.models import Project, ProjectComponent, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository

pytestmark = pytest.mark.django_db


@pytest.fixture
def reading_context(tmp_path: Path, settings: Settings) -> SimpleNamespace:
    """他人发起的项目任务，文件系统使用隔离的真实工作区。"""
    manager = User.objects.create_user(username="package_read_manager")
    reader = User.objects.create_user(username="package_read_maintainer")
    project = Project.objects.create(code="READ", name="维保项目", leader=manager)
    ProjectMember.objects.create(project=project, user=manager, role="manager")
    ProjectMember.objects.create(project=project, user=reader, role="maintainer")
    repository = Repository.objects.create(
        name="共享软件", repo_type="git", vendor="gitlab", created_by=manager,
        url="https://gitlab.example.com", external_identity="group/reading",
    )
    component = ProjectComponent.objects.create(
        project=project, repository=repository, component_code="app", display_name="业务软件",
    )
    image = PackageImage.objects.create(name="镜像", image="example/app:latest")
    config = PackageConfig.objects.create(project_component=component, image=image, name="已有配置")
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=manager, status="released",
        version="V1.0.0", tag_name="V1.0.0", branch="main",
    )
    root = tmp_path / "workspaces"
    settings.PACKAGE_WORKSPACE_ROOT = root
    workspace = root / "task"
    artifacts = workspace / "artifacts"
    artifacts.mkdir(parents=True)
    task = PackageTask.objects.create(
        project=project, repository=repository, config=config, release=release, triggered_by=manager,
        name="他人发起的打包", status="success", version="V1.0.0", tag_name="V1.0.0",
        workspace_path=str(workspace), log_path=str(workspace / "build.log"),
        artifact_info=[{"id": "installer", "name": "安装包.zip", "path": "installer.zip", "size": 7}],
    )
    client = APIClient()
    client.force_authenticate(reader)
    return SimpleNamespace(
        manager=manager, reader=reader, project=project, repository=repository, config=config,
        image=image, release=release, task=task, workspace=workspace, artifacts=artifacts,
        client=client, root=root,
    )


@pytest.fixture
def download_context(reading_context: SimpleNamespace) -> SimpleNamespace:
    """文件安全和内容回归继续使用有权的开发角色，保留通用下载保护。"""
    ProjectMember.objects.filter(project=reading_context.project, user=reading_context.reader).update(role="developer")
    return reading_context


def test_expired_artifacts_do_not_download_as_successful_empty_zip(download_context: SimpleNamespace) -> None:
    """产物记录保留而文件已过期时，批量下载明确失败。"""
    response = download_context.client.get(f"/api/packages/tasks/{download_context.task.id}/download-all/")

    assert response.status_code == 404
    assert response.json()["message"] == "没有可下载的有效产物文件"


def test_partial_artifacts_do_not_download_as_complete_bundle(download_context: SimpleNamespace) -> None:
    """全部下载不静默遗漏已经清理的文件。"""
    context = download_context
    (context.artifacts / "installer.zip").write_bytes(b"package")
    context.task.artifact_info.append({"id": "symbols", "name": "symbols.zip", "path": "symbols.zip"})
    context.task.save(update_fields=["artifact_info"])

    response = context.client.get(f"/api/packages/tasks/{context.task.id}/download-all/")

    assert response.status_code == 404
    assert response.json()["message"] == "部分产物文件不存在或已清理，请逐个下载仍可用的产物"


@pytest.mark.parametrize("query", ["?tail=65536", "?offset=0"])
@pytest.mark.parametrize("task_status", ["success", "failure", "canceled"])
def test_finished_task_missing_logs_report_real_failure(
    reading_context: SimpleNamespace, query: str, task_status: str,
) -> None:
    """终态任务的日志不存在时，完整读取和增量读取都不能伪装为空日志。"""
    context = reading_context
    context.task.status = task_status
    context.task.save(update_fields=["status"])

    response = context.client.get(f"/api/packages/tasks/{context.task.id}/logs/{query}")

    assert response.status_code == 404
    assert response.json()["message"] == "日志未生成或已清理"


def test_maintainer_can_read_other_members_task_and_actual_failure(reading_context: SimpleNamespace) -> None:
    """任务读取不按本人发起过滤，失败原因和只读能力均与真实任务一致。"""
    context = reading_context
    context.task.status = "failure"
    context.task.error_message = "编译失败：缺少依赖"
    context.task.save(update_fields=["status", "error_message"])

    listed = context.client.get("/api/packages/tasks/").json()["data"]["results"]
    detail = context.client.get(f"/api/packages/tasks/{context.task.id}/").json()["data"]

    assert [item["id"] for item in listed] == [str(context.task.id)]
    assert detail["triggered_by"] == str(context.manager.id)
    assert detail["status"] == "failure"
    assert detail["error_message"] == "编译失败：缺少依赖"
    assert detail["my_role"] == "maintainer"
    assert (detail["can_cancel"], detail["can_delete"], detail["can_push_svn"]) == (False, False, False)


def test_maintainer_reads_online_logs_but_cannot_download_file(reading_context: SimpleNamespace) -> None:
    """在线日志保留原文及实际 UTF-8 游标，完整日志文件明确拒绝。"""
    context = reading_context
    log_path = context.workspace / "build.log"
    original = "准备构建\r\n第一阶段完成\n".encode()
    log_path.write_bytes(original)

    full = context.client.get(f"/api/packages/tasks/{context.task.id}/logs/")
    assert full.status_code == 403
    assert "Content-Disposition" not in full
    assert original not in full.content
    initial = context.client.get(f"/api/packages/tasks/{context.task.id}/logs/?tail=65536").json()["data"]
    assert initial == {"content": original.decode(), "size": len(original), "offset": 0, "truncated": False}

    with log_path.open("ab") as log_file:
        log_file.write("第二阶段完成\n".encode())
    appended = context.client.get(f"/api/packages/tasks/{context.task.id}/logs/?offset={initial['size']}")
    chunk = appended.json()["data"]
    assert chunk["content"] == "第二阶段完成\n"
    assert chunk["offset"] == len(original)
    assert chunk["size"] == len(original) + 19
    assert chunk["truncated"] is False


@pytest.mark.parametrize("task_status", ["queued", "running"])
def test_unstarted_task_log_remains_waiting_state(reading_context: SimpleNamespace, task_status: str) -> None:
    """未结束任务尚未生成日志时可以继续等待轮询。"""
    context = reading_context
    context.task.status = task_status
    context.task.save(update_fields=["status"])

    response = context.client.get(f"/api/packages/tasks/{context.task.id}/logs/?offset=0")

    assert response.status_code == 200
    assert response.json()["data"] == {"size": 0, "offset": 0, "content": ""}


def test_authorized_member_downloads_single_and_all_real_artifacts(download_context: SimpleNamespace) -> None:
    """原有角色下载他人的项目任务产物，单文件及嵌套 ZIP 均保留真实内容。"""
    context = download_context
    (context.artifacts / "installer.zip").write_bytes(b"package")
    (context.artifacts / "notes").mkdir()
    (context.artifacts / "notes" / "release.txt").write_bytes("交付说明".encode())
    context.task.artifact_info.append({"id": "notes", "name": "release.txt", "path": "notes/release.txt"})
    context.task.save(update_fields=["artifact_info"])

    single = context.client.get(f"/api/packages/tasks/{context.task.id}/artifacts/installer/download/")
    try:
        assert single.status_code == 200
        assert single["Content-Disposition"].startswith("attachment;")
        assert b"".join(single.streaming_content) == b"package"
    finally:
        single.close()
    bundle = context.client.get(f"/api/packages/tasks/{context.task.id}/download-all/")
    try:
        assert bundle.status_code == 200
        assert bundle["Content-Type"] == "application/zip"
        assert "artifacts.zip" in bundle["Content-Disposition"]
        with zipfile.ZipFile(BytesIO(b"".join(bundle.streaming_content))) as archive:
            assert sorted(archive.namelist()) == ["installer.zip", "notes/release.txt"]
            assert archive.read("installer.zip") == b"package"
            assert archive.read("notes/release.txt") == "交付说明".encode()
    finally:
        bundle.close()


@pytest.mark.parametrize("suffix", ["logs/", "artifacts/installer/download/", "download-all/"])
def test_maintainer_file_requests_are_denied_before_any_file_access(
    reading_context: SimpleNamespace, monkeypatch: pytest.MonkeyPatch, suffix: str,
) -> None:
    """旧链接即使指向有效文件也在文件访问前拒绝，不生成 ZIP 或返回文件。"""
    context = reading_context
    (context.artifacts / "installer.zip").write_bytes(b"package")
    (context.workspace / "build.log").write_bytes(b"full task log")

    def unexpected_file_access(*args: object, **kwargs: object) -> None:
        pytest.fail("维保请求不能进入文件读取或临时文件生成流程")

    monkeypatch.setattr("apps.package.views.FileResponse", unexpected_file_access)
    monkeypatch.setattr("apps.package.views.tempfile.mkstemp", unexpected_file_access)
    response = context.client.get(f"/api/packages/tasks/{context.task.id}/{suffix}")

    assert response.status_code == 403
    assert "Content-Disposition" not in response
    detail = context.client.get(f"/api/packages/tasks/{context.task.id}/").json()["data"]
    assert detail["artifact_info"][0]["name"] == "安装包.zip"
    assert detail["artifact_info"][0]["size"] == 7


@pytest.mark.parametrize("role", ["developer", "tester", "manager", "software_admin", "viewer", "auditor", "leader", "superuser"])
def test_file_authorization_follows_current_target_role(
    reading_context: SimpleNamespace, role: str,
) -> None:
    """原角色、负责人和超管保持下载权限，降为维保后同一旧链接立即拒绝。"""
    context = reading_context
    membership = ProjectMember.objects.get(project=context.project, user=context.reader)
    membership.role = role if role not in ("leader", "superuser") else "maintainer"
    membership.save(update_fields=["role"])
    if role == "leader":
        context.project.leader = context.reader
        context.project.save(update_fields=["leader"])
    elif role == "superuser":
        context.reader.is_superuser = True
        context.reader.save(update_fields=["is_superuser"])
    (context.artifacts / "installer.zip").write_bytes(b"package")
    (context.workspace / "build.log").write_bytes(b"online task log")
    url = f"/api/packages/tasks/{context.task.id}/artifacts/installer/download/"

    response = context.client.get(url)
    try:
        assert response.status_code == 200
        assert b"".join(response.streaming_content) == b"package"
    finally:
        response.close()
    if role in ("leader", "superuser"):
        return
    membership.role = "maintainer"
    membership.save(update_fields=["role"])
    assert context.client.get(url).status_code == 403
    assert context.client.get(f"/api/packages/tasks/{context.task.id}/logs/?tail=65536").status_code == 200


def test_mixed_roles_cannot_download_from_maintainer_project(
    reading_context: SimpleNamespace, hidden_task: PackageTask,
) -> None:
    """同一共享仓库的开发项目文件可下载，维保项目保持只读。"""
    context = reading_context
    ProjectMember.objects.create(project=hidden_task.project, user=context.reader, role="developer")
    response = context.client.get(f"/api/packages/tasks/{hidden_task.id}/artifacts/private-file/download/")
    try:
        assert response.status_code == 200
        assert b"".join(response.streaming_content) == b"private artifact"
    finally:
        response.close()
    assert context.client.get(f"/api/packages/tasks/{context.task.id}/artifacts/installer/download/").status_code == 403


@pytest.mark.parametrize("artifact_id,message", [
    ("unknown", "产物不存在"),
    ("installer", "产物文件不存在"),
])
def test_stale_or_missing_single_artifact_returns_real_failure(
    download_context: SimpleNamespace, artifact_id: str, message: str,
) -> None:
    """过期文件和不存在的文件 ID 返回各自真实失败。"""
    context = download_context

    response = context.client.get(f"/api/packages/tasks/{context.task.id}/artifacts/{artifact_id}/download/")

    assert response.status_code == 404
    assert response.json()["message"] == message


@pytest.fixture
def hidden_task(reading_context: SimpleNamespace) -> PackageTask:
    """同仓库另一个项目的任务，即使仓库共享也不对维保成员可见。"""
    context = reading_context
    project = Project.objects.create(code="HIDDEN", name="不可见项目", leader=context.manager)
    ProjectMember.objects.create(project=project, user=context.manager, role="manager")
    ProjectComponent.objects.create(
        project=project, repository=context.repository, component_code="shared", display_name="共享软件",
    )
    workspace = context.root / "hidden-task"
    (workspace / "artifacts").mkdir(parents=True)
    (workspace / "artifacts" / "secret.bin").write_bytes(b"private artifact")
    (workspace / "build.log").write_bytes(b"private task log")
    return PackageTask.objects.create(
        project=project, repository=context.repository, triggered_by=context.manager,
        name="不可见任务", status="success", workspace_path=str(workspace), log_path=str(workspace / "build.log"),
        artifact_info=[{"id": "private-file", "name": "secret.bin", "path": "secret.bin"}],
    )


@pytest.mark.parametrize("suffix", ["", "logs/", "logs/?offset=0", "download-all/", "artifacts/private-file/download/"])
def test_shared_repository_does_not_expose_hidden_task_or_files(
    reading_context: SimpleNamespace, hidden_task: PackageTask, suffix: str,
) -> None:
    """直接使用另一项目的任务及文件 ID 不能绕过项目读取范围。"""
    context = reading_context

    response = context.client.get(f"/api/packages/tasks/{hidden_task.id}/{suffix}")

    assert response.status_code == 404
    assert response.json()["message"] == "任务不存在或无权查看"
    assert "private" not in response.content.decode()
    listed = context.client.get("/api/packages/tasks/").json()["data"]["results"]
    assert [item["id"] for item in listed] == [str(context.task.id)]


def test_visible_task_rejects_file_id_from_other_task(
    download_context: SimpleNamespace, hidden_task: PackageTask,
) -> None:
    """可见任务 URL 也不能取得其他任务的产物 ID。"""
    context = download_context
    response = context.client.get(f"/api/packages/tasks/{context.task.id}/artifacts/private-file/download/")

    assert response.status_code == 404
    assert response.json()["message"] == "产物不存在"


@pytest.mark.parametrize("suffix", ["logs/", "logs/?offset=0", "download-all/", "artifacts/installer/download/"])
def test_revoked_project_member_loses_log_and_download_access(reading_context: SimpleNamespace, suffix: str) -> None:
    """已退出项目的用户不能继续通过旧链接读取日志或下载产物。"""
    context = reading_context
    ProjectMember.objects.filter(project=context.project, user=context.reader).delete()

    response = context.client.get(f"/api/packages/tasks/{context.task.id}/{suffix}")

    assert response.status_code == 404


@pytest.mark.parametrize("suffix", ["artifacts/installer/download/", "download-all/"])
def test_artifact_path_cannot_escape_task_directory(download_context: SimpleNamespace, suffix: str) -> None:
    """产物索引不能借上级路径下载工作区外文件。"""
    context = download_context
    (context.workspace / "secret.txt").write_bytes(b"workspace secret")
    context.task.artifact_info[0]["path"] = "../secret.txt"
    context.task.save(update_fields=["artifact_info"])

    response = context.client.get(f"/api/packages/tasks/{context.task.id}/{suffix}")

    assert response.status_code == 404
    assert b"workspace secret" not in response.content


def test_log_path_cannot_escape_task_directory(reading_context: SimpleNamespace) -> None:
    """任务日志路径不能借其他工作区读取无关文件。"""
    context = reading_context
    secret = context.root / "secret.log"
    secret.write_bytes(b"other workspace secret")
    context.task.log_path = str(secret)
    context.task.save(update_fields=["log_path"])

    response = context.client.get(f"/api/packages/tasks/{context.task.id}/logs/?offset=0")

    assert response.status_code == 404
    assert b"other workspace secret" not in response.content


@pytest.mark.parametrize("suffix", ["artifacts/installer/download/", "download-all/"])
def test_artifact_directory_link_cannot_expose_external_files(download_context: SimpleNamespace, suffix: str) -> None:
    """即使整个产物目录被替换为目录链接，也不能下载工作区外文件。"""
    context = download_context
    external = context.root.parent / "private"
    external.mkdir()
    (external / "installer.zip").write_bytes(b"external secret")
    context.artifacts.rmdir()
    try:
        context.artifacts.symlink_to(external, target_is_directory=True)
    except OSError:
        # Windows 非管理员可用目录联接验证同一文件系统边界。
        if sys.platform != "win32":
            raise
        junction = subprocess.run(
            ["cmd", "/c", "mklink", "/J", str(context.artifacts), str(external)],
            capture_output=True, check=False,
        )
        if junction.returncode:
            pytest.skip("当前系统不允许创建目录链接，需在 Linux CI 验证此边界")

    response = context.client.get(f"/api/packages/tasks/{context.task.id}/{suffix}")

    assert response.status_code == 404
    assert b"external secret" not in response.content
