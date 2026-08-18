"""
通知数据模型

提供站内消息通知能力，支持审批通知、构建结果通知、系统通知。
"""
import uuid

from django.conf import settings
from django.db import models


class Notification(models.Model):
    """
    通知记录模型

    Attributes:
        id: UUID 主键
        user: 接收人
        notification_type: 通知类型
        title: 标题
        content: 内容
        is_read: 是否已读
        read_at: 阅读时间
        related_type: 关联类型
        related_id: 关联 ID
        created_at: 创建时间
    """

    TYPE_CHOICES = [
        ("audit", "审批通知"),
        ("build", "构建结果"),
        ("release", "发布结果"),
        ("review", "审查整改"),
        ("system", "系统通知"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
        verbose_name="接收人",
    )
    notification_type = models.CharField(
        max_length=20,
        choices=TYPE_CHOICES,
        verbose_name="通知类型",
    )
    title = models.CharField(max_length=200, verbose_name="标题")
    content = models.TextField(verbose_name="内容")
    is_read = models.BooleanField(default=False, verbose_name="是否已读")
    read_at = models.DateTimeField(null=True, blank=True, verbose_name="阅读时间")
    related_type = models.CharField(max_length=50, blank=True, verbose_name="关联类型")
    related_id = models.CharField(max_length=200, blank=True, verbose_name="关联ID")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")

    class Meta:
        db_table = "notification"
        verbose_name = "通知"
        verbose_name_plural = "通知"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "is_read"]),
            models.Index(fields=["notification_type", "created_at"]),
        ]

    def __str__(self) -> str:
        """返回通知标题"""
        return self.title
