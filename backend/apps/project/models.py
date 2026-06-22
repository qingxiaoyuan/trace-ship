import uuid
from django.db import models
from django.conf import settings


class Project(models.Model):
    STATUS_CHOICES = [
        (1, "启用"),
        (0, "停用"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.CharField(max_length=100, unique=True, verbose_name="项目编码")
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

    def __str__(self):
        return self.name


class ProjectMember(models.Model):
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

    def __str__(self):
        return f"{self.project.name} - {self.user.username} ({self.role})"


class ProjectIntegration(models.Model):
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

    def __str__(self):
        return f"{self.project.name} - {self.name}"
