"""
工作流接口集成测试

覆盖「我发起的」实例接口与审批任务序列化器扩展字段。
"""
import pytest
from rest_framework.test import APIClient

from apps.workflow.models import WorkflowInstance

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client(user):
    """已认证测试客户端"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class TestWorkflowInstanceViews:
    """工作流实例接口测试"""

    def test_initiated_returns_only_my_instances(self, api_client, user, definition, other_user):
        """「我发起的」只返回当前用户创建的实例"""
        WorkflowInstance.objects.create(
            definition=definition,
            biz_type="release",
            biz_id="00000000-0000-0000-0000-000000000002",
            status="running",
            created_by=user,
        )
        WorkflowInstance.objects.create(
            definition=definition,
            biz_type="release",
            biz_id="00000000-0000-0000-0000-000000000003",
            status="running",
            created_by=other_user,
        )

        response = api_client.get("/api/workflow/instances/initiated/")
        assert response.status_code == 200
        results = response.data["data"]["results"]
        biz_ids = [item["biz_id"] for item in results]
        assert "00000000-0000-0000-0000-000000000002" in biz_ids
        assert "00000000-0000-0000-0000-000000000003" not in biz_ids

    def test_initiated_status_filter(self, api_client, user, definition):
        """status=running 只返回进行中的实例"""
        WorkflowInstance.objects.create(
            definition=definition,
            biz_type="release",
            biz_id="00000000-0000-0000-0000-000000000004",
            status="running",
            created_by=user,
        )
        WorkflowInstance.objects.create(
            definition=definition,
            biz_type="release",
            biz_id="00000000-0000-0000-0000-000000000005",
            status="completed",
            created_by=user,
        )

        response = api_client.get("/api/workflow/instances/initiated/", {"status": "running"})
        assert response.status_code == 200
        results = response.data["data"]["results"]
        assert len(results) == 1
        assert results[0]["biz_id"] == "00000000-0000-0000-0000-000000000004"
        assert results[0]["status"] == "running"

    def test_initiated_current_node_fallback(self, api_client, instance):
        """无进行中任务时，current_node 回退到 current_node_id"""
        response = api_client.get("/api/workflow/instances/initiated/")
        results = response.data["data"]["results"]
        target = next(item for item in results if item["biz_id"] == instance.biz_id)
        assert target["current_node"] == instance.current_node_id


class TestWorkflowTaskSerializer:
    """审批任务序列化器扩展字段测试"""

    def test_todo_returns_release_fields(self, api_client, instance, user):
        """待办任务返回 release 相关字段（无 release 记录时为空值）"""
        from apps.workflow.models import WorkflowTask

        WorkflowTask.objects.create(
            instance=instance,
            node_id="approval_1",
            node_name="技术负责人审批",
            approver=user,
            mode="any",
            status="pending",
        )

        response = api_client.get("/api/workflow/tasks/todo/")
        assert response.status_code == 200
        results = response.data["data"]["results"]
        assert len(results) == 1
        task = results[0]
        # release 不存在时，target_branch / build_number 应为空值
        assert task["target_branch"] == ""
        assert task["build_number"] is None
        assert task["version"] == ""
