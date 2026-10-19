"""通过 REST API 验收已发布版本检索、完整说明和所属项目只读边界。"""

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import Project, ProjectComponent, ProjectMember
from apps.release.models import ReleaseCommit, ReleaseRecord
from apps.repository.models import CommitRecord, Repository
from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask

pytestmark = pytest.mark.django_db


@pytest.fixture
def reader_user(project):
    """维保成员阅读他人发布，避免把发布人权限当作成员只读权限。"""
    member = User.objects.create_user(username="release-reader", nickname="维保读者")
    ProjectMember.objects.create(project=project, user=member, role="maintainer")
    return member


@pytest.fixture
def reader(reader_user):
    client = APIClient()
    client.force_authenticate(reader_user)
    return client


@pytest.mark.parametrize("keyword", ["VA.25.0", "issue25-tag", "控制中心", "末尾字段验收"])
def test_released_search_combines_scope_and_type_before_pagination(user, project, repository, reader_user, reader, keyword):
    """关键词和三个筛选共同限定全集；总数、跨页结果及缺失时间保持一致。"""
    component = ProjectComponent.objects.get(project=project, repository=repository)
    component.display_name = "控制中心"
    component.save(update_fields=["display_name"])
    other_project = Project.objects.create(code="READ-OTHER", name="其他所属项目")
    ProjectMember.objects.create(project=other_project, user=reader_user, role="maintainer")
    hidden_project = Project.objects.create(code="READ-HIDDEN", name="非所属项目")
    for target in (other_project, hidden_project):
        ProjectComponent.objects.create(
            project=target, repository=repository, component_code="shared", display_name="控制中心共享软件",
        )
    other_repository = Repository.objects.create(
        name="其他仓库", repo_type="git", vendor="gitlab", url="https://gitlab.example.com/other.git",
        external_identity="release/other",
    )
    ProjectComponent.objects.create(
        project=project, repository=other_repository, component_code="other", display_name="控制中心其他软件",
    )
    now = timezone.now()
    saved_doc = "| 项目 | 内容 |\n| --- | --- |\n| 额外字段 | " + "完整历史说明" * 300 + "末尾字段验收 |"
    rows = []
    # 每条干扰记录仅改变一项条件，证明筛选共同生效而不是在当前页本地筛选。
    for index, (target, repo, release_type, status, released_at, doc) in enumerate([
        (project, repository, "formal", "released", None, saved_doc),
        (project, repository, "formal", "released", now - timedelta(days=1), saved_doc),
        (project, repository, "formal", "released", now, saved_doc),
        (other_project, repository, "formal", "released", now, saved_doc),
        (hidden_project, repository, "formal", "released", now, saved_doc),
        (project, other_repository, "formal", "released", now, saved_doc),
        (project, repository, "rc", "released", now, saved_doc),
        (project, repository, "formal", "draft", None, saved_doc),
    ]):
        rows.append(ReleaseRecord.objects.create(
            project=target, repository=repo, publisher=user, version=f"VA.25.0.{index}",
            tag_name=f"issue25-tag-{index}", release_type=release_type, status=status,
            released_at=released_at, release_doc=doc,
        ))
    params = {
        "status": "released", "project": str(project.id), "repository": str(repository.id),
        "release_type": "formal", "search": keyword, "ordering": "-released_at", "page_size": 2,
    }

    first_response = reader.get("/api/releases/", params)
    second_response = reader.get("/api/releases/", {**params, "page": 2})

    assert first_response.status_code == second_response.status_code == 200
    first, second = first_response.data["data"], second_response.data["data"]
    assert first["total"] == second["total"] == 3
    assert [row["id"] for row in first["results"]] == [str(rows[2].id), str(rows[1].id)]
    assert [row["id"] for row in second["results"]] == [str(rows[0].id)]
    assert second["results"][0]["released_at"] is None
    assert reader.get("/api/releases/", {**params, "search": "完全不存在的关键词"}).data["data"]["total"] == 0


def test_detail_returns_saved_document_verbatim_and_read_only_metadata(user, project, repository, reader):
    """说明全文包含人工额外字段、MR 链接、长文本与末尾段落；流程身份不丢失。"""
    document = (
        "# 完整发布说明\n\n| 项目 | 内容 |\n| --- | --- |\n"
        "| 变更内容 | 新增车辆通行<br>修复预约记录 |\n"
        "| 自定义维保字段 | 特殊值 \\| 完整保留 |\n"
        "| 合并请求 | [!42 修复预约](https://gitlab.example.com/group/repo/-/merge_requests/42) |\n"
        "| 长文本 | " + "逐字保留正文内容" * 600 + "长文本末尾 |\n\n"
        "## 补充说明\n\n表格之外的末尾段落也必须完整返回。"
    )
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=user, version="VA.25.1.0",
        tag_name="VA.25.1.0_20261019", release_type="formal", status="released",
        branch="main", git_hash="a" * 40, base_tag="VA.25.0.0_20261018", release_doc=document,
        released_at=timezone.now(),
    )

    response = reader.get(f"/api/releases/{release.id}/")

    assert response.status_code == 200
    data = response.data["data"]
    assert data["release_doc"] == document
    assert (data["version"], data["tag_name"], data["base_tag"], data["git_hash"]) == (
        "VA.25.1.0", "VA.25.1.0_20261019", "VA.25.0.0_20261018", "a" * 40,
    )
    assert data["status"] == "released"
    assert data["publisher_name"] == "发布测试用户"
    assert data["released_at"] is not None
    assert data["can_review"] is False
    assert data["can_reply"] is False


