"""
账号管理数据模型

包含自定义用户模型（User）、权限（Permission）、角色（Role）以及
用户-角色、角色-权限关联表，实现 RBAC 权限控制。
"""
import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """
    自定义用户模型

    继承 Django AbstractUser，使用 UUID 主键，支持本地账号和 LDAP 账号两种来源。

    Attributes:
        id: UUID 主键
        nickname: 显示名
        phone: 联系电话
        source: 账号来源（local/ldap）
        ldap_dn: LDAP 唯一标识
        department: 所属部门
        email: 邮箱地址
        is_active: 账号是否启用
        created_at: 创建时间
        updated_at: 更新时间
    """

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

    def __str__(self) -> str:
        """返回用户显示名或用户名"""
        return self.nickname or self.username


class Permission(models.Model):
    """
    权限模型

    表示系统中的一个原子权限，通过 code 唯一标识并按 module 分组。

    Attributes:
        id: UUID 主键
        name: 权限名称
        code: 权限编码（全局唯一）
        module: 所属模块
        description: 描述
        created_at: 创建时间
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, verbose_name="权限名称")
    code = models.CharField(max_length=200, unique=True, verbose_name="权限编码")
    module = models.CharField(max_length=100, verbose_name="所属模块")
    description = models.TextField(blank=True, verbose_name="描述")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sys_permission"
        verbose_name = "权限"

    def __str__(self) -> str:
        """返回权限名称"""
        return self.name


class Role(models.Model):
    """
    角色模型

    角色是一组权限的集合，通过多对多关联 Permission。

    Attributes:
        id: UUID 主键
        name: 角色名称
        code: 角色编码（全局唯一）
        permissions: 关联的权限集合
        description: 描述
        created_at: 创建时间
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, verbose_name="角色名称")
    code = models.CharField(max_length=200, unique=True, verbose_name="角色编码")
    permissions = models.ManyToManyField(Permission, through="RolePermission", related_name="roles", verbose_name="权限")
    description = models.TextField(blank=True, verbose_name="描述")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sys_role"
        verbose_name = "角色"

    def __str__(self) -> str:
        """返回角色名称"""
        return self.name


class UserRole(models.Model):
    """
    用户-角色关联表

    实现用户与角色之间的多对多关系。

    Attributes:
        id: UUID 主键
        user: 关联用户
        role: 关联角色
        created_at: 创建时间
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="user_roles", verbose_name="用户")
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="user_roles", verbose_name="角色")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sys_user_role"
        verbose_name = "用户角色"
        unique_together = ["user", "role"]


class RolePermission(models.Model):
    """
    角色-权限关联表

    实现角色与权限之间的多对多关系。

    Attributes:
        id: UUID 主键
        role: 关联角色
        permission: 关联权限
        created_at: 创建时间
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="role_permissions", verbose_name="角色")
    permission = models.ForeignKey(Permission, on_delete=models.CASCADE, related_name="role_permissions", verbose_name="权限")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "sys_role_permission"
        verbose_name = "角色权限"
        unique_together = ["role", "permission"]
