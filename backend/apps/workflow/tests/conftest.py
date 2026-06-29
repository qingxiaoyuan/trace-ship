"""
工作流测试夹具

提供用户、项目、流程定义、流程实例等通用测试数据。
"""
import pytest

from apps.account.models import User
from apps.project.models import Project, ProjectMember
from apps.workflow.models import WorkflowDefinition, WorkflowInstance


@pytest.fixture
def user():
    """测试用户"""
    return User.objects.create_user(
        username="workflowuser",
        password="testpass",
        nickname="工作流测试用户",
    )


@pytest.fixture
def other_user():
    """另一个测试用户（用于验证「我发起的」隔离）"""
    return User.objects.create_user(
        username="otheruser",
        password="testpass",
        nickname="其他用户",
    )


@pytest.fixture
def project(user):
    """测试项目"""
    project = Project.objects.create(
        code="WORKFLOW",
        name="工作流测试项目",
        leader=user,
        status=1,
        version_rule={"format": "V.{major}.{minor}.{patch}", "initial": "V.1.0.0"},
        release_rule={"formal_branch": "main", "test_prefix": "test", "release_cycle_days": 3},
    )
    ProjectMember.objects.create(project=project, user=user, role="manager")
    return project


@pytest.fixture
def definition(project, user):
    """测试流程定义"""
    return WorkflowDefinition.objects.create(
        project=project,
        name="发布审批流程",
        biz_type="release",
        node_config=[
            {"node_id": "approval_1", "node_name": "技术负责人审批", "mode": "any", "approvers": [{"type": "leader"}]},
        ],
        graph_data={"nodes": [], "edges": []},
        is_active=True,
        created_by=user,
    )


@pytest.fixture
def instance(definition, user):
    """运行中的流程实例（由 user 发起）"""
    return WorkflowInstance.objects.create(
        definition=definition,
        biz_type="release",
        biz_id="00000000-0000-0000-0000-000000000001",
        status="running",
        current_node_id="approval_1",
        node_status={"approval_1": "running"},
        graph_data={"nodes": [], "edges": []},
        created_by=user,
    )
