"""
内置发布审批流程定义测试
"""
import pytest

from apps.project.models import Project
from apps.repository.models import Repository
from apps.workflow.models import WorkflowDefinition
from apps.workflow.services import (
    BUILTIN_RELEASE_FLOW_NAMES,
    ensure_builtin_workflow_definitions,
)

pytestmark = pytest.mark.django_db


def _repository(user, code: str, name: str) -> Repository:
    """创建带登记产品的测试仓库。"""
    project = Project.objects.create(code=code, name=f"{name}产品", leader=user, status=1)
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name=name,
        url=f"https://gitlab.example.com/{code.lower()}",
        external_identity=f"test/{code.lower()}",
        created_by=user,
    )


class TestBuiltinWorkflowDefinitions:
    """仓库自带三种发布类型审批流程测试"""

    def test_ensure_creates_three_flows_for_new_repository(self, user):
        """为仓库补齐 formal/rc/beta 三个内置审批流程"""
        repository = _repository(user, "BUILTIN", "内置流程仓库")
        ensure_builtin_workflow_definitions(repository)

        types = set(
            WorkflowDefinition.objects.filter(
                repository=repository, biz_type="release"
            ).values_list("release_type", flat=True)
        )
        assert types == {"formal", "rc", "beta"}

    def test_ensure_is_idempotent(self, user):
        """重复调用不会重复创建"""
        repository = _repository(user, "IDEMP", "幂等测试仓库")
        ensure_builtin_workflow_definitions(repository)
        ensure_builtin_workflow_definitions(repository)

        count = WorkflowDefinition.objects.filter(
            repository=repository, biz_type="release"
        ).count()
        assert count == 3

    def test_builtin_flows_have_default_node_config(self, user):
        """正式发布默认仓库拥有者审批；RC / Beta 默认无须审批。"""
        repository = _repository(user, "DEFAULT", "默认节点仓库")
        ensure_builtin_workflow_definitions(repository)

        formal = WorkflowDefinition.objects.get(
            repository=repository, biz_type="release", release_type="formal"
        )
        assert formal.name == BUILTIN_RELEASE_FLOW_NAMES["formal"]
        assert formal.is_active is True
        assert len(formal.node_config) >= 1
        assert formal.node_config[0]["approvers"][0]["type"] == "repo_owner"

        for release_type in ("rc", "beta"):
            definition = WorkflowDefinition.objects.get(
                repository=repository, biz_type="release", release_type=release_type
            )
            assert definition.name == BUILTIN_RELEASE_FLOW_NAMES[release_type]
            assert definition.node_config == []

    def test_unique_constraint_per_release_type(self, user):
        """同仓库同发布类型只能存在一个流程定义"""
        repository = _repository(user, "UNIQUE", "唯一约束仓库")
        ensure_builtin_workflow_definitions(repository)
        with pytest.raises(Exception):
            WorkflowDefinition.objects.create(
                repository=repository,
                name="重复正式审批",
                biz_type="release",
                release_type="formal",
                node_config=[],
                graph_data={},
            )

    def test_repo_owner_approver_resolves_to_creator(self, user):
        """审批人类型 repo_owner 解析为仓库创建者。"""
        from apps.workflow.services import WorkflowEngine

        repository = _repository(user, "OWNER", "拥有者仓库")
        definition = WorkflowDefinition.objects.create(
            repository=repository,
            name="仓库拥有者审批",
            biz_type="release",
            node_config=[{
                "node_id": "approval_1",
                "node_name": "仓库拥有者",
                "mode": "any",
                "approvers": [{"type": "repo_owner"}],
            }],
            graph_data={},
            is_active=True,
        )
        instance = WorkflowEngine.create_instance(
            definition, "release", "00000000-0000-0000-0000-000000000010", user
        )
        assert instance.tasks.get().approver_id == user.id
