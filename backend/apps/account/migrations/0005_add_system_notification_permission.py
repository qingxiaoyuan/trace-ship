"""
数据迁移：新增 system.notification 权限（通知发送）

默认绑定到 super_admin 角色；其他角色可在「角色管理」页面按需授予。
"""
from django.db import migrations


def add_notification_permission(apps, schema_editor):
    """新增 system.notification 权限并绑定到超级管理员角色"""
    Permission = apps.get_model("account", "Permission")
    Role = apps.get_model("account", "Role")
    RolePermission = apps.get_model("account", "RolePermission")

    perm, _ = Permission.objects.get_or_create(
        code="system.notification",
        defaults={"name": "通知发送", "module": "system"},
    )
    role = Role.objects.filter(code="super_admin").first()
    if role:
        RolePermission.objects.get_or_create(role=role, permission=perm)


def remove_notification_permission(apps, schema_editor):
    """回滚：删除 system.notification 权限（角色绑定随外键级联删除）"""
    Permission = apps.get_model("account", "Permission")
    Permission.objects.filter(code="system.notification").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("account", "0004_package_task_delete_permission"),
    ]
    operations = [
        migrations.RunPython(add_notification_permission, remove_notification_permission),
    ]
