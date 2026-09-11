"""
工作流定义权限测试

审批节点编辑权限：仅仓库创建者（及超管）可改。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import Project, ProjectMember
from apps.repository.models import Repository
from apps.workflow.models import WorkflowDefinition


def auth_client(user):
    """构造已认证客户端"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def owner():
    """仓库创建者"""
    return User.objects.create_user(username="wf_owner", password="pass")


@pytest.fixture
def manager_user():
    """产品管理员（非仓库创建者）"""
    return User.objects.create_user(username="wf_manager", password="pass")


@pytest.fixture
def repository(owner, manager_user):
    project = Project.objects.create(
        code="WFPERM", name="流程权限产品", leader=owner, status=1,
    )
    ProjectMember.objects.create(project=project, user=owner, role="developer")
    ProjectMember.objects.create(project=project, user=manager_user, role="manager")
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="流程权限仓库",
        url="https://gitlab.example.com/wfperm",
        external_identity="test/wfperm",
        created_by=owner,
    )


@pytest.fixture
def definition(repository, owner):
    return WorkflowDefinition.objects.create(
        repository=repository,
        project=repository.project,
        name="发布审批流程",
        biz_type="release",
        node_config=[
            {"node_id": "approval_1", "node_name": "技术负责人审批", "mode": "any", "approvers": [{"type": "leader"}]},
        ],
        is_active=True,
        created_by=owner,
    )


def _new_node_config():
    """合法的新节点配置"""
    return [
        {"node_id": "approval_1", "node_name": "技术负责人审批", "mode": "all", "approvers": [{"type": "leader"}]},
    ]


@pytest.mark.django_db
def test_repository_owner_can_update_node_config(definition, owner):
    """仓库创建者可编辑审批节点"""
    response = auth_client(owner).patch(
        f"/api/workflow/definitions/{definition.id}/",
        {"node_config": _new_node_config()},
        format="json",
    )

    assert response.status_code == 200
    definition.refresh_from_db()
    assert definition.node_config[0]["mode"] == "all"


@pytest.mark.django_db
def test_product_manager_cannot_update_node_config(definition, manager_user):
    """产品管理员若不是仓库创建者，不能编辑审批节点"""
    response = auth_client(manager_user).patch(
        f"/api/workflow/definitions/{definition.id}/",
        {"node_config": _new_node_config()},
        format="json",
    )

    assert response.status_code == 403


@pytest.mark.django_db
def test_developer_cannot_update_node_config(definition):
    """普通开发成员不可编辑审批节点"""
    developer = User.objects.create_user(username="wf_developer", password="pass")
    ProjectMember.objects.create(project=definition.project, user=developer, role="developer")

    response = auth_client(developer).patch(
        f"/api/workflow/definitions/{definition.id}/",
        {"node_config": _new_node_config()},
        format="json",
    )

    assert response.status_code == 403
