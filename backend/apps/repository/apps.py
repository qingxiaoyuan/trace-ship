"""
仓库管理 AppConfig
"""
from django.apps import AppConfig


class RepositoryConfig(AppConfig):
    """
    Django 仓库管理应用配置
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.repository"
    verbose_name = "仓库管理"
