"""
项目管理数据模型

包含项目（Project）、项目成员（ProjectMember）。
仓库与打包配置直接归属项目并绑定凭证，不再经过外站绑定层。
"""
import uuid
from django.db import models
from django.conf import settings


class Project(models.Model):
    """
    项目模型

    表示一个软件项目，是 Git 仓库、发布流程、系统内置打包配置的合集。

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


class ProjectMember(models.Model):
    """
    项目成员模型

    表示用户与项目的关联关系及在项目中的角色。

    Attributes:
        id: UUID 主键
        project: 关联项目
        user: 关联用户
        role: 角色（developer/tester/manager/auditor/viewer）
        created_at: 创建时间
    """

    ROLE_CHOICES = [
        ("developer", "开发人员"),
        ("tester", "测试人员"),
        ("manager", "项目管理员"),
        ("auditor", "审核人"),
        ("viewer", "只读人员"),
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

