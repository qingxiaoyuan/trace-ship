"""
工作流序列化器
"""
from rest_framework import serializers

from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask
from apps.workflow.services import resolve_release


def release_for_display(instance: WorkflowInstance, request):
    """旧审批分配不授予查看当前发布内容的权限；缓存仅存于本次请求。"""
    cache = None
    if request is not None:
        cache = getattr(request, "_workflow_release_display_cache", None)
        if cache is None:
            cache = {}
            request._workflow_release_display_cache = cache
        if instance.id in cache:
            return cache[instance.id]
    release = resolve_release(instance)
    if release is not None and release.workflow_instance_id != instance.id:
        user = getattr(request, "user", None)
        from apps.project.services import visible_project_ids

        if not user or not user.is_authenticated or not (
            user.is_superuser or visible_project_ids(user).filter(pk=release.project_id).exists()
        ):
            release = None
    if cache is not None:
        cache[instance.id] = release
    return release


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
            "package_status": "",
        }
    return {
        "version": release.version,
        "release_type": release.release_type,
        "branch": release.branch,
        "package_status": release.package_tasks.order_by("-created_at").first().status
        if hasattr(release, "package_tasks") and release.package_tasks.exists()
        else "",
    }


class WorkflowDefinitionSerializer(serializers.ModelSerializer):
    """
    工作流定义序列化器

    node_config 为可编辑的审批链配置，graph_data 由后端根据 node_config 自动生成。
    """

    class Meta:
        model = WorkflowDefinition
        fields = [
            "id", "repository", "project", "name", "biz_type", "release_type",
            "node_config", "graph_data",
            "is_active", "created_by", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "repository", "project", "name", "biz_type", "release_type",
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
            "id", "repository", "project", "name", "biz_type", "release_type",
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
    repository_name = serializers.SerializerMethodField()
    current_node = serializers.CharField(source="node_name", read_only=True)
    submit_time = serializers.DateTimeField(source="created_at", read_only=True)
    version = serializers.SerializerMethodField()
    release_type = serializers.SerializerMethodField()
    branch = serializers.SerializerMethodField()
    package_status = serializers.SerializerMethodField()
    can_act = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowTask
        fields = [
            "id", "instance", "node_id", "node_name", "approver",
            "approver_name", "approver_username",
            "mode", "status", "comment", "action_time",
            "is_rollback", "rollback_target_node_id",
            "transferred_from", "transferred_from_name",
            "created_at", "updated_at",
            "title", "applicant", "project_name", "repository_name", "current_node",
            "submit_time", "version", "release_type",
            "branch", "package_status", "can_act",
        ]
        read_only_fields = [
            "id", "instance", "created_at", "updated_at",
            "approver_name", "approver_username", "transferred_from_name",
        ]

    def get_can_act(self, obj: WorkflowTask) -> bool:
        """审批操作能力以实际业务项目和当前任务归属为准。"""
        from utils.permissions import IsNotProjectMaintainer

        request = self.context.get("request")
        permission = IsNotProjectMaintainer()
        return bool(request and str(obj.approver_id) == str(request.user.id)
                    and obj.status == "pending" and obj.instance.status == "running"
                    and permission.has_permission(request, None) and permission.has_object_permission(request, None, obj))

    def get_title(self, obj: WorkflowTask) -> str:
        """返回审批标题。"""
        release = release_for_display(obj.instance, self.context.get("request"))
        return f"审批发布 {release.version}" if release else obj.node_name

    def get_applicant(self, obj: WorkflowTask) -> str:
        """返回申请人名称。"""
        release = release_for_display(obj.instance, self.context.get("request"))
        return user_display(release.publisher if release else obj.instance.created_by)

    def get_project_name(self, obj: WorkflowTask) -> str:
        """返回项目名称。"""
        release = release_for_display(obj.instance, self.context.get("request"))
        project = release.project if release else obj.instance.source_project or obj.instance.legacy_project or obj.instance.definition.project
        return project.name if project else ""

    def get_repository_name(self, obj: WorkflowTask) -> str:
        """返回仓库名（审批页「软件」）。"""
        release = release_for_display(obj.instance, self.context.get("request"))
        if release and release.repository_id:
            return release.repository.name
        return ""

    def get_version(self, obj: WorkflowTask) -> str:
        """返回发布版本号。"""
        return release_fields(release_for_display(obj.instance, self.context.get("request")))["version"]

    def get_release_type(self, obj: WorkflowTask) -> str:
        """返回发布类型。"""
        return release_fields(release_for_display(obj.instance, self.context.get("request")))["release_type"]

    def get_branch(self, obj: WorkflowTask) -> str:
        """返回发布分支。"""
        return release_fields(release_for_display(obj.instance, self.context.get("request")))["branch"]

    def get_package_status(self, obj: WorkflowTask):
        """返回最近打包任务状态。"""
        return release_fields(release_for_display(obj.instance, self.context.get("request")))["package_status"]


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
    title = serializers.SerializerMethodField()
    applicant = serializers.SerializerMethodField()
    project_name = serializers.SerializerMethodField()
    repository_name = serializers.SerializerMethodField()
    current_node = serializers.SerializerMethodField()
    submit_time = serializers.DateTimeField(source="created_at", read_only=True)
    version = serializers.SerializerMethodField()
    release_type = serializers.SerializerMethodField()
    branch = serializers.SerializerMethodField()
    package_status = serializers.SerializerMethodField()
    git_hash = serializers.SerializerMethodField()
    tag_name = serializers.SerializerMethodField()
    release_doc = serializers.SerializerMethodField()
    can_revoke = serializers.SerializerMethodField()
    is_current = serializers.SerializerMethodField()
    has_config_snapshot = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowInstance
        fields = [
            "id", "definition", "definition_name",
            "biz_type", "biz_id", "status",
            "current_node_id", "node_status", "graph_data",
            "created_by", "created_at", "updated_at", "completed_at", "tasks",
            "title", "applicant", "project_name", "repository_name", "current_node", "submit_time",
            "version", "release_type", "branch", "package_status",
            "git_hash", "tag_name", "release_doc", "can_revoke", "is_current", "has_config_snapshot",
        ]
        read_only_fields = [
            "id", "definition_name", "biz_type", "biz_id", "status",
            "current_node_id", "node_status", "graph_data", "created_by",
            "created_at", "updated_at", "completed_at", "tasks",
            "title", "applicant", "project_name", "repository_name", "current_node", "submit_time",
            "version", "release_type", "branch", "package_status",
            "git_hash", "tag_name", "release_doc",
        ]

    def get_is_current(self, obj: WorkflowInstance) -> bool:
        release = resolve_release(obj)
        return bool(release and release.workflow_instance_id == obj.id)

    def get_has_config_snapshot(self, obj: WorkflowInstance) -> bool:
        return obj.node_config_snapshot is not None

    def get_can_revoke(self, obj: WorkflowInstance) -> bool:
        """历史发起人变为维保后不再显示撤销能力。"""
        from utils.permissions import IsNotProjectMaintainer

        request = self.context.get("request")
        permission = IsNotProjectMaintainer()
        return bool(request and str(obj.created_by_id) == str(request.user.id) and obj.status == "running"
                    and permission.has_permission(request, None) and permission.has_object_permission(request, None, obj))

    def get_title(self, obj: WorkflowInstance) -> str:
        """返回审批标题。"""
        release = release_for_display(obj, self.context.get("request"))
        return f"审批发布 {release.version}" if release else obj.definition.name

    def get_applicant(self, obj: WorkflowInstance) -> str:
        """返回发起人名称。"""
        release = release_for_display(obj, self.context.get("request"))
        return user_display(release.publisher if release else obj.created_by)

    def get_project_name(self, obj: WorkflowInstance) -> str:
        """返回项目名称。"""
        release = release_for_display(obj, self.context.get("request"))
        project = release.project if release else obj.source_project or obj.legacy_project or obj.definition.project
        return project.name if project else ""

    def get_repository_name(self, obj: WorkflowInstance) -> str:
        """返回仓库名（审批页「软件」）。"""
        release = release_for_display(obj, self.context.get("request"))
        if release and release.repository_id:
            return release.repository.name
        return ""

    def get_current_node(self, obj: WorkflowInstance) -> str:
        """返回当前节点名称。"""
        pending = obj.tasks.filter(status="pending").first()
        if pending and pending.node_name:
            return pending.node_name
        return obj.current_node_id

    def get_version(self, obj: WorkflowInstance) -> str:
        """返回发布版本号。"""
        return release_fields(release_for_display(obj, self.context.get("request")))["version"]

    def get_release_type(self, obj: WorkflowInstance) -> str:
        """返回发布类型。"""
        return release_fields(release_for_display(obj, self.context.get("request")))["release_type"]

    def get_branch(self, obj: WorkflowInstance) -> str:
        """返回发布分支。"""
        return release_fields(release_for_display(obj, self.context.get("request")))["branch"]

    def get_package_status(self, obj: WorkflowInstance):
        """返回最近打包任务状态。"""
        return release_fields(release_for_display(obj, self.context.get("request")))["package_status"]

    def get_git_hash(self, obj: WorkflowInstance) -> str:
        """返回发布分支的 commit hash（创建/修改发布时快照）。"""
        release = release_for_display(obj, self.context.get("request"))
        return release.git_hash if release else ""

    def get_tag_name(self, obj: WorkflowInstance) -> str:
        """返回发布目标 tag 名。"""
        release = release_for_display(obj, self.context.get("request"))
        return release.tag_name if release else ""

    def get_release_doc(self, obj: WorkflowInstance) -> str:
        """返回发布说明（变更文档）内容，供审批人查看。"""
        release = release_for_display(obj, self.context.get("request"))
        return release.release_doc if release else ""


class WorkflowInstanceListSerializer(serializers.ModelSerializer):
    """
    工作流实例列表序列化器（轻量）

    用于「我发起的」等列表场景，返回与审批任务列表兼容的扁平字段，
    避免在列表中展开完整的 graph_data / tasks。
    """

    title = serializers.SerializerMethodField()
    applicant = serializers.SerializerMethodField()
    project_name = serializers.SerializerMethodField()
    repository_name = serializers.SerializerMethodField()
    current_node = serializers.SerializerMethodField()
    submit_time = serializers.DateTimeField(source="created_at", read_only=True)
    version = serializers.SerializerMethodField()
    release_type = serializers.SerializerMethodField()
    branch = serializers.SerializerMethodField()
    package_status = serializers.SerializerMethodField()
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = WorkflowInstance
        fields = [
            "id", "definition", "biz_type", "biz_id", "status", "is_current",
            "current_node_id", "created_by", "created_at", "completed_at",
            "title", "applicant", "project_name", "repository_name", "current_node", "submit_time",
            "version", "release_type",
            "branch", "package_status",
        ]
        read_only_fields = fields

    def get_is_current(self, obj: WorkflowInstance) -> bool:
        release = resolve_release(obj)
        return bool(release and release.workflow_instance_id == obj.id)

    def get_title(self, obj: WorkflowInstance) -> str:
        """返回审批标题。"""
        release = release_for_display(obj, self.context.get("request"))
        return f"审批发布 {release.version}" if release else obj.definition.name

    def get_applicant(self, obj: WorkflowInstance) -> str:
        """返回发起人名称。"""
        release = release_for_display(obj, self.context.get("request"))
        return user_display(release.publisher if release else obj.created_by)

    def get_project_name(self, obj: WorkflowInstance) -> str:
        """返回项目名称。"""
        release = release_for_display(obj, self.context.get("request"))
        project = release.project if release else obj.source_project or obj.legacy_project or obj.definition.project
        return project.name if project else ""

    def get_repository_name(self, obj: WorkflowInstance) -> str:
        """返回仓库名（审批页「软件」）。"""
        release = release_for_display(obj, self.context.get("request"))
        if release and release.repository_id:
            return release.repository.name
        return ""

    def get_current_node(self, obj: WorkflowInstance) -> str:
        """返回当前节点名称：优先取进行中任务的节点名，回退到节点 ID。"""
        pending = obj.tasks.filter(status="pending").first()
        if pending and pending.node_name:
            return pending.node_name
        return obj.current_node_id

    def get_version(self, obj: WorkflowInstance) -> str:
        """返回发布版本号。"""
        return release_fields(release_for_display(obj, self.context.get("request")))["version"]

    def get_release_type(self, obj: WorkflowInstance) -> str:
        """返回发布类型。"""
        return release_fields(release_for_display(obj, self.context.get("request")))["release_type"]

    def get_branch(self, obj: WorkflowInstance) -> str:
        """返回发布分支。"""
        return release_fields(release_for_display(obj, self.context.get("request")))["branch"]

    def get_package_status(self, obj: WorkflowInstance):
        """返回最近打包任务状态。"""
        return release_fields(release_for_display(obj, self.context.get("request")))["package_status"]
