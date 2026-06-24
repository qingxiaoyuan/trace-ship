"""
账号管理 AppConfig
"""
from django.apps import AppConfig


class AccountConfig(AppConfig):
    """
    Django 账号管理应用配置

    Attributes:
        default_auto_field: 未显式指定主键的模型默认使用 BigAutoField
        name: 应用 Python 路径
        verbose_name: 后台管理中显示的中文名称
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.account"
    verbose_name = "账号管理"
