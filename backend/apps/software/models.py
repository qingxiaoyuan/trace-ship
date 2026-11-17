"""软件及其共享身份。"""

import uuid

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models

software_slug = RegexValidator(
    r"\A[a-z0-9]+(?:-[a-z0-9]+)*\Z",
    "标识仅支持小写英文字母、数字和分隔用的短横线。",
)


class Software(models.Model):
    """主仓库内的独立软件身份。"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    repository = models.ForeignKey(
        "repository.Repository",
        on_delete=models.PROTECT,
        related_name="software",
        verbose_name="主仓库",
    )
    slug = models.CharField(max_length=80, validators=[software_slug], verbose_name="软件标识")
    name = models.CharField(max_length=200, verbose_name="显示名称")
    description = models.TextField(blank=True, default="", verbose_name="说明")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_software",
        verbose_name="维护负责人",
    )
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="登记时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "software"
        verbose_name = "软件"
        ordering = ["name", "slug", "id"]
        constraints = [
            models.UniqueConstraint(fields=["repository", "slug"], name="uniq_software_repository_slug"),
        ]

    def __str__(self) -> str:
        return self.name


class SoftwareMaintainer(models.Model):
    """负责人显式授予的软件共享维护权限。"""

    software = models.ForeignKey(
        Software,
        on_delete=models.CASCADE,
        related_name="maintainer_grants",
        verbose_name="软件",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        verbose_name="协作维护者",
    )
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        verbose_name="授权人",
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="授权时间")

    class Meta:
        db_table = "software_maintainer"
        verbose_name = "软件维护授权"
        constraints = [
            models.UniqueConstraint(fields=["software", "user"], name="uniq_software_maintainer"),
        ]


class ProjectSoftware(models.Model):
    """一个项目对共享软件的显式选用，停用时保留关系。"""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "project.Project",
        on_delete=models.PROTECT,
        related_name="project_software",
        verbose_name="项目",
    )
    software = models.ForeignKey(
        Software,
        on_delete=models.PROTECT,
        related_name="project_links",
        verbose_name="软件",
    )
    is_active = models.BooleanField(default=True, verbose_name="是否选用")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="选用时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "project_software"
        verbose_name = "项目软件关联"
        constraints = [
            models.UniqueConstraint(fields=["project", "software"], name="uniq_project_software"),
        ]
