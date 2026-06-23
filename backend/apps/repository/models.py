from apps.repository.managers import CommitRecordManager
import uuid
from django.db import models
from django.conf import settings


class Repository(models.Model):
    REPO_TYPE_CHOICES = [
        ("git", "Git"),
        ("svn", "SVN"),
    ]
    VENDOR_CHOICES = [
        ("gitlab", "GitLab"),
        ("gitea", "Gitea"),
        ("github", "GitHub"),
        ("gitee", "Gitee"),
        ("svn", "SVN"),
    ]
    HEALTH_STATUS_CHOICES = [
        ("healthy", "健康"),
        ("unhealthy", "异常"),
        ("unknown", "未知"),
    ]
    CREDENTIAL_MODE_CHOICES = [
        ("current_user", "当前用户"),
        ("specified_user", "指定用户"),
        ("fixed", "项目固定凭证"),
        ("global", "系统全局凭证"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "project.Project",
        on_delete=models.CASCADE,
        related_name="repositories",
        verbose_name="项目",
    )
    integration = models.ForeignKey(
        "project.ProjectIntegration",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="repositories",
        verbose_name="外站绑定",
    )
    repo_type = models.CharField(max_length=10, choices=REPO_TYPE_CHOICES, verbose_name="仓库类型")
    vendor = models.CharField(max_length=20, choices=VENDOR_CHOICES, verbose_name="平台")
    name = models.CharField(max_length=200, verbose_name="仓库名称")
    url = models.CharField(max_length=500, verbose_name="仓库地址")
    external_identity = models.CharField(max_length=500, blank=True, verbose_name="外部唯一标识")
    default_branch = models.CharField(max_length=200, default="main", verbose_name="默认分支")
    credential = models.ForeignKey(
        "credential.Credential",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="repositories",
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
        related_name="specified_repositories",
        verbose_name="指定用户",
    )
    health_status = models.CharField(
        max_length=20,
        choices=HEALTH_STATUS_CHOICES,
        default="unknown",
        verbose_name="健康状态",
    )
    last_sync_at = models.DateTimeField(null=True, blank=True, verbose_name="最后同步时间")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_repo"
        verbose_name = "代码仓库"
        verbose_name_plural = "代码仓库"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "repo_type"]),
            models.Index(fields=["project", "vendor"]),
            models.Index(fields=["health_status"]),
        ]

    def __str__(self):
        return f"{self.project.name} - {self.name}"


class CommitRecord(models.Model):
    REVIEW_STATUS_CHOICES = [
        ("unreviewed", "未审查"),
        ("pass", "通过"),
        ("warning", "警告"),
        ("illegal", "非法"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "project.Project",
        on_delete=models.CASCADE,
        related_name="commits",
        verbose_name="项目",
    )
    repository = models.ForeignKey(
        Repository,
        on_delete=models.CASCADE,
        related_name="commits",
        verbose_name="仓库",
    )
    commit_hash = models.CharField(max_length=100, verbose_name="提交哈希")
    author = models.CharField(max_length=200, verbose_name="提交人")
    author_email = models.CharField(max_length=200, blank=True, verbose_name="提交人邮箱")
    message = models.TextField(verbose_name="原始提交信息")
    committed_at = models.DateTimeField(verbose_name="提交时间")
    branch = models.CharField(max_length=200, blank=True, verbose_name="所属分支")
    parsed_message = models.JSONField(default=dict, verbose_name="解析结果")
    review_status = models.CharField(
        max_length=20,
        choices=REVIEW_STATUS_CHOICES,
        default="unreviewed",
        verbose_name="审查状态",
    )
    review_reason = models.TextField(blank=True, verbose_name="审查说明")
    ai_suggestion = models.TextField(blank=True, verbose_name="AI 建议")
    ai_review_at = models.DateTimeField(null=True, blank=True, verbose_name="AI 审查时间")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = CommitRecordManager()

    class Meta:
        db_table = "repo_commit"
        verbose_name = "提交记录"
        verbose_name_plural = "提交记录"
        ordering = ["-committed_at"]
        unique_together = [("repository", "commit_hash")]
        indexes = [
            models.Index(fields=["project", "review_status"]),
            models.Index(fields=["project", "branch"]),
            models.Index(fields=["project", "author"]),
            models.Index(fields=["project", "committed_at"]),
            models.Index(fields=["repository", "committed_at"]),
        ]

    def __str__(self):
        return f"{self.commit_hash[:8]} - {self.author}"
