"""
系统内置打包数据模型

包含系统级打包镜像、项目级打包配置和打包任务记录。
"""
import uuid

from django.conf import settings
from django.db import models


class PackageImage(models.Model):
    """打包镜像配置（来源：本地 Docker / Nexus）。"""

    SOURCE_CHOICES = [
        ("nexus", "Nexus"),
        ("local", "本地"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, verbose_name="镜像名称")
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default="nexus", verbose_name="镜像来源")
    registry_host = models.CharField(max_length=300, blank=True, verbose_name="镜像拉取地址")
    repository = models.CharField(max_length=300, blank=True, verbose_name="Nexus 仓库名")
    image_name = models.CharField(max_length=300, blank=True, verbose_name="镜像名")
    image_tag = models.CharField(max_length=300, blank=True, verbose_name="镜像标签")
    image = models.CharField(max_length=500, verbose_name="Docker 镜像")
    script_entry = models.CharField(
        max_length=500,
        default="/workspace/scripts/pack.sh",
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
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["source", "registry_host", "repository", "image_name", "image_tag"],
                name="package_image_unique_source_coord",
            ),
        ]
        indexes = [
            models.Index(fields=["source", "is_active"], name="package_ima_source_2f3b1e_idx"),
        ]

    def __str__(self) -> str:
        return self.name

    def save(self, *args, **kwargs):
        """根据 source/registry/repository/name/tag 拼出完整镜像地址。"""
        if self.image_name and self.image_tag:
            if self.source == "nexus":
                host = self.registry_host or self._default_registry_host()
                if self.repository:
                    self.image = f"{host}/{self.repository}/{self.image_name}:{self.image_tag}"
                else:
                    self.image = f"{host}/{self.image_name}:{self.image_tag}"
                if not self.registry_host:
                    self.registry_host = host
            else:
                # 本地镜像：不带 registry 前缀，直接使用 name:tag
                self.image = f"{self.image_name}:{self.image_tag}"
                self.registry_host = ""
                self.repository = ""
        super().save(*args, **kwargs)

    @staticmethod
    def _default_registry_host() -> str:
        """默认拉取地址：与 NexusService 同一配置来源（系统配置页面优先）。"""
        from apps.package.nexus import NexusError, NexusService

        try:
            return NexusService.registry_host()
        except NexusError:
            return ""


class PackageNode(models.Model):
    """远程打包节点（当前支持 Windows，通过 SSH/SFTP 接入）。"""

    OS_TYPE_CHOICES = [
        ("windows", "Windows"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, verbose_name="节点名称")
    host = models.CharField(max_length=300, verbose_name="主机地址")
    port = models.IntegerField(default=22, verbose_name="SSH 端口")
    os_type = models.CharField(
        max_length=20, choices=OS_TYPE_CHOICES, default="windows", verbose_name="操作系统"
    )
    credential = models.ForeignKey(
        "credential.Credential",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="package_nodes",
        verbose_name="登录凭证",
    )
    work_root = models.CharField(
        max_length=500,
        default=r"C:\trace-ship\workspaces",
        verbose_name="远程工作根目录",
    )
    max_concurrency = models.IntegerField(default=1, verbose_name="最大并发打包数")
    description = models.CharField(max_length=500, blank=True, verbose_name="备注")
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_package_nodes",
        verbose_name="创建人",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "package_node"
        verbose_name = "打包节点"
        verbose_name_plural = "打包节点"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name} ({self.host})"


class PackageConfig(models.Model):
    """项目级打包配置。"""

    EXECUTOR_CHOICES = [
        ("local_docker", "本地 Docker"),
        ("remote_windows", "远程 Windows"),
    ]

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
    executor_type = models.CharField(
        max_length=20,
        choices=EXECUTOR_CHOICES,
        default="local_docker",
        verbose_name="执行方式",
    )
    node = models.ForeignKey(
        PackageNode,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="package_configs",
        verbose_name="远程打包节点",
    )
    image = models.ForeignKey(
        PackageImage,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="package_configs",
        verbose_name="打包镜像",
    )
    custom_script = models.TextField(blank=True, verbose_name="自定义打包脚本")
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
            models.Index(fields=["project", "is_active"], name="package_con_project_7598ec_idx"),
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
    # 历史保留字段：早期按 web/qt 区分打包类型，现已取消分类，新任务写入空串
    build_type = models.CharField(max_length=20, blank=True, default="", verbose_name="打包类型")
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
