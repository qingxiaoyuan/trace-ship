"""
系统内置打包数据模型

包含系统级打包镜像、项目级打包配置和打包任务记录。
"""
import uuid

from django.conf import settings
from django.db import models


class PackageImage(models.Model):
    """系统级 Docker 打包镜像配置。"""

    BUILD_TYPE_CHOICES = [
        ("web", "Web"),
        ("qt", "Qt"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, verbose_name="镜像名称")
    build_type = models.CharField(max_length=20, choices=BUILD_TYPE_CHOICES, verbose_name="打包类型")
    image = models.CharField(max_length=500, verbose_name="Docker 镜像")
    script_entry = models.CharField(
        max_length=500,
        default="/usr/local/bin/trace-ship-build",
        verbose_name="镜像脚本入口",
    )
    default_build_path = models.CharField(max_length=300, default=".", verbose_name="默认构建目录")
    default_output_path = models.CharField(max_length=300, default="dist", verbose_name="默认产物目录")
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "package_image"
        verbose_name = "打包镜像"
        verbose_name_plural = "打包镜像"
        ordering = ["build_type", "-created_at"]
        indexes = [
            models.Index(fields=["build_type", "is_active"], name="package_ima_build_t_0ac7d6_idx"),
        ]

    def __str__(self) -> str:
        return self.name


class PackageConfig(models.Model):
    """项目级打包配置。"""

    MODE_CHOICES = [
        ("simple", "简易打包"),
        ("local", "本地脚本"),
    ]
    BUILD_TYPE_CHOICES = PackageImage.BUILD_TYPE_CHOICES

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "project.Project",
        on_delete=models.CASCADE,
        related_name="package_configs",
        verbose_name="项目",
    )
    repository = models.ForeignKey(
        "repository.Repository",
        on_delete=models.CASCADE,
        related_name="package_configs",
        verbose_name="关联仓库",
    )
    name = models.CharField(max_length=200, verbose_name="配置名称")
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default="simple", verbose_name="打包模式")
    build_type = models.CharField(max_length=20, choices=BUILD_TYPE_CHOICES, default="web", verbose_name="打包类型")
    image = models.ForeignKey(
        PackageImage,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="package_configs",
        verbose_name="打包镜像",
    )
    local_script = models.TextField(blank=True, verbose_name="本地打包脚本")
    build_path = models.CharField(max_length=300, default=".", blank=True, verbose_name="构建目录")
    output_path = models.CharField(max_length=300, default="dist", blank=True, verbose_name="产物目录")
    env_vars = models.JSONField(default=dict, blank=True, verbose_name="环境变量")
    auto_package_on_release = models.BooleanField(default=False, verbose_name="发布后自动打包")
    svn_push_enabled = models.BooleanField(default=False, verbose_name="启用 SVN 推送")
    svn_url = models.CharField(max_length=500, blank=True, verbose_name="SVN 仓库地址")
    svn_credential = models.ForeignKey(
        "credential.Credential",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="package_configs_svn",
        verbose_name="SVN 凭证",
    )
    svn_path_template = models.CharField(
        max_length=300, default="{version}", blank=True, verbose_name="SVN 目录模板"
    )
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "package_config"
        verbose_name = "打包配置"
        verbose_name_plural = "打包配置"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "mode", "is_active"], name="package_con_project_7598ec_idx"),
            models.Index(fields=["repository", "auto_package_on_release"], name="package_con_reposit_137631_idx"),
        ]

    def __str__(self) -> str:
        return self.name


class PackageTask(models.Model):
    """系统内置打包任务记录。"""

    STATUS_CHOICES = [
        ("queued", "排队中"),
        ("running", "打包中"),
        ("success", "成功"),
        ("failure", "失败"),
        ("canceled", "已取消"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    config = models.ForeignKey(
        PackageConfig,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tasks",
        verbose_name="打包配置",
    )
    release = models.ForeignKey(
        "release.ReleaseRecord",
        on_delete=models.CASCADE,
        related_name="package_tasks",
        verbose_name="关联发布",
    )
    project = models.ForeignKey(
        "project.Project",
        on_delete=models.CASCADE,
        related_name="package_tasks",
        verbose_name="项目",
    )
    repository = models.ForeignKey(
        "repository.Repository",
        on_delete=models.CASCADE,
        related_name="package_tasks",
        verbose_name="仓库",
    )
    triggered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_package_tasks",
        verbose_name="触发人",
    )
    name = models.CharField(max_length=200, verbose_name="任务名称")
    mode = models.CharField(max_length=20, choices=PackageConfig.MODE_CHOICES, verbose_name="打包模式")
    build_type = models.CharField(max_length=20, choices=PackageImage.BUILD_TYPE_CHOICES, verbose_name="打包类型")
    tag_name = models.CharField(max_length=100, verbose_name="Tag 名称")
    version = models.CharField(max_length=100, verbose_name="版本号")
    commit_hash = models.CharField(max_length=100, blank=True, verbose_name="提交哈希")
    config_snapshot = models.JSONField(default=dict, blank=True, verbose_name="配置快照")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="queued", verbose_name="状态")
    progress = models.IntegerField(default=0, verbose_name="进度百分比")
    stage_info = models.JSONField(default=dict, blank=True, verbose_name="阶段信息")
    workspace_path = models.CharField(max_length=1000, blank=True, verbose_name="工作区路径")
    log_path = models.CharField(max_length=1000, blank=True, verbose_name="日志路径")
    artifact_info = models.JSONField(default=list, blank=True, verbose_name="产物信息")
    duration = models.IntegerField(default=0, verbose_name="耗时毫秒")
    error_message = models.TextField(blank=True, verbose_name="失败原因")
    started_at = models.DateTimeField(null=True, blank=True, verbose_name="开始时间")
    finished_at = models.DateTimeField(null=True, blank=True, verbose_name="结束时间")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "package_task"
        verbose_name = "打包任务"
        verbose_name_plural = "打包任务"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["project", "status"], name="package_tas_project_f7e7b5_idx"),
            models.Index(fields=["release", "status"], name="package_tas_release_7f5c5e_idx"),
            models.Index(fields=["repository", "created_at"], name="package_tas_reposit_4fc379_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.name} - {self.version}"

    @property
    def is_finished(self) -> bool:
        """任务是否已结束。"""
        return self.status in ("success", "failure", "canceled")
