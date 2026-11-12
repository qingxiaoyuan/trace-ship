"""通过发布 REST 边界验证单产物归档资料准备。"""
import pytest
from rest_framework.test import APIClient

from apps.package.models import PackageTask
from apps.project.models import ProjectComponent
from apps.release.models import ReleaseRecord
from apps.release.services import ReleaseDocGenerator

pytestmark = pytest.mark.django_db


@pytest.fixture
def archive_case(user, project, repository, tmp_path, settings):
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path)
    workspace = tmp_path / "build"
    artifacts = workspace / "artifacts"
    artifacts.mkdir(parents=True)
    (artifacts / "软件.zip").write_bytes(b"real artifact")
    ProjectComponent.objects.filter(project=project, repository=repository).update(display_name="项目内软件")
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=user, version="V1.2.3", tag_name="V1.2.3",
        git_hash="0123456789abcdef0123456789abcdef01234567", branch="main", release_type="formal", status="released",
        updates=[{"type": "A", "content": "生成内容 | 第二项\n第二行"}],
    )
    # 真实生成格式随后人工编辑，保存后的正文是归档预填的唯一内容依据。
    release.release_doc = ReleaseDocGenerator._build_markdown_doc(release).replace("生成内容", "人工编辑后的内容")
    release.save()
    task = PackageTask.objects.create(
        release=release, project=project, repository=repository, triggered_by=user, name="正式安装包",
        status="success", version=release.version, tag_name=release.tag_name,
        workspace_path=str(workspace), config_snapshot={"svn_push_enabled": False},
        artifact_info=[{"id": "artifact-1", "name": "软件.zip", "path": "软件.zip", "size": 13}],
    )
    client = APIClient()
    client.force_authenticate(user)
    return client, release, task


def prepare(client, release, task, **extra):
    return client.post(f"/api/releases/{release.id}/oa-archive/prepare/", {
        "task_id": str(task.id), "artifact_id": "artifact-1", **extra,
    }, format="json")


def test_发布人选择现存单产物并取得真实发布资料(archive_case):
    client, release, task = archive_case
    response = prepare(client, release, task)
    assert response.status_code == 200
    data = response.data["data"]
    assert data["selection"] == {"task_id": str(task.id), "artifact_id": "artifact-1", "path": "软件.zip", "source_kind": "local"}
    assert data["form"] == {
        "docCreator": "releaseuser", "applyCount": 1, "soft_name": "项目内软件", "soft_version": "V1.2.3",
        "developer": "releaseuser", "soft_source": "", "git_svn": "",
        "sn_code": "0123456789abcdef0123456789abcdef01234567",
        "edit_content": "A 人工编辑后的内容 | 第二项\n第二行",
        "edit_reason": "", "other_description": "", "soft_number": "",
    }
    assert data["configuration"] == {"configured": False, "reason": "尚未配置 OA 软件归档接口地址，请联系系统配置维护者"}
    assert data["content_source"] == "release_doc_changes"


@pytest.mark.parametrize(("role", "publisher", "superuser", "expected"), [
    ("developer", True, False, 200), ("tester", True, False, 200),
    ("manager", False, False, 200), ("software_admin", False, False, 200),
    (None, False, True, 200), ("developer", False, False, 403),
    ("tester", False, False, 403), ("viewer", True, False, 403),
    ("maintainer", True, False, 403), ("auditor", True, False, 403),
    (None, True, False, 404),
])
def test_准备逐次核验实际操作者的现行项目身份(archive_case, role, publisher, superuser, expected):
    from apps.account.models import User
    from apps.project.models import ProjectMember

    client, release, task = archive_case
    actor = User.objects.create_user(username="actor", is_superuser=superuser)
    if role:
        ProjectMember.objects.create(project=release.project, user=actor, role=role)
    if publisher:
        release.publisher = actor
        release.save()
    client.force_authenticate(actor)
    assert prepare(client, release, task, docCreator="releaseuser").status_code == expected


