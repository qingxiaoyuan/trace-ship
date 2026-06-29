"""
发布管理数据模型

包含发布记录（ReleaseRecord）和发布关联提交（ReleaseCommit）。
"""
import uuid
from typing import Optional

from django.conf import settings
from django.db import models


class ReleaseRecord(models.Model):
    """
    发布记录模型

    表示一次软件版本发布申请的全生命周期，支持草稿、待审批、构建中、待发布、已发布、已驳回等状态。

    Attributes:
        id: UUID 主键
        project: 所属项目
        repository: 目标仓库（第三阶段新增，明确推 tag 的对象）
        version: 版本号
        tag_name: 要推送的 tag 名称
        source_branch: 来源分支（通常为 develop）
        target_branch: 目标分支（main / test-xxx）
        git_hash: 目标分支当前 commit hash
        release_type: 发布类型（formal 正式 / rc 候选 / beta 测试）
        status: 发布状态
        release_doc: 发布说明文档（JSON）
        publisher: 发布人
        jenkins_build: 关联的 Jenkins 构建记录
        rejected_reason: 驳回/失败原因
        released_at: 实际发布时间
        created_at: 创建时间
        updated_at: 更新时间
    """

    STATUS_CHOICES = [
        ("draft", "草稿"),
        ("pending", "待审批"),
        ("released", "已发布"),
        ("rejected", "已驳回"),
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
        related_name="releases",
        verbose_name="项目",
    )
    repository = models.ForeignKey(
        "repository.Repository",
        on_delete=models.CASCADE,
        related_name="releases",
        verbose_name="目标仓库",
    )
    version = models.CharField(max_length=100, verbose_name="版本号")
    tag_name = models.CharField(max_length=100, verbose_name="Tag 名称")
    source_branch = models.CharField(max_length=200, verbose_name="来源分支")
    target_branch = models.CharField(max_length=200, verbose_name="目标分支")
    git_hash = models.CharField(max_length=100, blank=True, verbose_name="Git 哈希")
    release_type = models.CharField(
        max_length=20,
        choices=RELEASE_TYPE_CHOICES,
        verbose_name="发布类型",
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="draft",
        verbose_name="状态",
    )
    release_doc = models.JSONField(default=dict, blank=True, verbose_name="发布说明文档")
    # 关联变更清单：硬件/软件版本条目列表，由发布向导收集
    related_changes = models.JSONField(default=list, blank=True, verbose_name="关联变更清单")
    # 变更条目：A 类 / F 类变更内容
    updates = models.JSONField(default=list, blank=True, verbose_name="变更条目")
    publisher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="releases",
        verbose_name="发布人",
    )
    jenkins_build = models.ForeignKey(
        "jenkins.JenkinsBuild",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="releases",
        verbose_name="Jenkins 构建记录",
    )
    workflow_instance = models.ForeignKey(
        "workflow.WorkflowInstance",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="releases",
        verbose_name="关联工作流实例",
    )
    rejected_reason = models.TextField(blank=True, verbose_name="驳回原因")
    released_at = models.DateTimeField(null=True, blank=True, verbose_name="发布时间")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "release_record"
        verbose_name = "发布记录"
        verbose_name_plural = "发布记录"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "status"]),
            models.Index(fields=["project", "release_type"]),
            models.Index(fields=["repository", "status"]),
            models.Index(fields=["version"]),
        ]

    def __str__(self) -> str:
        """返回版本号描述"""
        return f"{self.project.name} - {self.version}"


class ReleaseCommit(models.Model):
    """
    发布关联提交模型

    记录一次发布包含哪些 commit，以及是否纳入发布说明、人工编辑后的内容。

    Attributes:
        id: UUID 主键
        release: 关联发布记录
        commit: 关联提交记录
        is_included: 是否纳入发布说明
        edited_content: 人工编辑后的内容（JSON）
        created_at: 创建时间
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    release = models.ForeignKey(
        ReleaseRecord,
        on_delete=models.CASCADE,
        related_name="release_commits",
        verbose_name="发布记录",
    )
    commit = models.ForeignKey(
        "repository.CommitRecord",
        on_delete=models.CASCADE,
        related_name="release_commits",
        verbose_name="提交记录",
    )
    is_included = models.BooleanField(default=True, verbose_name="是否纳入发布说明")
    edited_content = models.JSONField(default=dict, blank=True, verbose_name="编辑后内容")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")

    class Meta:
        db_table = "release_commit"
        verbose_name = "发布关联提交"
        verbose_name_plural = "发布关联提交"
        unique_together = ["release", "commit"]

    def __str__(self) -> str:
        """返回提交哈希前 8 位"""
        return f"{self.release.version} - {self.commit.commit_hash[:8]}"
