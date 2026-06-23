from django.apps import AppConfig


class RepositoryConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.repository"
    verbose_name = "仓库管理"
