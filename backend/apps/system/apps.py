"""
系统管理 AppConfig

注意：类名 SystemConfig 与 models.SystemConfig 同名，但 Django 通过 apps.system.apps.SystemConfig
的 dotted path 识别，不影响功能；建议后续重命名避免混淆。
"""
from django.apps import AppConfig


class SystemConfig(AppConfig):
    """
    Django 系统管理应用配置
    """
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.system"
    verbose_name = "系统管理"
