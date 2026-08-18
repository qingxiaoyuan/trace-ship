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

    表示一次软件版本发布申请的全生命周期，支持草稿、待审批、已发布、已驳回等状态。

    Attributes:
        id: UUID 主键
        project: 所属项目
        repository: 目标仓库（第三阶段新增，明确推 tag 的对象）
        version: 版本号
        tag_name: 要推送的 tag 名称
        branch: 发布分支（main / test-xxx）
        git_hash: 分支当前 commit hash
        release_type: 发布类型（formal 正式 / rc 候选 / beta 测试）
        status: 发布状态
        release_doc: 发布说明文档（Markdown 格式字符串，2 列表格）
        related_changes: 关联变更清单（硬件/软件版本条目列表）
        updates: 变更条目（A/F 类），元素结构 {type, content, source, source_ref}
        has_config_changes: 是否有配置项改动
        config_change_doc: 配置项变更文档（多行文本）
        impact_other: 是否影响其他功能
        impact_desc: 影响范围说明
        self_test_passed: 自测试通过
        retest_passed: 研发测试复验通过
        publisher: 发布人
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
    # 发布时的基线 tag：生成发布说明时持久化的上一个 tag 快照，
    # 供详情页展示「上一 tag -> 本次 tag」提交区间，历史数据为空。
    base_tag = models.CharField(max_length=100, blank=True, verbose_name="基线 Tag")
    branch = models.CharField(max_length=200, verbose_name="发布分支")
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
    # 发布说明文档：Markdown 格式字符串（2 列表格），可手动编辑
    release_doc = models.TextField(blank=True, verbose_name="发布说明文档")
    # 关联变更清单：硬件/软件版本条目列表，由发布向导收集
    related_changes = models.JSONField(default=list, blank=True, verbose_name="关联变更清单")
    # 变更条目：A 类 / F 类变更内容，元素结构 {type, content, source, source_ref}
    updates = models.JSONField(default=list, blank=True, verbose_name="变更条目")
    # 是否有配置项改动
    has_config_changes = models.BooleanField(default=False, verbose_name="是否有配置项改动")
    # 配置项变更文档（多行文本，用户填写）
    config_change_doc = models.TextField(blank=True, verbose_name="配置项变更文档")
    # 是否影响其他功能
    impact_other = models.BooleanField(default=False, verbose_name="是否影响其他功能")
    # 影响范围说明
    impact_desc = models.TextField(blank=True, verbose_name="影响范围说明")
    # 自测试通过
    self_test_passed = models.BooleanField(default=False, verbose_name="自测试通过")
    # 研发测试复验通过
    retest_passed = models.BooleanField(default=False, verbose_name="研发测试复验通过")
    # 发布后自动打包配置：创建发布时用户勾选的打包配置 id 列表。
    # None 表示未显式选择（历史数据，发布通过后触发该仓库全部自动打包配置）；
    # [] 表示本次发布不自动打包；[id,...] 表示仅触发这些配置（快照固定）。
    package_config_ids = models.JSONField(
        default=None,
        blank=True,
        null=True,
        verbose_name="发布后自动打包配置",
    )
    publisher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="releases",
        verbose_name="发布人",
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


class ReleaseMergeRequest(models.Model):
    """
    发布关联 MR 模型

    记录一次发布包含哪些 Merge Request / Pull Request，供发布说明引用。

    Attributes:
        id: UUID 主键
        release: 关联发布记录
        mr_number: MR 编号（如 !42、#56）
        title: MR 标题
        description: MR 描述正文（用于解析更新内容）
        author: MR 作者
        source_branch: 源分支
        target_branch: 目标分支
        web_url: MR 页面链接
        merged_at: 合并时间
        created_at: 创建时间
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    release = models.ForeignKey(
        ReleaseRecord,
        on_delete=models.CASCADE,
        related_name="release_mrs",
        verbose_name="发布记录",
    )
    mr_number = models.CharField(max_length=50, verbose_name="MR 编号")
    title = models.CharField(max_length=500, verbose_name="MR 标题")
    description = models.TextField(blank=True, verbose_name="MR 描述")
    author = models.CharField(max_length=200, blank=True, verbose_name="MR 作者")
    source_branch = models.CharField(max_length=200, blank=True, verbose_name="源分支")
    target_branch = models.CharField(max_length=200, blank=True, verbose_name="目标分支")
    web_url = models.URLField(blank=True, verbose_name="MR 链接")
    merged_at = models.DateTimeField(null=True, blank=True, verbose_name="合并时间")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")

    class Meta:
        db_table = "release_mr"
        verbose_name = "发布关联 MR"
        verbose_name_plural = "发布关联 MR"
        unique_together = ["release", "mr_number"]
        ordering = ["-merged_at", "-created_at"]

    def __str__(self) -> str:
        """返回 MR 编号与标题"""
        return f"{self.release.version} - {self.mr_number} {self.title}"


class ReleaseReviewIssue(models.Model):
    """
    发布文档整改意见模型

    审查员（拥有 release.audit 权限）对已发布版本的发布文档提出整改意见，
    发布人逐条回复，审查员逐条判定（通过/驳回）。全部通过即整改完成。

    Attributes:
        id: UUID 主键
        release: 关联发布记录
        author: 意见发起人（审查员）
        content: 意见正文
        status: 状态（open 待整改 / replied 待复核 / resolved 已通过）
        resolved_by: 判定通过的审查员
        resolved_at: 通过时间
        created_at: 创建时间
        updated_at: 更新时间
    """

    STATUS_CHOICES = [
        ("open", "待整改"),
        ("replied", "待复核"),
        ("resolved", "已通过"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    release = models.ForeignKey(
        ReleaseRecord,
        on_delete=models.CASCADE,
        related_name="review_issues",
        verbose_name="发布记录",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="review_issues",
        verbose_name="意见发起人",
    )
    content = models.TextField(verbose_name="意见正文")
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="open",
        verbose_name="状态",
    )
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="resolved_review_issues",
        verbose_name="判定人",
    )
    resolved_at = models.DateTimeField(null=True, blank=True, verbose_name="通过时间")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "release_review_issue"
        verbose_name = "发布文档整改意见"
        verbose_name_plural = "发布文档整改意见"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["release", "status"]),
        ]

    def __str__(self) -> str:
        """返回意见摘要"""
        return f"{self.release.version} - {self.content[:30]}"


class ReleaseReviewReply(models.Model):
    """
    整改意见回复模型

    记录发布人对意见的回复，以及审查员驳回时的备注说明，
    形成可追溯的对话时间线。

    Attributes:
        id: UUID 主键
        issue: 关联整改意见
        author: 回复人（发布人或审查员）
        content: 回复内容
        created_at: 创建时间
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    issue = models.ForeignKey(
        ReleaseReviewIssue,
        on_delete=models.CASCADE,
        related_name="replies",
        verbose_name="整改意见",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="release_review_replies",
        verbose_name="回复人",
    )
    content = models.TextField(verbose_name="回复内容")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")

    class Meta:
        db_table = "release_review_reply"
        verbose_name = "整改意见回复"
        verbose_name_plural = "整改意见回复"
        ordering = ["created_at"]

    def __str__(self) -> str:
        """返回回复摘要"""
        return f"{self.issue_id} - {self.content[:30]}"
