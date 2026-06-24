"""
项目管理 AppConfig
"""
from django.apps import AppConfig


class ProjectConfig(AppConfig):
    """
    Django 项目管理应用配置
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.project"
    verbose_name = "项目管理"