def test_其他项目管理员和共享仓库所有者不能扩大本项目权限(archive_case):
    from apps.account.models import User
    from apps.project.models import Project, ProjectComponent, ProjectMember

    client, release, task = archive_case
    actor = User.objects.create_user(username="other-project-owner")
    other = Project.objects.create(name="其他项目", code="OTHER", leader=actor)
    ProjectMember.objects.create(project=other, user=actor, role="manager")
    ProjectMember.objects.create(project=release.project, user=actor, role="maintainer")
    ProjectComponent.objects.create(project=other, repository=release.repository)
    release.repository.created_by = actor
    release.repository.save()
    release.publisher = actor
    release.save()
    client.force_authenticate(actor)
    assert prepare(client, release, task).status_code == 403
    ProjectMember.objects.filter(project=release.project, user=actor).delete()
    assert prepare(client, release, task).status_code == 404


@pytest.mark.parametrize("invalid", ["rc", "beta", "draft", "pending", "rejected", "failure", "no_release", "wrong_project", "wrong_repository", "no_artifact", "deleted_file", "outside_workspace", "traversal", "svn_failed"])
def test_不合资格的发布任务与文件不能准备归档(archive_case, invalid, tmp_path):
    from apps.project.models import Project
    from apps.repository.models import Repository

    client, release, task = archive_case
    if invalid in ("rc", "beta"):
        release.release_type = invalid
        release.save()
    elif invalid in ("draft", "pending", "rejected"):
        release.status = invalid
        release.save()
    elif invalid == "failure":
        task.status = "failure"
    elif invalid == "no_release":
        task.release = None
    elif invalid == "wrong_project":
        task.project = Project.objects.create(code="WRONG", name="其他项目")
    elif invalid == "wrong_repository":
        task.repository = Repository.objects.create(name="另一个仓库", vendor="gitlab", url="https://gitlab.example.com/other", external_identity="other")
    elif invalid == "no_artifact":
        task.artifact_info = []
    elif invalid == "deleted_file":
        (tmp_path / "build/artifacts/软件.zip").unlink()
    elif invalid == "outside_workspace":
        task.workspace_path = "/tmp"
    elif invalid == "traversal":
        (tmp_path / "build/outside.zip").write_bytes(b"outside")
        task.artifact_info[0]["path"] = "../outside.zip"
    elif invalid == "svn_failed":
        task.config_snapshot = {"svn_push_enabled": True}
        task.stage_info = {"svn_push": {"status": "failure"}}
    task.save()
    response = prepare(client, release, task)
    assert response.status_code in (400, 404)
    assert response.data["message"]


def test_快照关闭推送的现存产物不受当前配置改变影响且成功推送预填文件地址(archive_case):
    client, release, task = archive_case
    task.config_snapshot = {"svn_push_enabled": True}
    task.stage_info = {"svn_push": {"status": "success", "remote_url": "https://svn.example.com/repo/formal/V1.2.3"}}
    task.save()
    assert prepare(client, release, task).data["data"]["form"]["git_svn"] == "https://svn.example.com/repo/formal/V1.2.3/%E8%BD%AF%E4%BB%B6.zip"


def test_完整正文保留空行缩进转义与长文本尾部并不读取旧更新字段(archive_case):
    client, release, task = archive_case
    text = "人工更新 | 字面管道\n\n  缩进保留\n" + "长文本" * 200 + "最终尾部"
    release.updates = [{"type": "A", "content": text}]
    release.release_doc = ReleaseDocGenerator._build_markdown_doc(release)
    release.updates = [{"type": "F", "content": "过时字段不得使用"}]
    release.save()
    assert prepare(client, release, task).data["data"]["form"]["edit_content"] == "A " + text


@pytest.mark.parametrize("doc", ["# 历史版本\n没有标准表格\n" + "全文" * 200 + "保留尾部", "| 变更内容 | 第一行 |\n| 变更内容 | 第二行 |", "| 变更内容 | 未闭合\n| 关联项 | 其他字段 |"])
def test_不能可靠识别的历史说明保留全部原文供人工补填(archive_case, doc):
    client, release, task = archive_case
    release.release_doc = doc
    release.git_hash = "short-sha"
    release.save()
    data = prepare(client, release, task).data["data"]
    assert data["content_source"] == "release_doc_original"
    assert data["form"]["edit_content"] == doc
    assert data["form"]["sn_code"] == ""


