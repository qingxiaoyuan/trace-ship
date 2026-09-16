"""
项目管理数据模型

包含项目（Project）、产品组件（ProductComponent）、项目成员（ProjectMember）。
Project 在业务语义上表示产品；产品通过 ProductComponent 组合可复用的物理仓库。
"""
import uuid

from django.conf import settings
from django.db import models


class Project(models.Model):
    """
    项目模型

    表示一个可交付软件产品，是产品组件、发布流程和打包配置的聚合根。

    Attributes:
        id: UUID 主键
        code: 项目编码（唯一）
        name: 项目名称
        leader: 项目负责人
        description: 项目描述
        version_rule: 版本号规则（JSON）
        release_rule: 发布规则（JSON）
        status: 状态（1 启用 / 0 停用）
        created_at: 创建时间
        updated_at: 更新时间
    """

    STATUS_CHOICES = [
        (1, "启用"),
        (0, "停用"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=100, unique=True, blank=True, verbose_name="项目编码")
    name = models.CharField(max_length=200, verbose_name="项目名称")
    leader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="led_projects",
        verbose_name="项目负责人",
    )
    description = models.TextField(blank=True, verbose_name="项目描述")
    version_rule = models.JSONField(default=dict, verbose_name="版本号规则")
    release_rule = models.JSONField(default=dict, verbose_name="发布规则")
    status = models.IntegerField(choices=STATUS_CHOICES, default=1, verbose_name="状态")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_project"
        verbose_name = "项目"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        """返回项目名称"""
        return self.name


class ProductComponent(models.Model):
    """
    产品组件模型

    表示一个产品对物理仓库的引用与产品内配置。同一仓库可以被多个产品引用，
    但组件编码、构建分支、源码子目录等配置互不影响。
    """

    VERSION_SCOPE_CHOICES = [
        ("repository", "仓库统一版本"),
        ("product_component", "产品组件独立版本"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name="product_components",
        verbose_name="所属产品",
    )
    repository = models.ForeignKey(
        "repository.Repository",
        on_delete=models.CASCADE,
        related_name="product_components",
        verbose_name="物理仓库",
    )
    component_code = models.CharField(max_length=100, verbose_name="组件编码")
    display_name = models.CharField(max_length=200, verbose_name="组件名称")
    default_branch = models.CharField(max_length=200, default="main", verbose_name="产品默认分支")
    source_subdir = models.CharField(max_length=300, blank=True, default="", verbose_name="源码子目录")
    required = models.BooleanField(default=True, verbose_name="是否必选组件")
    version_scope = models.CharField(
        max_length=30,
        choices=VERSION_SCOPE_CHOICES,
        default="repository",
        verbose_name="版本作用域",
    )
    tag_namespace = models.CharField(max_length=200, blank=True, default="", verbose_name="Tag 命名空间")
    product_config = models.JSONField(default=dict, blank=True, verbose_name="产品内配置")
    sort_order = models.PositiveIntegerField(default=0, verbose_name="排序")
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "project_component"
        verbose_name = "产品组件"
        verbose_name_plural = "产品组件"
        ordering = ["sort_order", "created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "component_code"],
                name="uniq_product_component_code",
            ),
        ]
        indexes = [
            models.Index(fields=["project", "is_active"]),
            models.Index(fields=["repository", "is_active"]),
        ]

    def __str__(self) -> str:
        """返回产品-组件描述"""
        return f"{self.project.name} - {self.display_name}"


class ProjectMember(models.Model):
    """
    项目成员模型

    表示用户与项目的关联关系及在项目中的角色。

    Attributes:
        id: UUID 主键
        project: 关联项目
        user: 关联用户
        role: 角色（developer/tester/manager/auditor/viewer/software_admin）
        created_at: 创建时间
    """

    ROLE_CHOICES = [
        ("developer", "开发人员"),
        ("tester", "测试人员"),
        ("manager", "项目管理员"),
        ("auditor", "审核人"),
        ("viewer", "只读人员"),
        ("software_admin", "软件管理员"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="members", verbose_name="项目")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="project_members",
        verbose_name="用户",
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default="developer", verbose_name="角色")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sys_project_member"
        verbose_name = "项目成员"
        unique_together = ["project", "user"]

    def __str__(self) -> str:
        """返回项目-用户-角色描述"""
        return f"{self.project.name} - {self.user.username} ({self.role})"
