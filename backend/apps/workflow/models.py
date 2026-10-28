"""
工作流数据模型

包含工作流定义（WorkflowDefinition）、工作流实例（WorkflowInstance）和审批任务（WorkflowTask）。
支持基于审批链的串行审批、节点或签/会签以及回退。
"""
import uuid

from django.conf import settings
from django.db import models


class WorkflowDefinition(models.Model):
    """
    工作流定义模型

    每个仓库可配置一个或多个业务流程定义，当前仅支持 release 业务类型。
    node_config 存储审批链配置，graph_data 由 node_config 自动生成并用于只读流程图渲染。

    Attributes:
        id: UUID 主键
        repository: 所属物理仓库（审批流程随仓库维护）
        project: 历史所属项目（兼容字段，不再作为归属依据）
        name: 流程名称
        biz_type: 业务类型
        node_config: 审批链配置
        graph_data: 自动生成的 LogicFlow 图数据
        is_active: 是否启用
        created_by: 创建人
        created_at: 创建时间
        updated_at: 更新时间
    """

    BIZ_TYPE_CHOICES = [
        ("release", "发布审批"),
    ]

    RELEASE_TYPE_CHOICES = [
        ("formal", "正式"),
        ("rc", "RC"),
        ("beta", "Beta"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    repository = models.ForeignKey(
        "repository.Repository",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="workflow_definitions",
        verbose_name="所属仓库",
    )
    project = models.ForeignKey(
        "project.Project",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="workflow_definitions",
        verbose_name="历史所属项目",
    )
    name = models.CharField(max_length=200, verbose_name="流程名称")
    biz_type = models.CharField(
        max_length=50,
        choices=BIZ_TYPE_CHOICES,
        default="release",
        verbose_name="业务类型",
    )
    release_type = models.CharField(
        max_length=20,
        choices=RELEASE_TYPE_CHOICES,
        default="formal",
        verbose_name="发布类型",
    )
    node_config = models.JSONField(default=list, verbose_name="审批链配置")
    graph_data = models.JSONField(default=dict, verbose_name="流程图数据")
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_workflow_definitions",
        verbose_name="创建人",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "workflow_definition"
        verbose_name = "工作流定义"
        verbose_name_plural = "工作流定义"
        ordering = ["release_type", "-created_at"]
        indexes = [
            models.Index(fields=["repository", "biz_type", "is_active"], name="workflow_de_repo_biz_act_idx"),
            models.Index(fields=["project", "biz_type", "is_active"], name="workflow_de_project_424371_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["repository", "biz_type", "release_type"],
                name="uniq_repository_biz_release_type",
                condition=models.Q(repository__isnull=False),
            ),
        ]

    def __str__(self) -> str:
        """返回流程名称"""
        return self.name


class WorkflowInstance(models.Model):
    """
    工作流实例模型

    每次业务单据（如 ReleaseRecord）提交审批时生成一个实例，
    实例状态与业务单据状态联动。

    Attributes:
        id: UUID 主键
        definition: 关联定义
        biz_type: 业务类型
        biz_id: 业务单据 ID
        status: 实例状态
        current_node_id: 当前激活节点 ID
        node_status: 各节点状态快照
        graph_data: 实例图快照
        created_by: 发起人
        created_at: 创建时间
        updated_at: 更新时间
        completed_at: 完成时间
    """

    STATUS_CHOICES = [
        ("running", "运行中"),
        ("completed", "已完成"),
        ("rejected", "已驳回"),
        ("revoked", "已撤销"),
        ("returned", "已退回修改"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    definition = models.ForeignKey(
        WorkflowDefinition,
        on_delete=models.CASCADE,
        related_name="instances",
        verbose_name="关联定义",
    )
    biz_type = models.CharField(max_length=50, verbose_name="业务类型")
    biz_id = models.CharField(max_length=200, verbose_name="业务单据ID")
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="running",
        verbose_name="状态",
    )
    current_node_id = models.CharField(
        max_length=100,
        blank=True,
        default="",
        verbose_name="当前节点ID",
    )
    source_project = models.ForeignKey(
        "project.Project", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="workflow_history", verbose_name="发布所属项目快照",
    )
    source_biz_id = models.CharField(max_length=200, blank=True, default="", verbose_name="发布项目快照业务ID")
    # 无法解析的旧业务仅能依据定义中的明确项目授权，保留原 ID 防止换 ID 后沿用授权。
    legacy_project = models.ForeignKey(
        "project.Project", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="legacy_workflow_history", verbose_name="异常历史定义项目",
    )
    legacy_biz_id = models.CharField(max_length=200, blank=True, default="", verbose_name="异常历史原业务ID")
    # 存量流程没有真实快照，保留 NULL 以区分历史兼容行为。
    node_config_snapshot = models.JSONField(null=True, blank=True, verbose_name="提审时审批链快照")
    node_status = models.JSONField(default=dict, verbose_name="节点状态快照")
    graph_data = models.JSONField(default=dict, verbose_name="实例图快照")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_workflow_instances",
        verbose_name="发起人",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name="完成时间")
    returned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="returned_workflow_instances", verbose_name="退回修改操作人",
    )

    class Meta:
        db_table = "workflow_instance"
        verbose_name = "工作流实例"
        verbose_name_plural = "工作流实例"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["biz_type", "biz_id"]),
            models.Index(fields=["status", "created_by"]),
        ]

    def __str__(self) -> str:
        """返回实例描述"""
        return f"{self.definition.name} - {self.biz_id}"

    def save(self, *args, **kwargs) -> None:
        """规范化发布 ID；已有实例变更业务身份时清除原授权依据。"""
        update_fields = kwargs.get("update_fields")
        input_biz_id = self.biz_id
        valid_id = False
        if self.biz_type == "release":
            try:
                self.biz_id = str(uuid.UUID(str(self.biz_id)))
                valid_id = True
            except ValueError:
                pass
            if self.biz_id != input_biz_id and update_fields is not None:
                update_fields = {*update_fields, "biz_id"}
                kwargs["update_fields"] = update_fields

        if self._state.adding:
            if self.biz_type == "release" and valid_id and self.source_project_id:
                self.source_biz_id = self.biz_id
            # 只有无仓库的历史项目级定义能提供明确的项目归属。
            if (self.biz_type == "release" and not valid_id and not self.source_project_id
                    and self.definition_id and self.definition.repository_id is None and self.definition.project_id):
                self.legacy_project_id = self.definition.project_id
                self.legacy_biz_id = str(self.biz_id)
        elif update_fields is None or {"biz_id", "biz_type", "definition", "definition_id"} & set(update_fields):
            database = kwargs.get("using") or self._state.db
            previous = type(self).objects.using(database).filter(pk=self.pk).values(
                "biz_id", "biz_type", "definition_id",
            ).first()
            if previous and (
                (update_fields is None or "biz_id" in update_fields) and previous["biz_id"] != self.biz_id
                or (update_fields is None or "biz_type" in update_fields) and previous["biz_type"] != self.biz_type
                or (update_fields is None or {"definition", "definition_id"} & set(update_fields))
                and previous["definition_id"] != self.definition_id
            ):
                self.source_project = None
                self.source_biz_id = ""
                self.legacy_project = None
                self.legacy_biz_id = ""
                if update_fields is not None:
                    kwargs["update_fields"] = {*update_fields, "source_project", "source_biz_id", "legacy_project", "legacy_biz_id"}
        super().save(*args, **kwargs)



