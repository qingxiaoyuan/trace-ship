"""
内置发布审批流程定义测试
"""
import pytest

from apps.project.models import Project
from apps.workflow.models import WorkflowDefinition
from apps.workflow.services import (
    BUILTIN_RELEASE_FLOW_NAMES,
    ensure_builtin_workflow_definitions,
)

pytestmark = pytest.mark.django_db


class TestBuiltinWorkflowDefinitions:
    """项目自带三种发布类型审批流程测试"""

    def test_ensure_creates_three_flows_for_new_project(self, user):
        """为项目补齐 formal/rc/beta 三个内置审批流程"""
        project = Project.objects.create(
            code="BUILTIN",
            name="内置流程测试项目",
            leader=user,
            status=1,
        )
        ensure_builtin_workflow_definitions(project)

        types = set(
            WorkflowDefinition.objects.filter(
                project=project, biz_type="release"
            ).values_list("release_type", flat=True)
        )
        assert types == {"formal", "rc", "beta"}

    def test_ensure_is_idempotent(self, user):
        """重复调用不会重复创建"""
        project = Project.objects.create(
            code="IDEMP",
            name="幂等测试项目",
            leader=user,
            status=1,
        )
        ensure_builtin_workflow_definitions(project)
        ensure_builtin_workflow_definitions(project)

        count = WorkflowDefinition.objects.filter(
            project=project, biz_type="release"
        ).count()
        assert count == 3

    def test_builtin_flows_have_default_node_config(self, user):
        """内置流程默认配置了项目负责人审批节点"""
        project = Project.objects.create(
            code="DEFAULT",
            name="默认节点测试项目",
            leader=user,
            status=1,
        )
        ensure_builtin_workflow_definitions(project)

        for release_type, name in BUILTIN_RELEASE_FLOW_NAMES.items():
            definition = WorkflowDefinition.objects.get(
                project=project, biz_type="release", release_type=release_type
            )
            assert definition.name == name
            assert definition.is_active is True
            assert len(definition.node_config) >= 1
            assert definition.node_config[0]["approvers"][0]["type"] == "leader"

    def test_unique_constraint_per_release_type(self, user):
        """同项目同发布类型只能存在一个流程定义"""
        project = Project.objects.create(
            code="UNIQUE",
            name="唯一约束测试项目",
            leader=user,
            status=1,
        )
        ensure_builtin_workflow_definitions(project)
        with pytest.raises(Exception):
            WorkflowDefinition.objects.create(
                project=project,
                name="重复正式审批",
                biz_type="release",
                release_type="formal",
                node_config=[],
                graph_data={},
            )
