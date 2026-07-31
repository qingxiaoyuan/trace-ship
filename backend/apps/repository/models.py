"""
仓库管理数据模型

包含代码仓库（Repository）和提交记录（CommitRecord）。
"""
import uuid
from django.db import models

from apps.repository.managers import CommitRecordManager


class Repository(models.Model):
    """
    代码仓库模型

    表示项目下的一个代码仓库或外部仓库绑定，支持 Git/SVN 以及多种平台。

    Attributes:
        id: UUID 主键
        project: 所属项目
        repo_type: 仓库类型（git/svn）
        vendor: 平台厂商
        name: 仓库名称
        url: 仓库地址
        external_identity: 外部唯一标识
        default_branch: 默认分支
        credential: 关联凭证
        credential_mode: 凭证来源（个人 / 项目）
        health_status: 健康状态
        last_sync_at: 最后同步时间
        created_at: 创建时间
        updated_at: 更新时间
    """

    REPO_TYPE_CHOICES = [
        ("git", "Git"),
    ]
    # 代码仓库平台仅支持 GitLab；SVN 仅作为打包产物推送目标（见 apps.package）
    VENDOR_CHOICES = [
        ("gitlab", "GitLab"),
    ]
    HEALTH_STATUS_CHOICES = [
        ("healthy", "健康"),
        ("unhealthy", "异常"),
        ("unknown", "未知"),
    ]
    CREDENTIAL_MODE_CHOICES = [
        ("personal", "个人"),
        ("project", "项目"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "project.Project",
        on_delete=models.CASCADE,
        related_name="repositories",
        verbose_name="项目",
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
        default="project",
        verbose_name="凭证来源",
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


class RepositoryBranch(models.Model):
    """
    仓库分支模型

    存储仓库每个分支的最新提交信息（作者、时间、信息、哈希），
    通过「同步分支」按钮从远端拉取并落库，供分支界面展示。

    Attributes:
        id: UUID 主键
        repository: 所属仓库
        name: 分支名称
        is_default: 是否为默认分支
        last_commit_hash: 最新提交哈希
        last_commit_author: 最新提交人
        last_commit_message: 最新提交信息
        last_commit_at: 最新提交时间
        created_at: 创建时间
        updated_at: 更新时间
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    repository = models.ForeignKey(
        Repository,
        on_delete=models.CASCADE,
        related_name="branches",
        verbose_name="仓库",
    )
    name = models.CharField(max_length=200, verbose_name="分支名称")
    is_default = models.BooleanField(default=False, verbose_name="是否默认分支")
    last_commit_hash = models.CharField(max_length=100, blank=True, verbose_name="最新提交哈希")
    last_commit_author = models.CharField(max_length=200, blank=True, verbose_name="最新提交人")
    last_commit_message = models.TextField(blank=True, verbose_name="最新提交信息")
    last_commit_at = models.DateTimeField(null=True, blank=True, verbose_name="最新提交时间")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "repo_branch"
        verbose_name = "仓库分支"
        verbose_name_plural = "仓库分支"
        ordering = ["-is_default", "-last_commit_at"]
        unique_together = [("repository", "name")]
        indexes = [
            models.Index(fields=["repository", "name"]),
            models.Index(fields=["repository", "last_commit_at"]),
        ]

    def __str__(self) -> str:
        """返回仓库名-分支名描述"""
        return f"{self.repository.name} - {self.name}"


class RepositoryTag(models.Model):
    """
    仓库 Tag 模型

    同步分支时从远端扫描 tag，仅符合版本规则
    （{prefix}.主.次.修(-后缀)?_YYYYMMDD）的 tag 才会解析并入库，
    供版本计算与展示查询。

    Attributes:
        id: UUID 主键
        repository: 所属仓库
        name: tag 原始名称
        commit_hash: 指向的提交哈希
        major: 主版本号（正则解析）
        minor: 次版本号（正则解析）
        patch: 修订版本号（正则解析）
        suffix: 类型后缀（rc/beta，正式版为空）
        tag_date: tag 日期段（年月日）
        remote_created_at: 远端 tag 创建时间
        created_at: 创建时间
        updated_at: 更新时间
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    repository = models.ForeignKey(
        Repository,
        on_delete=models.CASCADE,
        related_name="tags",
        verbose_name="仓库",
    )
    name = models.CharField(max_length=200, verbose_name="Tag 名称")
    commit_hash = models.CharField(max_length=100, blank=True, verbose_name="提交哈希")
    major = models.IntegerField(null=True, blank=True, verbose_name="主版本号")
    minor = models.IntegerField(null=True, blank=True, verbose_name="次版本号")
    patch = models.IntegerField(null=True, blank=True, verbose_name="修订版本号")
    suffix = models.CharField(max_length=50, blank=True, verbose_name="类型后缀")
    tag_date = models.DateField(null=True, blank=True, verbose_name="Tag 日期")
    remote_created_at = models.DateTimeField(null=True, blank=True, verbose_name="远端创建时间")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "repo_tag"
        verbose_name = "仓库 Tag"
        verbose_name_plural = "仓库 Tag"
        ordering = ["-major", "-minor", "-patch", "-tag_date"]
        unique_together = [("repository", "name")]
        indexes = [
            models.Index(fields=["repository", "name"]),
            models.Index(fields=["repository", "tag_date"]),
        ]

    def __str__(self) -> str:
        """返回仓库名-Tag 名描述"""
        return f"{self.repository.name} - {self.name}"


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
