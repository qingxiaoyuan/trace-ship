import uuid
import json
from django.db import models
from django.conf import settings


class SystemConfig(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=200, unique=True, verbose_name="配置键")
    value = models.TextField(verbose_name="配置值")
    description = models.TextField(blank=True, verbose_name="说明")
    is_public = models.BooleanField(default=False, verbose_name="是否公开")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_config"
        verbose_name = "系统参数"

    def __str__(self):
        return self.key


class OperationLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="operation_logs",
        verbose_name="用户",
    )
    module = models.CharField(max_length=100, verbose_name="模块")
    action = models.CharField(max_length=100, verbose_name="动作")
    resource_type = models.CharField(max_length=100, verbose_name="资源类型")
    resource_id = models.CharField(max_length=200, blank=True, verbose_name="资源ID")
    detail = models.JSONField(default=dict, verbose_name="详情")
    ip = models.CharField(max_length=100, blank=True, verbose_name="IP地址")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="操作时间")

    class Meta:
        db_table = "sys_operation_log"
        verbose_name = "操作日志"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user} - {self.module}.{self.action}"
