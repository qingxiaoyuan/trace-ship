"""通过真实 GitLab Provider 验证轻量 Tag 兼容性和失败后的归属保护。"""

import json

import pytest
import responses
from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord
from apps.system.models import OperationLog
from apps.workflow.models import WorkflowDefinition, WorkflowInstance

pytestmark = pytest.mark.django_db

TAG_URL = "https://gitlab.example.com/api/v4/projects/release%2Fbackend/repository/tags"


def _release(repository, project, user, release_type: str) -> ReleaseRecord:
    """正式版保留已完成的审批，其余类型覆盖无审批的直连推送。"""
    suffix = {"formal": "", "rc": "-rc", "beta": "-alpha"}[release_type]
    record = ReleaseRecord.objects.create(
        repository=repository,
        project=project,
        publisher=user,
        release_type=release_type,
        version="VA.1.0.0",
        tag_name=f"VA.1.0.0{suffix}",
        status="pending",
        branch="develop",
        git_hash="a" * 40,
        release_doc="已审批说明",
    )
    if release_type == "formal":
        definition = WorkflowDefinition.objects.create(
            repository=repository, project=project, name="正式审批", biz_type="release", release_type="formal",
        )
        record.workflow_instance = WorkflowInstance.objects.create(
            definition=definition, biz_type="release", biz_id=str(record.id), status="completed", created_by=user,
        )
        record.save(update_fields=["workflow_instance"])
    return record


def _api(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.mark.parametrize("release_type", ["formal", "rc", "beta"])
@responses.activate
def test_release_works_when_gitlab_rejects_annotated_tags(repository, project, user, release_type):
    """内网已确认有 Message 失败、无 Message 成功，三类发布均须兼容。"""
    record = _release(repository, project, user, release_type)
    tags = []
    payloads = []
    responses.add_callback(responses.GET, TAG_URL, callback=lambda _: (200, {}, json.dumps(tags)))

    def create_tag(request):
        payload = json.loads(request.body)
        payloads.append(payload)
        if payload.get("message"):
            return 500, {}, json.dumps({"message": "annotated tags unavailable"})
        tag = {"name": payload["tag_name"], "commit": {"id": payload["ref"]}, "message": None}
        tags.append(tag)
        return 201, {}, json.dumps(tag)

    responses.add_callback(responses.POST, TAG_URL, callback=create_tag)
    response = _api(user).post(f"/api/releases/{record.id}/push-tag/")
    assert response.status_code == 200, response.data
    record.refresh_from_db()
    assert record.status == "released" and record.git_hash == "a" * 40
    assert len(payloads) == 1 and payloads[0] == {"tag_name": record.tag_name, "ref": record.git_hash}
    assert record.version_claims.get().consumed
    if release_type == "formal":
        assert record.workflow_instance.status == "completed"


@responses.activate
def test_http_500_keeps_diagnostics_approval_and_claim_without_reposting(repository, project, user):
    """失败详情可查；远端成功后返回 500 时也不能按同 SHA 接管轻量 Tag。"""
    record = _release(repository, project, user, "formal")
    tags = []
    responses.add_callback(responses.GET, TAG_URL, callback=lambda _: (200, {}, json.dumps(tags)))

    def create_then_fail(request):
        payload = json.loads(request.body)
        tags.append({"name": payload["tag_name"], "commit": {"id": payload["ref"]}, "message": None})
        return 500, {"X-Request-Id": "gitlab-test-request"}, json.dumps({
            "message": "内部存储错误", "token": request.headers["PRIVATE-TOKEN"],
        })

    responses.add_callback(responses.POST, TAG_URL, callback=create_then_fail)
    api = _api(user)
    failed = api.post(f"/api/releases/{record.id}/push-tag/")
    assert failed.status_code == 400
    assert "gitlab-test-request" in failed.data["message"]
    record.refresh_from_db()
    assert record.status == "rejected" and record.workflow_instance.status == "completed"
    assert not record.version_claims.get().consumed
    detail = OperationLog.objects.get(action="push_tag", resource_id=str(record.id), result="failure").detail
    assert detail["diagnostic"]["status_code"] == 500
    assert detail["diagnostic"]["request_id"] == "gitlab-test-request"
    assert "内部存储错误" in detail["diagnostic"]["response_body"]
    assert "glpat-test" not in json.dumps(detail)
    retry = api.post(f"/api/releases/{record.id}/retry-push-tag/")
    assert retry.status_code == 400 and "轻量 Tag" in retry.data["message"]
    record.refresh_from_db()
    assert record.status == "rejected" and not record.version_claims.get().consumed
    assert len([call for call in responses.calls if call.request.method == "POST"]) == 1


@responses.activate
def test_historical_annotated_tag_can_still_be_reconciled(repository, project, user):
    """旧版留下的申请标记仍能证明归属，重试无需再创建远端 Tag。"""
    record = _release(repository, project, user, "formal")
    record.status = "rejected"
    record.save(update_fields=["status"])
    responses.add(responses.GET, TAG_URL, json=[{
        "name": record.tag_name, "commit": {"id": record.git_hash}, "message": f"trace-ship-release:{record.id}",
    }])
    retry = _api(user).post(f"/api/releases/{record.id}/retry-push-tag/")
    assert retry.status_code == 200, retry.data
    record.refresh_from_db()
    assert record.status == "released" and record.version_claims.get().consumed
    assert all(call.request.method == "GET" for call in responses.calls)
