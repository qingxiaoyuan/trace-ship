import uuid
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    SOURCE_CHOICES = [
        ("local", "本地账号"),
        ("ldap", "LDAP账号"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nickname = models.CharField(max_length=200, blank=True, verbose_name="显示名")
    phone = models.CharField(max_length=20, blank=True, verbose_name="电话")
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES, default="local", verbose_name="来源")
    ldap_dn = models.CharField(max_length=500, blank=True, verbose_name="LDAP DN")
    department = models.CharField(max_length=200, blank=True, verbose_name="部门")
    email = models.EmailField(blank=True, verbose_name="邮箱")
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "sys_user"
        verbose_name = "用户"
        verbose_name_plural = "用户"

    def __str__(self):
        return self.nickname or self.username


class Permission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, verbose_name="权限名称")
    code = models.CharField(max_length=200, unique=True, verbose_name="权限编码")
    module = models.CharField(max_length=100, verbose_name="所属模块")
    description = models.TextField(blank=True, verbose_name="描述")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sys_permission"
        verbose_name = "权限"

    def __str__(self):
        return self.name


class Role(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, verbose_name="角色名称")
    code = models.CharField(max_length=200, unique=True, verbose_name="角色编码")
    permissions = models.ManyToManyField(Permission, through="RolePermission", related_name="roles", verbose_name="权限")
    description = models.TextField(blank=True, verbose_name="描述")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sys_role"
        verbose_name = "角色"

    def __str__(self):
        return self.name


class UserRole(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="user_roles", verbose_name="用户")
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="user_roles", verbose_name="角色")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sys_user_role"
        verbose_name = "用户角色"
        unique_together = ["user", "role"]


class RolePermission(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="role_permissions", verbose_name="角色")
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name="role_permissions", verbose_name="权限")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sys_role_permission"
        verbose_name = "角色权限"
        unique_together = ["role", "permission"]
