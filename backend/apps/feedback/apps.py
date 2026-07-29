"""
使用反馈应用配置
"""
from django.apps import AppConfig


class FeedbackConfig(AppConfig):
    """
    Feedback 应用配置类

    Attributes:
        default_auto_field: 默认主键类型
        name: 应用完整 Python 路径
        verbose_name: 后台显示名称
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.feedback"
    verbose_name = "使用反馈"
