from django.db import migrations


def remove_project_manager_role(apps, schema_editor):
    """移除系统级项目管理员角色"""
    Role = apps.get_model("account", "Role")
    Role.objects.filter(code="project_manager").delete()


def restore_project_manager_role(apps, schema_editor):
    """回滚时重建角色壳（权限需重新配置）"""
    Role = apps.get_model("account", "Role")
    Role.objects.get_or_create(
        code="project_manager",
        defaults={"name": "项目管理员"},
    )


class Migration(migrations.Migration):
    dependencies = [
        ("account", "0001_initial"),
    ]
    operations = [
        migrations.RunPython(
            remove_project_manager_role,
            restore_project_manager_role,
        ),
    ]
