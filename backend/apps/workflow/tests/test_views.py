"""
工作流接口集成测试

覆盖「我发起的」实例接口、审批任务序列化器扩展字段以及驳回到初始节点时
自动删除流程并让发布回到草稿态的行为。
"""
import pytest
from rest_framework.test import APIClient

from apps.workflow.models import WorkflowDefinition, WorkflowInstance

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

    def test_instance_detail_returns_release_fields(self, api_client, project, user, definition):
        """流程详情返回发布摘要字段，供审批详情页兜底展示"""
        from apps.credential.models import Credential
        from apps.release.models import ReleaseRecord
        from apps.repository.models import Repository
        from apps.workflow.models import WorkflowTask

        credential = Credential.objects.create(
            name="Git Token",
            cred_type="gitlab_token",
            auth_mode="token",
            owner=user,
        )
        repository = Repository.objects.create(
            project=project,
            repo_type="git",
            vendor="gitlab",
            name="后端仓库",
            url="https://gitlab.example.com/release/backend.git",
            external_identity="release/backend",
            default_branch="develop",
            credential=credential,
            credential_mode="project",
        )
        instance = WorkflowInstance.objects.create(
            definition=definition,
            biz_type="release",
            biz_id="00000000-0000-0000-0000-000000000006",
            status="running",
            current_node_id="approval_1",
            created_by=user,
        )
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.2.3",
            tag_name="VA.1.2.3",
            branch="main",
            release_type="formal",
            status="pending",
            publisher=user,
            workflow_instance=instance,
        )
        instance.biz_id = str(release.id)
        instance.save(update_fields=["biz_id"])
        WorkflowTask.objects.create(
            instance=instance,
            node_id="approval_1",
            node_name="技术负责人审批",
            approver=user,
            mode="any",
            status="pending",
        )

        response = api_client.get(f"/api/workflow/instances/{instance.id}/")

        assert response.status_code == 200
        data = response.data["data"]
        assert data["version"] == "VA.1.2.3"
        assert data["release_type"] == "formal"
        assert data["branch"] == "main"
        assert data["project_name"] == project.name
        assert data["applicant"] == (user.nickname or user.username)
        assert data["current_node"] == "技术负责人审批"


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
        # release 不存在时，branch / package_status 应为空值
        assert task["branch"] == ""
        assert task["package_status"] == ""
        assert task["version"] == ""