def test_候选只含现存合格文件且列表之后删除文件也不能继续准备(archive_case, tmp_path):
    client, release, task = archive_case
    task.artifact_info.append({"id": "expired", "name": "已清理.zip", "path": "已清理.zip"})
    task.save()
    response = client.get(f"/api/releases/{release.id}/oa-archive/options/")
    assert response.status_code == 200
    assert response.data["data"]["artifacts"] == [{
        "task_id": str(task.id), "task_name": "正式安装包", "artifact_id": "artifact-1", "name": "软件.zip", "path": "软件.zip", "source_kind": "local",
    }]
    (tmp_path / "build/artifacts/软件.zip").unlink()
    assert prepare(client, release, task).status_code == 400
    assert client.get(f"/api/releases/{release.id}/oa-archive/options/").data["data"]["artifacts"] == []


def test_修改资料仅用于本次校验不回写来源且四项必填其余可留空(archive_case):
    client, release, task = archive_case
    form = prepare(client, release, task).data["data"]["form"]
    form.update(docCreator="oa.creator", developer="oa.receiver", soft_name="修改后的软件名", soft_version="自定义版本",
                edit_content="手工内容 | 管道\n\n第二行及尾部", applyCount=99, project_number="不发送", project_leader_name="不发送", project_owner_name="不发送")
    response = prepare(client, release, task, form=form)
    assert response.status_code == 200
    result = response.data["data"]["form"]
    assert result["docCreator"] == "oa.creator"
    assert result["soft_name"] == "修改后的软件名"
    assert result["edit_content"] == "手工内容 | 管道\n\n第二行及尾部"
    assert result["applyCount"] == 1
    assert not {"project_number", "project_leader_name", "project_owner_name"} & result.keys()
    detail = client.get(f"/api/releases/{release.id}/").data["data"]
    assert detail["release_doc"] == release.release_doc
    assert detail["version"] == "V1.2.3"
    for field in ("docCreator", "soft_name", "soft_version", "developer"):
        bad = prepare(client, release, task, form={**form, field: "  "})
        assert bad.status_code == 400
        assert field in bad.data["data"]["form"]


def test_发布说明通过编辑保存接口往返后预填取最新正文(archive_case):
    client, release, task = archive_case
    updated = release.release_doc.replace("人工编辑后的内容", "通过编辑接口保存的内容")
    response = client.post(f"/api/releases/{release.id}/update-doc/", {"release_doc": updated}, format="json")
    assert response.status_code == 200
    assert client.get(f"/api/releases/{release.id}/").data["data"]["release_doc"] == updated
    assert prepare(client, release, task).data["data"]["form"]["edit_content"] == "A 通过编辑接口保存的内容 | 第二项\n第二行"


def test_含额外列的非标准说明不冒充可靠的变更内容(archive_case):
    client, release, task = archive_case
    release.release_doc = "| 字段 | 内容 | 备注 |\n|---|---|---|\n| 变更内容 | 正文 | 人工备注不得丢失 |"
    release.save()
    data = prepare(client, release, task).data["data"]
    assert data["content_source"] == "release_doc_original"
    assert data["form"]["edit_content"] == release.release_doc


def test_围栏代码中的表格示例不能冒充当前版本更新(archive_case):
    client, release, task = archive_case
    release.release_doc = "# 历史发布说明\n实际更新：升级数据库兼容层。\n\n```markdown\n| 变更内容 | 这是表格使用示例，并非本版本更新 |\n```\n实际更新尾部：修复升级回滚。"
    release.save()
    data = prepare(client, release, task).data["data"]
    assert data["content_source"] == "release_doc_original"
    assert data["form"]["edit_content"] == release.release_doc
