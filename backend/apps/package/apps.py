from django.apps import AppConfig


class PackageConfig(AppConfig):
    """系统内置打包应用配置。"""

    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.package"
    verbose_name = "打包管理"

