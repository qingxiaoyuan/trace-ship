"""
工作流序列化器
"""
from rest_framework import serializers

from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask


class WorkflowDefinitionSerializer(serializers.ModelSerializer):
    """
    工作流定义序列化器

    node_config 为可编辑的审批链配置，graph_data 由后端根据 node_config 自动生成。
    """

    class Meta:
        model = WorkflowDefinition
        fields = [
            "id", "project", "name", "biz_type",
            "node_config", "graph_data",
            "is_active", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "graph_data", "created_by", "created_at", "updated_at"]

    def create(self, validated_data: dict) -> WorkflowDefinition:
        """创建流程定义时根据 node_config 自动生成 graph_data"""
        validated_data["graph_data"] = self._build_graph_data(validated_data.get("node_config", []))
        return super().create(validated_data)

    def update(self, instance: WorkflowDefinition, validated_data: dict) -> WorkflowDefinition:
        """更新流程定义时根据 node_config 重新生成 graph_data"""
        validated_data["graph_data"] = self._build_graph_data(
            validated_data.get("node_config", instance.node_config or [])
        )
        return super().update(instance, validated_data)

    @staticmethod
    def _build_graph_data(node_config: list) -> dict:
        """调用引擎方法将审批链转换为 LogicFlow 图数据"""
        from apps.workflow.services import WorkflowEngine

        return WorkflowEngine._build_graph_data(node_config)


class WorkflowDefinitionListSerializer(serializers.ModelSerializer):
    """
    工作流定义列表序列化器

    列表同时返回 graph_data，便于前端流程定义预览直接渲染只读流程图。
    """

    class Meta:
        model = WorkflowDefinition
        fields = [
            "id", "project", "name", "biz_type",
            "node_config", "graph_data", "is_active", "created_at",
        ]
        read_only_fields = ["graph_data"]


class WorkflowTaskSerializer(serializers.ModelSerializer):
    """
    审批任务序列化器

    包含审批人基本信息，便于前端历史记录展示。
    """

    approver_name = serializers.CharField(
        source="approver.nickname",
        read_only=True,
    )
    approver_username = serializers.CharField(
        source="approver.username",
        read_only=True,
    )
    transferred_from_name = serializers.CharField(
        source="transferred_from.nickname",
        read_only=True,
    )

    class Meta:
        model = WorkflowTask
        fields = [
            "id", "instance", "node_id", "node_name", "approver",
            "approver_name", "approver_username",
            "mode", "status", "comment", "action_time",
            "is_rollback", "rollback_target_node_id",
            "transferred_from", "transferred_from_name",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "instance", "created_at", "updated_at",
            "approver_name", "approver_username", "transferred_from_name",
        ]


class WorkflowInstanceSerializer(serializers.ModelSerializer):
    """
    工作流实例序列化器

    读取时展开任务列表，任务列表同时作为审批历史数据源。
    """

    tasks = WorkflowTaskSerializer(many=True, read_only=True)
    definition_name = serializers.CharField(
        source="definition.name",
        read_only=True,
    )

    class Meta:
        model = WorkflowInstance
        fields = [
            "id", "definition", "definition_name",
            "biz_type", "biz_id", "status",
            "current_node_id", "node_status", "graph_data",
            "created_by", "created_at", "updated_at", "completed_at", "tasks",
        ]
        read_only_fields = [
            "id", "definition_name", "biz_type", "biz_id", "status",
            "current_node_id", "node_status", "graph_data", "created_by",
            "created_at", "updated_at", "completed_at", "tasks",
        ]
