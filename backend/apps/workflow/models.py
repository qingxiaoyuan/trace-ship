"""
工作流数据模型

包含工作流定义（WorkflowDefinition）、工作流实例（WorkflowInstance）和审批任务（WorkflowTask）。
支持基于审批链的串行审批、节点或签/会签以及回退。
"""
import uuid
from typing import List, Optional

from django.conf import settings
from django.db import models


class WorkflowDefinition(models.Model):
    """
    工作流定义模型

    每个项目可配置一个或多个业务流程定义，当前仅支持 release 业务类型。
    node_config 存储审批链配置，graph_data 由 node_config 自动生成并用于只读流程图渲染。

    Attributes:
        id: UUID 主键
        project: 所属项目
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
    project = models.ForeignKey(
        "project.Project",
        on_delete=models.CASCADE,
        related_name="workflow_definitions",
        verbose_name="所属项目",
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
            models.Index(fields=["project", "biz_type", "is_active"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "biz_type", "release_type"],
                name="uniq_project_biz_release_type",
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
