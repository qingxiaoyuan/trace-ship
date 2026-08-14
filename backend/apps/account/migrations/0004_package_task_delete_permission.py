"""补齐删除打包任务记录的独立权限。"""

from django.db import migrations


def create_package_task_delete_permission(apps, schema_editor):
    """为已有部署补齐权限，角色可在系统页面中按需分配。"""
    Permission = apps.get_model("account", "Permission")
    Permission.objects.get_or_create(
        code="package.task.delete",
        defaults={
            "name": "删除打包任务记录",
            "module": "package",
        },
    )


class Migration(migrations.Migration):

    dependencies = [
        ("account", "0003_split_system_permissions"),
    ]

    operations = [
        migrations.RunPython(create_package_task_delete_permission, migrations.RunPython.noop),
    ]
