"""
重置 admin 密码

用于生产/本地部署后 admin 无法登录时的紧急恢复，或按需求强制恢复默认密码。
"""
from django.core.management.base import BaseCommand

from apps.account.models import User


class Command(BaseCommand):
    """
    Django 管理命令：重置 admin 账号密码
    """

    help = "重置 admin 账号密码（默认恢复为 admin@123）"

    def add_arguments(self, parser):
        parser.add_argument(
            "--username",
            default="admin",
            help="要重置的用户名（默认 admin）",
        )
        parser.add_argument(
            "--password",
            default="admin@123",
            help="新密码（默认 admin@123）",
        )

    def handle(self, *args, **options):
        username = options["username"]
        password = options["password"]
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            self.stdout.write(self.style.ERROR(f"用户 {username} 不存在"))
            return

        user.set_password(password)
        user.is_active = True
        user.is_superuser = True
        user.is_staff = True
        user.source = "local"
        user.save()

        self.stdout.write(self.style.SUCCESS(f"已重置 {username} 密码并确保账号状态正常"))
