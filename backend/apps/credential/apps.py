"""
凭证管理 AppConfig
"""
from django.apps import AppConfig


class CredentialConfig(AppConfig):
    """
    Django 凭证管理应用配置

    Attributes:
        default_auto_field: 默认主键类型
        name: 应用 Python 路径
        verbose_name: 后台显示名称
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.credential"
    verbose_name = "凭证管理"
