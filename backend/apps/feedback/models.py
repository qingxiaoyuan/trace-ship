"""
使用反馈数据模型

收集用户对平台的功能建议、问题反馈与体验优化意见，支持全员查看与点赞。
"""
import uuid

from django.conf import settings
from django.db import models


class Feedback(models.Model):
    """
    使用反馈模型

    Attributes:
        id: UUID 主键
        title: 反馈标题
        content: 反馈内容
        category: 反馈分类
        created_by: 提交人
        likes: 点赞用户集合
        status: 处理状态
        processed_by: 处理人
        processed_at: 处理时间
        created_at: 创建时间
        updated_at: 更新时间
    """

    CATEGORY_CHOICES = [
        ("suggestion", "功能建议"),
        ("bug", "问题反馈"),
        ("experience", "体验优化"),
        ("other", "其他"),
    ]

    STATUS_CHOICES = [
        ("open", "待处理"),
        ("processed", "已处理"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200, verbose_name="标题")
    content = models.TextField(verbose_name="内容")
    category = models.CharField(
        max_length=20,
        choices=CATEGORY_CHOICES,
        default="suggestion",
        verbose_name="分类",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="feedbacks",
        verbose_name="提交人",
    )
    likes = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name="liked_feedbacks",
        blank=True,
        verbose_name="点赞用户",
    )
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="open",
        verbose_name="处理状态",
    )
    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="processed_feedbacks",
        null=True,
        blank=True,
        verbose_name="处理人",
    )
    processed_at = models.DateTimeField(null=True, blank=True, verbose_name="处理时间")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "feedback"
        verbose_name = "使用反馈"
        verbose_name_plural = "使用反馈"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["category", "created_at"]),
        ]

    def __str__(self) -> str:
        """返回反馈标题"""
        return self.title
