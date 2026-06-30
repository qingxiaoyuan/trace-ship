"""
Jenkins 集成数据模型

包含 Jenkins 任务配置（JenkinsJob）和构建记录（JenkinsBuild）。
"""
import uuid
from typing import Optional

from django.conf import settings
from django.db import models


class JenkinsJob(models.Model):
    """
    Jenkins 任务配置模型

    直接归属项目，并可关联到具体仓库用于发布流程匹配；
    包含服务器地址、Job 名、凭证与参数模板。

    Attributes:
        id: UUID 主键
        project: 所属项目
        repository: 关联仓库（可选，用于匹配发布流程）
        name: 任务名称
        server_url: Jenkins 服务器地址
        job_name: Jenkins Job 名
        credential: 关联凭证
        credential_mode: 凭证来源（个人 / 项目）
        params_template: 参数模板（JSON）
        is_active: 是否启用
        created_at: 创建时间
        updated_at: 更新时间
    """

    CREDENTIAL_MODE_CHOICES = [
        ("personal", "个人"),
        ("project", "项目"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "project.Project",
        on_delete=models.CASCADE,
        related_name="jenkins_jobs",
        verbose_name="项目",
    )
    repository = models.ForeignKey(
        "repository.Repository",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="jenkins_jobs",
        verbose_name="关联仓库",
    )
    name = models.CharField(max_length=200, verbose_name="任务名称")
    server_url = models.CharField(max_length=500, verbose_name="Jenkins 地址")
    job_name = models.CharField(max_length=200, verbose_name="Jenkins Job 名")
    credential = models.ForeignKey(
        "credential.Credential",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="jenkins_jobs",
        verbose_name="关联凭证",
    )
    credential_mode = models.CharField(
        max_length=20,
        choices=CREDENTIAL_MODE_CHOICES,
        default="project",
        verbose_name="凭证来源",
    )
    params_template = models.JSONField(default=dict, blank=True, verbose_name="参数模板")
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "jenkins_job"
        verbose_name = "Jenkins 任务"
        verbose_name_plural = "Jenkins 任务"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        """返回任务名称"""
        return self.name

    @property
    def vendor(self) -> str:
        """凭证解析器需要的 vendor 标识"""
        return "jenkins"


class JenkinsBuild(models.Model):
    """
    Jenkins 构建记录模型

    记录每次构建的排队号、构建号、状态、参数、日志、产物等信息。

    Attributes:
        id: UUID 主键
        job: 关联 Jenkins 任务
        triggered_by: 触发人
        queue_id: Jenkins 队列号
        build_number: Jenkins 构建号
        status: 构建状态
        params: 实际传入参数
        log_url: 日志地址
        artifact_info: 产物信息（JSON 列表）
        duration: 构建耗时（毫秒）
        estimated_duration: 预估耗时（毫秒）
        started_at: 开始时间
        finished_at: 结束时间
        created_at: 创建时间
        updated_at: 更新时间
    """

    STATUS_CHOICES = [
        ("queue", "排队中"),
        ("running", "构建中"),
        ("success", "成功"),
        ("failure", "失败"),
        ("aborted", "中止"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(
        JenkinsJob,
        on_delete=models.CASCADE,
        related_name="builds",
        verbose_name="Jenkins 任务",
    )
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_jenkins_builds",
        verbose_name="触发人",
    )
    queue_id = models.CharField(max_length=100, blank=True, verbose_name="队列号")
    build_number = models.IntegerField(null=True, blank=True, verbose_name="构建号")
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="queue",
        verbose_name="状态",
    )
    params = models.JSONField(default=dict, blank=True, verbose_name="构建参数")
    log_url = models.CharField(max_length=500, blank=True, verbose_name="日志地址")
    artifact_info = models.JSONField(default=list, blank=True, verbose_name="产物信息")
    duration = models.IntegerField(null=True, blank=True, verbose_name="构建耗时(ms)")
    estimated_duration = models.IntegerField(null=True, blank=True, verbose_name="预估耗时(ms)")
    started_at = models.DateTimeField(null=True, blank=True, verbose_name="开始时间")
    finished_at = models.DateTimeField(null=True, blank=True, verbose_name="结束时间")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "jenkins_build"
        verbose_name = "Jenkins 构建记录"
        verbose_name_plural = "Jenkins 构建记录"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        """返回构建号描述"""
        return f"{self.job.name} - #{self.build_number or self.queue_id}"

    @property
    def is_finished(self) -> bool:
        """构建是否已结束"""
        return self.status in ("success", "failure", "aborted")

    @property
    def project(self):
        """所属项目，便于项目成员权限校验"""
        return self.job.project
