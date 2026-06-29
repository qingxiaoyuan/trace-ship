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
        validated_data["node_config"] = self._normalize_node_config(validated_data.get("node_config", []))
        validated_data["graph_data"] = self._build_graph_data(validated_data["node_config"])
        return super().create(validated_data)

    def update(self, instance: WorkflowDefinition, validated_data: dict) -> WorkflowDefinition:
        """更新流程定义时根据 node_config 重新生成 graph_data"""
        node_config = self._normalize_node_config(
            validated_data.get("node_config", instance.node_config or [])
        )
        validated_data["node_config"] = node_config
        validated_data["graph_data"] = self._build_graph_data(node_config)
        return super().update(instance, validated_data)

    @staticmethod
    def _normalize_node_config(node_config: list) -> list:
        """兼容旧流程定义，为审批节点补齐必需字段。"""
        import uuid

        normalized = []
        for index, node in enumerate(node_config or []):
            item = dict(node or {})
            item.setdefault("node_id", f"approval_{index + 1}_{uuid.uuid4().hex[:8]}")
            item.setdefault("node_name", f"审批节点 {index + 1}")
            item.setdefault("mode", "any")
            item.setdefault("approvers", [{"type": "leader"}])
            normalized.append(item)
        return normalized

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
    title = serializers.SerializerMethodField()
    applicant = serializers.SerializerMethodField()
    project_name = serializers.SerializerMethodField()
    current_node = serializers.CharField(source="node_name", read_only=True)
    submit_time = serializers.DateTimeField(source="created_at", read_only=True)
    version = serializers.SerializerMethodField()
    release_type = serializers.SerializerMethodField()
    source_branch = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowTask
        fields = [
            "id", "instance", "node_id", "node_name", "approver",
            "approver_name", "approver_username",
            "mode", "status", "comment", "action_time",
            "is_rollback", "rollback_target_node_id",
            "transferred_from", "transferred_from_name",
            "created_at", "updated_at",
            "title", "applicant", "project_name", "current_node",
            "submit_time", "version", "release_type", "source_branch",
        ]
        read_only_fields = [
            "id", "instance", "created_at", "updated_at",
            "approver_name", "approver_username", "transferred_from_name",
        ]

    @staticmethod
    def _get_release(obj: WorkflowTask):
        """按工作流实例关联的业务 ID 获取发布记录。"""
        if obj.instance.biz_type != "release":
            return None
        from apps.release.models import ReleaseRecord

        return (
            ReleaseRecord.objects.select_related("project", "publisher")
            .filter(id=obj.instance.biz_id)
            .first()
        )

    def get_title(self, obj: WorkflowTask) -> str:
        """返回审批标题。"""
        release = self._get_release(obj)
        return f"审批发布 {release.version}" if release else obj.node_name

    def get_applicant(self, obj: WorkflowTask) -> str:
        """返回申请人名称。"""
        release = self._get_release(obj)
        user = release.publisher if release else obj.instance.created_by
        if not user:
            return "-"
        return getattr(user, "nickname", "") or user.username

    def get_project_name(self, obj: WorkflowTask) -> str:
        """返回项目名称。"""
        release = self._get_release(obj)
        return release.project.name if release else obj.instance.definition.project.name

    def get_version(self, obj: WorkflowTask) -> str:
        """返回发布版本号。"""
        release = self._get_release(obj)
        return release.version if release else ""

    def get_release_type(self, obj: WorkflowTask) -> str:
        """返回发布类型。"""
        release = self._get_release(obj)
        return release.release_type if release else ""

    def get_source_branch(self, obj: WorkflowTask) -> str:
        """返回来源分支。"""
        release = self._get_release(obj)
        return release.source_branch if release else ""


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