class WorkflowTask(models.Model):
    """
    工作流审批任务模型

    每个审批节点根据审批模式生成一个或多个 task，审批人处理后可推进流程。
    任务记录同时作为审批历史数据源。

    Attributes:
        id: UUID 主键
        instance: 关联实例
        node_id: 节点 ID
        node_name: 节点名称
        approver: 审批人
        mode: 审批模式（any=或签，all=会签）
        status: 任务状态
        comment: 审批意见
        action_time: 处理时间
        is_rollback: 是否为回退后重新生成的任务
        rollback_target_node_id: 回退目标节点 ID
        transferred_from: 转交来源人
        created_at: 创建时间
        updated_at: 更新时间
    """

    STATUS_CHOICES = [
        ("pending", "待处理"),
        ("approved", "已通过"),
        ("rejected", "已驳回"),
        ("transferred", "已转交"),
        ("rollbacked", "已回退"),
        ("revoked", "已终止"),
        ("returned", "已退回修改"),
    ]

    MODE_CHOICES = [
        ("any", "或签"),
        ("all", "会签"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    instance = models.ForeignKey(
        WorkflowInstance,
        on_delete=models.CASCADE,
        related_name="tasks",
        verbose_name="关联实例",
    )
    node_id = models.CharField(max_length=100, verbose_name="节点ID")
    node_name = models.CharField(max_length=200, verbose_name="节点名称")
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="workflow_tasks",
        verbose_name="审批人",
    )
    mode = models.CharField(
        max_length=10,
        choices=MODE_CHOICES,
        default="any",
        verbose_name="审批模式",
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="pending",
        verbose_name="状态",
    )
    comment = models.TextField(blank=True, verbose_name="审批意见")
    action_time = models.DateTimeField(null=True, blank=True, verbose_name="处理时间")
    is_rollback = models.BooleanField(default=False, verbose_name="回退重建")
    rollback_target_node_id = models.CharField(
        max_length=100,
        blank=True,
        default="",
        verbose_name="回退目标节点",
    )
    transferred_from = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="transferred_workflow_tasks",
        verbose_name="转交来源",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "workflow_task"
        verbose_name = "审批任务"
        verbose_name_plural = "审批任务"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["instance", "node_id"]),
            models.Index(fields=["approver", "status"]),
        ]

    def __str__(self) -> str:
        """返回任务描述"""
        return f"{self.node_name} - {self.approver.username or self.approver.id}"


