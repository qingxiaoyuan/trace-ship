"""
工作流序列化器
"""
from rest_framework import serializers

from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask


class WorkflowDefinitionSerializer(serializers.ModelSerializer):
    """
    工作流定义序列化器
    """

    class Meta:
        model = WorkflowDefinition
        fields = [
            "id", "project", "name", "biz_type", "graph_data",
            "is_active", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]


class WorkflowDefinitionListSerializer(serializers.ModelSerializer):
    """
    工作流定义列表序列化器
    """

    class Meta:
        model = WorkflowDefinition
        fields = ["id", "project", "name", "biz_type", "is_active", "created_at"]


class WorkflowTaskSerializer(serializers.ModelSerializer):
    """
    审批任务序列化器
    """

    class Meta:
        model = WorkflowTask
        fields = [
            "id", "instance", "node_id", "node_name", "approver",
            "status", "comment", "action_time", "transferred_from",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "instance", "created_at", "updated_at"]


class WorkflowInstanceSerializer(serializers.ModelSerializer):
    """
    工作流实例序列化器

    读取时展开当前任务列表。
    """

    tasks = WorkflowTaskSerializer(many=True, read_only=True)

    class Meta:
        model = WorkflowInstance
        fields = [
            "id", "definition", "biz_type", "biz_id", "status",
            "current_node_id", "node_status", "graph_data",
            "created_by", "created_at", "updated_at", "completed_at", "tasks",
        ]
        read_only_fields = [
            "id", "biz_type", "biz_id", "status", "current_node_id",
            "node_status", "graph_data", "created_by",
            "created_at", "updated_at", "completed_at", "tasks",
        ]
