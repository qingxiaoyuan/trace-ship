"""
工作流序列化器
"""
from django.core.exceptions import ValidationError
from rest_framework import serializers

from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask


def resolve_release(instance: WorkflowInstance):
    """按工作流实例关联的业务 ID 获取发布记录，供任务/实例序列化器共用。

    biz_id 理论上为发布记录的 UUID；对非 release 业务或异常 biz_id 容错返回 None，
    避免单个实例序列化失败导致整个列表 500。
    """
    if instance.biz_type != "release":
        return None
    from apps.release.models import ReleaseRecord

    try:
        return (
            ReleaseRecord.objects.select_related("project", "publisher", "jenkins_build")
            .filter(id=instance.biz_id)
            .first()
        )
    except (ValueError, ValidationError):
        return None


def user_display(user) -> str:
    """返回用户的展示名（昵称优先，回退到用户名）。"""
    if not user:
        return "-"
    return getattr(user, "nickname", "") or user.username


def release_fields(release) -> dict:
    """返回发布记录的纯字段；release 为 None 时给空值。"""
    if not release:
        return {
            "version": "",
            "release_type": "",
            "branch": "",
            "build_number": None,
        }
    return {
        "version": release.version,
        "release_type": release.release_type,
        "branch": release.branch,
        "build_number": release.jenkins_build.build_number if release.jenkins_build_id else None,
    }


class WorkflowDefinitionSerializer(serializers.ModelSerializer):
    """
    工作流定义序列化器

    node_config 为可编辑的审批链配置，graph_data 由后端根据 node_config 自动生成。
    """

    class Meta:
        model = WorkflowDefinition
        fields = [
            "id", "project", "name", "biz_type", "release_type",
            "node_config", "graph_data",
            "is_active", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "project", "name", "biz_type", "release_type",
            "graph_data", "is_active", "created_by", "created_at", "updated_at",
        ]

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
            "id", "project", "name", "biz_type", "release_type",
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
    branch = serializers.SerializerMethodField()
    build_number = serializers.SerializerMethodField()

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
            "submit_time", "version", "release_type",
            "branch", "build_number",
        ]
        read_only_fields = [
            "id", "instance", "created_at", "updated_at",
            "approver_name", "approver_username", "transferred_from_name",
        ]

    def get_title(self, obj: WorkflowTask) -> str:
        """返回审批标题。"""
        release = resolve_release(obj.instance)
        return f"审批发布 {release.version}" if release else obj.node_name

    def get_applicant(self, obj: WorkflowTask) -> str:
        """返回申请人名称。"""
        release = resolve_release(obj.instance)
        return user_display(release.publisher if release else obj.instance.created_by)

    def get_project_name(self, obj: WorkflowTask) -> str:
        """返回项目名称。"""
        release = resolve_release(obj.instance)
        return release.project.name if release else obj.instance.definition.project.name

    def get_version(self, obj: WorkflowTask) -> str:
        """返回发布版本号。"""
        return release_fields(resolve_release(obj.instance))["version"]

    def get_release_type(self, obj: WorkflowTask) -> str:
        """返回发布类型。"""
        return release_fields(resolve_release(obj.instance))["release_type"]

    def get_branch(self, obj: WorkflowTask) -> str:
        """返回发布分支。"""
        return release_fields(resolve_release(obj.instance))["branch"]

    def get_build_number(self, obj: WorkflowTask):
        """返回关联 Jenkins 构建号。"""
        return release_fields(resolve_release(obj.instance))["build_number"]


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


class WorkflowInstanceListSerializer(serializers.ModelSerializer):
    """
    工作流实例列表序列化器（轻量）

    用于「我发起的」等列表场景，返回与审批任务列表兼容的扁平字段，
    避免在列表中展开完整的 graph_data / tasks。
    """

    title = serializers.SerializerMethodField()
    applicant = serializers.SerializerMethodField()
    project_name = serializers.SerializerMethodField()
    current_node = serializers.SerializerMethodField()
    submit_time = serializers.DateTimeField(source="created_at", read_only=True)
    version = serializers.SerializerMethodField()
    release_type = serializers.SerializerMethodField()
    branch = serializers.SerializerMethodField()
    build_number = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowInstance
        fields = [
            "id", "definition", "biz_type", "biz_id", "status",
            "current_node_id", "created_by", "created_at", "completed_at",
            "title", "applicant", "project_name", "current_node", "submit_time",
            "version", "release_type",
            "branch", "build_number",
        ]
        read_only_fields = fields

    def get_title(self, obj: WorkflowInstance) -> str:
        """返回审批标题。"""
        release = resolve_release(obj)
        return f"审批发布 {release.version}" if release else obj.definition.name

    def get_applicant(self, obj: WorkflowInstance) -> str:
        """返回发起人名称。"""
        release = resolve_release(obj)
        return user_display(release.publisher if release else obj.created_by)

    def get_project_name(self, obj: WorkflowInstance) -> str:
        """返回项目名称。"""
        release = resolve_release(obj)
        return release.project.name if release else obj.definition.project.name

    def get_current_node(self, obj: WorkflowInstance) -> str:
        """返回当前节点名称：优先取进行中任务的节点名，回退到节点 ID。"""
        pending = obj.tasks.filter(status="pending").first()
        if pending and pending.node_name:
            return pending.node_name
        return obj.current_node_id

    def get_version(self, obj: WorkflowInstance) -> str:
        """返回发布版本号。"""
        return release_fields(resolve_release(obj))["version"]

    def get_release_type(self, obj: WorkflowInstance) -> str:
        """返回发布类型。"""
        return release_fields(resolve_release(obj))["release_type"]

    def get_branch(self, obj: WorkflowInstance) -> str:
        """返回发布分支。"""
        return release_fields(resolve_release(obj))["branch"]

    def get_build_number(self, obj: WorkflowInstance):
        """返回关联 Jenkins 构建号。"""
        return release_fields(resolve_release(obj))["build_number"]
