from django.core.management.base import BaseCommand
from apps.account.models import User, Role, Permission, UserRole, RolePermission


class Command(BaseCommand):
    help = "初始化基础数据：超管账号、基础角色和权限"

    def handle(self, *args, **options):
        self.stdout.write("开始初始化基础数据...")

        # 创建基础权限
        permissions_data = [
            {"name": "查看项目", "code": "project.view", "module": "project"},
            {"name": "创建项目", "code": "project.create", "module": "project"},
            {"name": "编辑项目", "code": "project.edit", "module": "project"},
            {"name": "删除项目", "code": "project.delete", "module": "project"},
            {"name": "管理项目成员", "code": "project.member", "module": "project"},
            {"name": "查看凭证", "code": "credential.view", "module": "credential"},
            {"name": "管理凭证", "code": "credential.manage", "module": "credential"},
            {"name": "查看发布", "code": "release.view", "module": "release"},
            {"name": "创建发布", "code": "release.create", "module": "release"},
            {"name": "审批发布", "code": "release.audit", "module": "release"},
            {"name": "系统管理", "code": "system.manage", "module": "system"},
        ]
        permission_map = {}
        for item in permissions_data:
            perm, _ = Permission.objects.get_or_create(
                code=item["code"],
                defaults={"name": item["name"], "module": item["module"]},
            )
            permission_map[item["code"]] = perm

        # 创建基础角色
        roles_data = [
            {"name": "超级管理员", "code": "super_admin", "perms": list(permission_map.keys())},
            {"name": "项目管理员", "code": "project_manager", "perms": [
                "project.view", "project.create", "project.edit", "project.member",
                "credential.view", "credential.manage", "release.view", "release.create",
            ]},
            {"name": "开发人员", "code": "developer", "perms": [
                "project.view", "credential.view", "release.view", "release.create",
            ]},
            {"name": "测试人员", "code": "tester", "perms": [
                "project.view", "release.view",
            ]},
            {"name": "审核人", "code": "auditor", "perms": [
                "project.view", "release.view", "release.audit",
            ]},
            {"name": "只读人员", "code": "viewer", "perms": [
                "project.view",
            ]},
        ]
        role_map = {}
        for item in roles_data:
            role, _ = Role.objects.get_or_create(
                code=item["code"],
                defaults={"name": item["name"]},
            )
            role_map[item["code"]] = role
            # 绑定权限
            RolePermission.objects.filter(role=role).delete()
            for perm_code in item["perms"]:
                if perm_code in permission_map:
                    RolePermission.objects.get_or_create(role=role, permission=permission_map[perm_code])

        # 创建本地超管账号
        admin, created = User.objects.get_or_create(
            username="admin",
            defaults={
                "nickname": "系统管理员",
                "source": "local",
                "is_superuser": True,
                "is_staff": True,
                "is_active": True,
            },
        )
        if created:
            admin.set_password("admin@123")
            admin.save()
            self.stdout.write(self.style.SUCCESS("创建超管账号：admin / admin@123"))
        else:
            self.stdout.write("超管账号已存在")

        # 为超管绑定 super_admin 角色
        UserRole.objects.get_or_create(
            user=admin,
            role=role_map["super_admin"],
        )

        self.stdout.write(self.style.SUCCESS("基础数据初始化完成"))