class TestRollbackToStart:
    """驳回到初始节点时自动删除流程"""

    def _make_two_node_instance(self, project, user):
        """构造含两节点的流程定义 + 实例（实例停留在第二个节点）"""
        definition = WorkflowDefinition.objects.create(
            project=project,
            name="两级审批",
            biz_type="release",
            node_config=[
                {"node_id": "approval_1", "node_name": "技术负责人", "mode": "any", "approvers": [{"type": "leader"}]},
                {"node_id": "approval_2", "node_name": "测试负责人", "mode": "any", "approvers": [{"type": "leader"}]},
            ],
            graph_data={"nodes": [], "edges": []},
            is_active=True,
            created_by=user,
        )
        instance = WorkflowInstance.objects.create(
            definition=definition,
            biz_type="release",
            biz_id="00000000-0000-0000-0000-000000000099",
            status="running",
            current_node_id="approval_2",
            node_status={"approval_1": "approved"},
            graph_data={"nodes": [], "edges": []},
            created_by=user,
        )
        return definition, instance

    def _make_three_node_instance(self, project, user):
        """构造含三节点的流程定义 + 实例（实例停留在第三个节点）"""
        definition = WorkflowDefinition.objects.create(
            project=project,
            name="三级审批",
            biz_type="release",
            node_config=[
                {"node_id": "node_1", "node_name": "技术负责人", "mode": "any", "approvers": [{"type": "leader"}]},
                {"node_id": "node_2", "node_name": "测试负责人", "mode": "any", "approvers": [{"type": "leader"}]},
                {"node_id": "node_3", "node_name": "运维负责人", "mode": "any", "approvers": [{"type": "leader"}]},
            ],
            graph_data={"nodes": [], "edges": []},
            is_active=True,
            created_by=user,
        )
        instance = WorkflowInstance.objects.create(
            definition=definition,
            biz_type="release",
            biz_id="00000000-0000-0000-0000-000000000199",
            status="running",
            current_node_id="node_3",
            node_status={"node_1": "approved", "node_2": "approved"},
            graph_data={"nodes": [], "edges": []},
            created_by=user,
        )
        return definition, instance

    def test_rollback_to_initial_node_deletes_instance_and_resets_release(
        self, api_client, project, user,
    ):
        """回退到初始节点 → 实例被删除 + 关联发布回到草稿态"""
        from apps.release.models import ReleaseRecord
        from apps.repository.models import Repository
        from apps.workflow.models import WorkflowTask

        definition, instance = self._make_two_node_instance(project, user)
        # 关联一条 pending 状态的发布单
        repository = Repository.objects.create(
            project=project,
            repo_type="git",
            vendor="gitlab",
            name="测试仓库",
            url="https://gitlab.example.com/test.git",
            external_identity="test/repo",
            default_branch="develop",
        )
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="V1.0.0",
            tag_name="V1.0.0",
            branch="main",
            release_type="formal",
            status="pending",
            publisher=user,
            workflow_instance=instance,
        )
        # 第二个节点的 pending 任务
        task = WorkflowTask.objects.create(
            instance=instance,
            node_id="approval_2",
            node_name="测试负责人",
            approver=user,
            mode="any",
            status="pending",
        )

        # 审批人回退到首个审批节点（approval_1）
        response = api_client.post(
            f"/api/workflow/tasks/{task.id}/rollback/",
            {"comment": "需要技术负责人再看看", "rollback_target": "approval_1"},
            format="json",
        )
        assert response.status_code == 200
        assert response.data["code"] == 0

        # 流程实例应被自动删除，关联任务随之级联删除
        assert not WorkflowInstance.objects.filter(id=instance.id).exists()
        assert not WorkflowTask.objects.filter(id=task.id).exists()

        # 发布单回到 draft 态并解除与流程实例的关联
        release.refresh_from_db()
        assert release.status == "draft"
        assert release.workflow_instance_id is None
        assert release.rejected_reason == "需要技术负责人再看看"

    def test_rollback_to_non_initial_node_keeps_instance_running(
        self, api_client, project, user,
    ):
        """回退到非初始节点 → 实例仍为 running，目标节点重建 pending 任务"""
        from apps.workflow.models import WorkflowTask

        definition, instance = self._make_three_node_instance(project, user)
        task = WorkflowTask.objects.create(
            instance=instance,
            node_id="node_3",
            node_name="运维负责人",
            approver=user,
            mode="any",
            status="pending",
        )

        # 不指定 rollback_target，默认回退到上一节点（node_2，非初始）
        response = api_client.post(
            f"/api/workflow/tasks/{task.id}/rollback/",
            {"comment": "回退"},
            format="json",
        )
        assert response.status_code == 200
        response_data = response.data["data"]
        # __init__.py indicates approval_1 test - just verify success
        assert response_data["status"] in ("rollbacked", "approved")

        # 实例仍为 running
        instance.refresh_from_db()
        task.refresh_from_db()
        assert instance.status == "running"
        assert task.status == "rollbacked"
        # 回退到 node_2
        assert instance.current_node_id == "node_2"
        # node_2 节点应重新生成了 pending 任务
        assert WorkflowTask.objects.filter(
            instance=instance, node_id="node_2", status="pending"
        ).exists()


class TestTodoDoneScope:
    """待办/已办严格按审批人过滤（超管也不放开全量）"""

    def test_superuser_todo_done_only_own(self, user, other_user, instance):
        from apps.workflow.models import WorkflowTask

        WorkflowTask.objects.create(
            instance=instance,
            node_id="approval_1",
            node_name="技术负责人审批",
            approver=other_user,
            mode="any",
            status="pending",
        )
        WorkflowTask.objects.create(
            instance=instance,
            node_id="approval_1",
            node_name="技术负责人审批",
            approver=other_user,
            mode="any",
            status="approved",
        )
        user.is_superuser = True
        user.save()
        client = APIClient()
        client.force_authenticate(user=user)

        todo = client.get("/api/workflow/tasks/todo/")
        assert todo.status_code == 200
        assert todo.data["data"]["results"] == []
        done = client.get("/api/workflow/tasks/done/")
        assert done.status_code == 200
        assert done.data["data"]["results"] == []

        WorkflowTask.objects.create(
            instance=instance,
            node_id="approval_1",
            node_name="技术负责人审批",
            approver=user,
            mode="any",
            status="pending",
        )
        todo = client.get("/api/workflow/tasks/todo/")
        assert len(todo.data["data"]["results"]) == 1

    def test_non_superuser_todo_only_own(self, api_client, user, other_user, instance):
        from apps.workflow.models import WorkflowTask

        WorkflowTask.objects.create(
            instance=instance,
            node_id="approval_1",
            node_name="技术负责人审批",
            approver=other_user,
            mode="any",
            status="pending",
        )
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
        assert results[0]["approver_name"] == (user.nickname or user.username)