def test_reader_can_page_through_complete_saved_commit_messages(user, project, repository, reader):
    """关联提交使用发布快照分页，未纳入说明的提交和长消息仍可完整阅读。"""
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=user, version="VA.25.2.0", status="released",
    )
    now = timezone.now()
    for index in range(3):
        commit = CommitRecord.objects.create(
            project=project, repository=repository, commit_hash=f"{index:040x}", author="提交人",
            message=f"修复预约{index}\n\n" + "完整提交消息" * 100 + "提交正文末尾",
            committed_at=now + timedelta(minutes=index), branch="main", review_status="pass",
        )
        ReleaseCommit.objects.create(release=release, commit=commit, is_included=index != 0)

    first = reader.get(f"/api/releases/{release.id}/commits/", {"page_size": 2})
    second = reader.get(f"/api/releases/{release.id}/commits/", {"page_size": 2, "page": 2})

    assert first.status_code == second.status_code == 200
    assert first.data["data"]["total"] == second.data["data"]["total"] == 3
    assert [item["commit_hash"] for item in first.data["data"]["results"]] == [f"{2:040x}", f"{1:040x}"]
    last = second.data["data"]["results"][0]
    assert last["message"] == "修复预约0\n\n" + "完整提交消息" * 100 + "提交正文末尾"
    assert last["is_included"] is False


def test_reader_can_inspect_completed_approval_history(user, project, repository, reader):
    """成员可查看已完成审批、审批人及意见全文，能力标志保持只读。"""
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=user, version="VA.25.3.0", status="released",
        tag_name="VA.25.3.0_20261019", release_doc="已保存说明全文",
    )
    definition = WorkflowDefinition.objects.create(repository=repository, project=project, name="正式审批")
    instance = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id=str(release.id), status="completed", created_by=user,
        completed_at=timezone.now(), node_status={"approval": "approved"},
    )
    release.workflow_instance = instance
    release.save(update_fields=["workflow_instance"])
    task = WorkflowTask.objects.create(
        instance=instance, node_id="approval", node_name="稳定性确认", approver=user, status="approved",
        comment="已完成稳定性验证\n" + "完整审批意见" * 100 + "审批意见末尾", action_time=timezone.now(),
    )

    listing = reader.get("/api/workflow/instances/", {"biz_type": "release", "biz_id": str(release.id)})
    response = reader.get(f"/api/workflow/instances/{instance.id}/")

    assert listing.status_code == response.status_code == 200
    assert [item["id"] for item in listing.data["data"]["results"]] == [str(instance.id)]
    data = response.data["data"]
    assert data["status"] == "completed"
    assert data["node_status"] == {"approval": "approved"}
    assert data["release_doc"] == "已保存说明全文"
    assert data["can_revoke"] is False
    assert data["tasks"][0]["id"] == str(task.id)
    assert data["tasks"][0]["approver_name"] == "发布测试用户"
    assert data["tasks"][0]["comment"] == "已完成稳定性验证\n" + "完整审批意见" * 100 + "审批意见末尾"
    assert data["tasks"][0]["can_act"] is False


def test_shared_repository_and_forged_query_cannot_reveal_private_release(user, project, repository, reader):
    """共享仓库和伪造项目筛选均不能读取非所属项目的说明、提交和流程。"""
    hidden = Project.objects.create(code="PRIVATE-READING", name="非所属项目")
    ProjectComponent.objects.create(
        project=hidden, repository=repository, component_code="private", display_name="非所属软件机密名称",
    )
    release = ReleaseRecord.objects.create(
        project=hidden, repository=repository, publisher=user, version="VA.25.9.0", status="released",
        release_doc="非所属项目机密说明正文",
    )
    # 共享流程的历史项目仍是可见项目，授权必须使用实际发布所属项目。
    definition = WorkflowDefinition.objects.create(repository=repository, project=project, name="共享审批")
    instance = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id=str(release.id), status="completed", created_by=user,
    )
    forged_params = {"project": str(project.id), "repository": str(repository.id)}

    for params in [
        {"repository": str(repository.id)},
        {"project": str(hidden.id), "repository": str(repository.id)},
        {"search": "非所属项目机密说明正文"},
        {"search": "非所属软件机密名称"},
    ]:
        response = reader.get("/api/releases/", {"status": "released", **params})
        assert response.status_code == 200
        assert response.data["data"]["total"] == 0

    for path in [
        f"/api/releases/{release.id}/", f"/api/releases/{release.id}/commits/",
        f"/api/releases/{release.id}/review-issues/", f"/api/workflow/instances/{instance.id}/",
    ]:
        response = reader.get(path, forged_params)
        assert response.status_code == 404
        assert "非所属项目机密说明正文" not in str(response.data)
