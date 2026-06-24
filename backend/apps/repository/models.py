"""
仓库管理数据模型

包含代码仓库（Repository）和提交记录（CommitRecord）。
"""
import uuid
from django.db import models
from django.conf import settings

from apps.repository.managers import CommitRecordManager


class Repository(models.Model):
    """
    代码仓库模型

    表示项目下的一个代码仓库或外部仓库绑定，支持 Git/SVN 以及多种平台。

    Attributes:
        id: UUID 主键
        project: 所属项目
        integration: 关联的项目外站绑定
        repo_type: 仓库类型（git/svn）
        vendor: 平台厂商
        name: 仓库名称
        url: 仓库地址
        external_identity: 外部唯一标识
        default_branch: 默认分支
        credential: 关联凭证
        credential_mode: 凭证使用模式
        specified_user: 指定用户
        health_status: 健康状态
        last_sync_at: 最后同步时间
        created_at: 创建时间
        updated_at: 更新时间
    """

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

    def __str__(self) -> str:
        """返回项目-仓库名称描述"""
        return f"{self.project.name} - {self.name}"


class CommitRecord(models.Model):
    """
    提交记录模型

    存储仓库的每一次提交信息及审查结果，支持规则引擎审查。

    Attributes:
        id: UUID 主键
        project: 所属项目
        repository: 所属仓库
        commit_hash: 提交哈希
        author: 提交人
        author_email: 提交人邮箱
        message: 原始提交信息
        committed_at: 提交时间
        branch: 所属分支
        parsed_message: 解析结果（JSON）
        review_status: 审查状态
        review_reason: 审查说明
        created_at: 创建时间
        updated_at: 更新时间
    """
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
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # 使用自定义管理器
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

    def __str__(self) -> str:
        """返回提交哈希前 8 位和作者"""
        return f"{self.commit_hash[:8]} - {self.author}"
