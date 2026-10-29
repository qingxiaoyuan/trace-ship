"""当前节点只属于运行中流程，并使用本轮保存的中文名称。"""
import pytest

from apps.workflow.models import WorkflowTask
from apps.workflow.serializers import WorkflowInstanceListSerializer, WorkflowInstanceSerializer

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize('serializer', [WorkflowInstanceListSerializer, WorkflowInstanceSerializer])
@pytest.mark.parametrize('status', ['completed', 'rejected', 'revoked', 'returned'])
def test_terminal_instance_has_no_current_node(instance, serializer, status):
    instance.status = status
    instance.current_node_id = 'approval_1'
    assert serializer().get_current_node(instance) == ''


@pytest.mark.parametrize('serializer', [WorkflowInstanceListSerializer, WorkflowInstanceSerializer])
def test_ai_node_without_human_tasks_uses_saved_name(instance, serializer):
    instance.current_node_id = 'ai_123'
    instance.node_config_snapshot = [{'node_id': 'ai_123', 'node_name': 'AI 代码审查', 'node_type': 'ai_review'}]
    assert serializer().get_current_node(instance) == 'AI 代码审查'


@pytest.mark.parametrize('serializer', [WorkflowInstanceListSerializer, WorkflowInstanceSerializer])
def test_unrelated_pending_task_is_not_the_current_node(instance, user, serializer):
    instance.current_node_id = 'human_2'
    instance.node_config_snapshot = [{'node_id': 'human_2', 'node_name': '本轮复核'}]
    WorkflowTask.objects.create(instance=instance, node_id='human_1', node_name='上一节点', approver=user, status='pending')
    assert serializer().get_current_node(instance) == '本轮复核'


@pytest.mark.parametrize('text', ['历史审批\n或签', {'value': '历史审批\n或签'}])
def test_legacy_graph_uses_saved_label_before_current_definition(instance, text):
    instance.graph_data = {'nodes': [{'id': 'approval_1', 'text': text}]}
    assert WorkflowInstanceSerializer().get_current_node(instance) == '历史审批'


@pytest.mark.parametrize('snapshot,graph', [
    (None, None),
    ({'nodes': []}, {'nodes': None}),
    ([None, {'node_id': 'approval_1', 'node_name': 'approval_1'}],
     {'nodes': [{'id': 'approval_1', 'text': 'approval_1'}]}),
])
def test_unrecorded_name_never_falls_back_to_live_definition_or_internal_id(instance, snapshot, graph):
    instance.node_config_snapshot = snapshot
    instance.graph_data = graph
    assert instance.definition.node_config[0]['node_name'] == '技术负责人审批'
    assert WorkflowInstanceSerializer().get_current_node(instance) == ''


def test_legacy_task_fallback_only_uses_matching_pending_node(instance, user):
    WorkflowTask.objects.create(instance=instance, node_id='other', node_name='其他节点', approver=user, status='pending')
    WorkflowTask.objects.create(instance=instance, node_id='approval_1', node_name='旧的已办名称', approver=user, status='approved')
    WorkflowTask.objects.create(instance=instance, node_id='approval_1', node_name='本轮待审节点', approver=user, status='pending')
    assert WorkflowInstanceSerializer().get_current_node(instance) == '本轮待审节点'


@pytest.mark.parametrize('status,expected', [('running', '本轮审批'), ('completed', '')])
def test_list_and_detail_agree_without_updating_saved_state(instance, user, status, expected):
    from rest_framework.test import APIClient

    instance.status = status
    instance.node_config_snapshot = [{'node_id': 'approval_1', 'node_name': '本轮审批'}]
    instance.save(update_fields=['status', 'node_config_snapshot'])
    client = APIClient()
    client.force_authenticate(user=user)
    listing = client.get('/api/workflow/instances/initiated/')
    detail = client.get(f'/api/workflow/instances/{instance.id}/')
    assert listing.status_code == detail.status_code == 200
    assert listing.data['data']['results'][0]['current_node'] == expected
    assert detail.data['data']['current_node'] == expected
    instance.refresh_from_db()
    assert instance.status == status
    assert instance.current_node_id == 'approval_1'
