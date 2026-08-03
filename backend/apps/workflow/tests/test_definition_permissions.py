"""
工作流定义权限测试

审批节点编辑权限：manager 成员角色（不再依赖项目 leader 字段）。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import Project, ProjectMember
from apps.workflow.models import WorkflowDefinition


def auth_client(user):
    """构造已认证客户端"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def leader_user():
    """项目 leader（成员角色仅为 developer）"""
    return User.objects.create_user(username="wf_leader", password="pass")


@pytest.fixture
def manager_user():
    """项目 manager 成员（非 leader）"""
    return User.objects.create_user(username="wf_manager", password="pass")


@pytest.fixture
def project(leader_user, manager_user):
    project = Project.objects.create(
        code="WFPERM", name="流程权限项目", leader=leader_user, status=1,
    )
    ProjectMember.objects.create(project=project, user=leader_user, role="developer")
    ProjectMember.objects.create(project=project, user=manager_user, role="manager")
    return project


@pytest.fixture
def definition(project, leader_user):
    return WorkflowDefinition.objects.create(
        project=project,
        name="发布审批流程",
        biz_type="release",
        node_config=[
            {"node_id": "approval_1", "node_name": "技术负责人审批", "mode": "any", "approvers": [{"type": "leader"}]},
        ],
        is_active=True,
        created_by=leader_user,
    )


def _new_node_config():
    """合法的新节点配置"""
    return [
        {"node_id": "approval_1", "node_name": "技术负责人审批", "mode": "all", "approvers": [{"type": "leader"}]},
    ]


@pytest.mark.django_db
def test_manager_can_update_node_config(definition, manager_user):
    """manager 成员角色（非 leader）可编辑审批节点"""
    response = auth_client(manager_user).patch(
        f"/api/workflow/definitions/{definition.id}/",
        {"node_config": _new_node_config()},
        format="json",
    )

    assert response.status_code == 200
    definition.refresh_from_db()
    assert definition.node_config[0]["mode"] == "all"


@pytest.mark.django_db
def test_leader_without_manager_role_can_update(definition, leader_user):
    """项目 leader 视同 manager，即使成员角色非 manager 也可编辑审批节点"""
    response = auth_client(leader_user).patch(
        f"/api/workflow/definitions/{definition.id}/",
        {"node_config": _new_node_config()},
        format="json",
    )

    assert response.status_code == 200


@pytest.mark.django_db
def test_developer_cannot_update_node_config(definition):
    """普通开发成员（非 leader 非 manager）不可编辑审批节点"""
    developer = User.objects.create_user(username="wf_developer", password="pass")
    ProjectMember.objects.create(project=definition.project, user=developer, role="developer")

    response = auth_client(developer).patch(
        f"/api/workflow/definitions/{definition.id}/",
        {"node_config": _new_node_config()},
        format="json",
    )

    assert response.status_code == 403
