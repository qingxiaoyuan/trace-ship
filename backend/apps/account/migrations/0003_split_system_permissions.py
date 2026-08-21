"""
数据迁移：将单一的 system.manage 权限拆分为五项细分权限

新增 system.user / system.role / system.config / system.package_image / system.log，
原拥有 system.manage 的角色自动继承全部五项权限，随后移除旧的 system.manage。
"""
from django.db import migrations

NEW_PERMISSIONS = [
    {"name": "用户管理", "code": "system.user", "module": "system"},
    {"name": "角色管理", "code": "system.role", "module": "system"},
    {"name": "系统配置", "code": "system.config", "module": "system"},
    {"name": "打包镜像", "code": "system.package_image", "module": "system"},
    {"name": "操作日志", "code": "system.log", "module": "system"},
]

NEW_CODES = [item["code"] for item in NEW_PERMISSIONS]


def split_system_permissions(apps, schema_editor):
    """将 system.manage 替换为五项细分权限"""
    Permission = apps.get_model("account", "Permission")
    RolePermission = apps.get_model("account", "RolePermission")

    new_perms = {}
    for item in NEW_PERMISSIONS:
        perm, _ = Permission.objects.get_or_create(
            code=item["code"],
            defaults={"name": item["name"], "module": item["module"]},
        )
        new_perms[item["code"]] = perm

    old_perm = Permission.objects.filter(code="system.manage").first()
    if old_perm:
        # 原拥有 system.manage 的角色继承全部五项新权限
        role_ids = set(old_perm.role_permissions.values_list("role_id", flat=True))
        for role_id in role_ids:
            for perm in new_perms.values():
                RolePermission.objects.get_or_create(role_id=role_id, permission=perm)
        # 删除旧权限的全部角色绑定，再删除权限本身
        RolePermission.objects.filter(permission=old_perm).delete()
        old_perm.delete()


def restore_system_permission(apps, schema_editor):
    """回滚：恢复 system.manage 并移除五项细分权限"""
    Permission = apps.get_model("account", "Permission")
    RolePermission = apps.get_model("account", "RolePermission")

    old_perm, _ = Permission.objects.get_or_create(
        code="system.manage",
        defaults={"name": "系统管理", "module": "system"},
    )
    # 拥有任一细分权限的角色恢复 system.manage
    role_ids = set()
    for code in NEW_CODES:
        perm = Permission.objects.filter(code=code).first()
        if perm:
            role_ids.update(perm.role_permissions.values_list("role_id", flat=True))
    for role_id in role_ids:
        RolePermission.objects.get_or_create(role_id=role_id, permission=old_perm)
    # 删除五项细分权限
    for code in NEW_CODES:
        Permission.objects.filter(code=code).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("account", "0002_delete_project_manager_role"),
    ]
    operations = [
        migrations.RunPython(split_system_permissions, restore_system_permission),
    ]