class AIReviewRun(models.Model):
    """固定审批轮次内的 AI 审查节点及其不可变配置引用。"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    instance = models.ForeignKey(WorkflowInstance, on_delete=models.CASCADE, related_name="ai_reviews", verbose_name="审批轮次")
    node_id = models.CharField(max_length=100, verbose_name="节点标识")
    settings_version = models.ForeignKey("system.ReviewSettingsVersion", on_delete=models.PROTECT, verbose_name="审查配置快照")
    status = models.CharField(max_length=30, default="queued", verbose_name="审查状态")
    summary = models.CharField(max_length=500, blank=True, verbose_name="无源码状态摘要")
    dimensions = models.JSONField(default=list, verbose_name="实际审查维度")
    coverage = models.JSONField(default=dict, verbose_name="覆盖范围")
    findings = models.JSONField(default=list, verbose_name="审查发现")
    history = models.JSONField(default=list, verbose_name="过往执行记录")
    batch_results = models.JSONField(default=dict, verbose_name="已审查批次检查点")
    skipped_by = models.ForeignKey("account.User", null=True, blank=True, on_delete=models.SET_NULL,
                                   related_name="skipped_ai_reviews", verbose_name="跳过操作者")
    skipped_at = models.DateTimeField(null=True, blank=True, verbose_name="跳过时间")
    skip_reason = models.TextField(blank=True, verbose_name="跳过原因")
    token = models.UUIDField(default=uuid.uuid4, verbose_name="当前执行标识")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "workflow_ai_review_run"
        verbose_name = "AI 代码审查执行"
        constraints = [models.UniqueConstraint(fields=["instance", "node_id"], name="workflow_ai_review_node_unique")]


class AIReviewRemediation(models.Model):
    """人工采纳的代码问题；原始发现和处置历史独立于后续模型执行。"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    release = models.ForeignKey("release.ReleaseRecord", on_delete=models.CASCADE, related_name="ai_remediations", verbose_name="发布申请")
    instance = models.ForeignKey(WorkflowInstance, on_delete=models.CASCADE, related_name="ai_remediations", verbose_name="原审查轮次")
    run = models.ForeignKey(AIReviewRun, on_delete=models.CASCADE, related_name="remediations", verbose_name="原审查节点")
    finding_id = models.CharField(max_length=100, verbose_name="原发现标识")
    finding = models.JSONField(verbose_name="原发现证据")
    source_git_hash = models.CharField(max_length=100, verbose_name="原审查提交")
    source_token = models.CharField(max_length=100, verbose_name="原审查执行标识")
    status = models.CharField(max_length=30, default="pending_fix", verbose_name="整改状态")
    fix_note = models.TextField(blank=True, verbose_name="修复说明")
    history = models.JSONField(default=list, verbose_name="处置历史")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "workflow_ai_review_remediation"
        verbose_name = "AI 审查整改项"
        constraints = [models.UniqueConstraint(fields=["run", "finding_id"], name="workflow_ai_remediation_finding_unique")]
