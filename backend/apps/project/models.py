"""
项目管理数据模型

包含项目（Project）、项目成员（ProjectMember）以及项目外站绑定（ProjectIntegration）。
"""
import uuid
from django.db import models
from django.conf import settings


class Project(models.Model):
    """
    项目模型

    表示一个软件项目，包含基本资料、负责人、版本/发布规则以及状态。

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


class ProjectIntegration(models.Model):
    """
    项目外站绑定模型

    用于将外部系统（Git/SVN/Jenkins）绑定到项目，并配置凭证使用模式。

    Attributes:
        id: UUID 主键
        project: 关联项目
        integration_type: 绑定类型
        vendor: 平台厂商
        name: 绑定名称
        external_identity: 外部唯一标识
        config: 额外配置（JSON）
        credential: 关联凭证
        credential_mode: 凭证使用模式
        specified_user: 指定用户（specified_user 模式使用）
        is_active: 是否启用
        created_at: 创建时间
        updated_at: 更新时间
    """

    INTEGRATION_TYPE_CHOICES = [
        ("git_repo", "Git仓库"),
        ("svn_repo", "SVN仓库"),
        ("jenkins", "Jenkins任务"),
    ]
    VENDOR_CHOICES = [
        ("gitlab", "GitLab"),
        ("gitea", "Gitea"),
        ("github", "GitHub"),
        ("gitee", "Gitee"),
        ("svn", "SVN"),
        ("jenkins", "Jenkins"),
    ]
    CREDENTIAL_MODE_CHOICES = [
        ("current_user", "当前用户"),
        ("specified_user", "指定用户"),
        ("fixed", "项目固定凭证"),
        ("global", "系统全局凭证"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="integrations", verbose_name="项目")
    integration_type = models.CharField(max_length=20, choices=INTEGRATION_TYPE_CHOICES, verbose_name="绑定类型")
    vendor = models.CharField(max_length=20, choices=VENDOR_CHOICES, blank=True, verbose_name="平台")
    name = models.CharField(max_length=200, verbose_name="绑定名称")
    external_identity = models.CharField(max_length=500, blank=True, verbose_name="外部唯一标识")
    config = models.JSONField(default=dict, verbose_name="额外配置")
    credential = models.ForeignKey(
        "credential.Credential",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="integrations",
        verbose_name="关联凭证",
    )
    credential_mode = models.CharField(
        max_length=20,
        choices=CREDENTIAL_MODE_CHOICES,
        default="fixed",
        verbose_name="凭证使用模式",
    )
    specified_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="specified_integrations",
        verbose_name="指定用户",
    )
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_project_integration"
        verbose_name = "项目外站绑定"

    def __str__(self) -> str:
        """返回项目-绑定名称描述"""
        return f"{self.project.name} - {self.name}"
