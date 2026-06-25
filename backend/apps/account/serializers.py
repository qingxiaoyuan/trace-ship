"""
账号管理序列化器

负责 User、Role、Permission 以及登录、用户信息、菜单等 DTO 的序列化与校验。
"""
from typing import List
from rest_framework import serializers
from apps.account.models import User, Role, Permission


class UserSerializer(serializers.ModelSerializer):
    """
    用户只读序列化器

    暴露用户公开信息字段，id/last_login/created_at/updated_at 为只读。
    """

    class Meta:
        model = User
        fields = [
            "id", "username", "nickname", "email", "phone",
            "source", "ldap_dn", "department", "is_active",
            "is_superuser", "last_login", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "last_login", "created_at", "updated_at"]


class UserCreateSerializer(serializers.ModelSerializer):
    """
    用户创建/更新序列化器

    接收明文密码（write-only）和可选角色 ID 列表，在创建用户时自动哈希密码并绑定角色。

    Attributes:
        password: 明文密码，仅写入
        role_ids: 角色 UUID 列表，仅写入
    """

    password = serializers.CharField(write_only=True, required=True)
    role_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)

    class Meta:
        model = User
        fields = [
            "id", "username", "password", "nickname", "email", "phone",
            "source", "department", "is_active", "is_superuser", "role_ids",
        ]
        read_only_fields = ["id"]

    def create(self, validated_data: dict) -> User:
        """
        创建用户并绑定角色

        Args:
            validated_data: 已校验的数据，包含 password 和可选 role_ids

        Returns:
            创建成功的 User 实例
        """
        role_ids: List[str] = validated_data.pop("role_ids", [])
        password: str = validated_data.pop("password")
        user = User.objects.create(**validated_data)
        user.set_password(password)
        user.save()

        # 为用户分配角色
        from apps.account.models import UserRole
        for role_id in role_ids:
            UserRole.objects.create(user=user, role_id=role_id)
        return user


class PermissionSerializer(serializers.ModelSerializer):
    """
    权限序列化器

    用于权限列表和详情接口。
    """

    class Meta:
        model = Permission
        fields = ["id", "name", "code", "module", "description", "created_at"]


class RoleSerializer(serializers.ModelSerializer):
    """
    角色序列化器

    读取时展开关联权限，写入时通过 permission_ids 重新绑定权限。

    Attributes:
        permissions: 只读，展开关联权限详情
        permission_ids: 只写，权限 UUID 列表
    """

    permissions = PermissionSerializer(many=True, read_only=True)
    permission_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)

    class Meta:
        model = Role
        fields = ["id", "name", "code", "description", "permissions", "permission_ids", "created_at"]

    def create(self, validated_data: dict) -> Role:
        """
        创建角色并绑定权限

        Args:
            validated_data: 已校验的数据，包含可选 permission_ids

        Returns:
            创建成功的 Role 实例
        """
        permission_ids: List[str] = validated_data.pop("permission_ids", [])
        role = Role.objects.create(**validated_data)
        from apps.account.models import RolePermission
        for perm_id in permission_ids:
            RolePermission.objects.create(role=role, permission_id=perm_id)
        return role

    def update(self, instance: Role, validated_data: dict) -> Role:
        """
        更新角色信息并重新绑定权限

        Args:
            instance: 待更新的 Role 实例
            validated_data: 已校验的数据

        Returns:
            更新后的 Role 实例
        """
        permission_ids = validated_data.pop("permission_ids", None)
        instance = super().update(instance, validated_data)
        if permission_ids is not None:
            from apps.account.models import RolePermission
            # 先清空旧权限，再重新绑定
            RolePermission.objects.filter(role=instance).delete()
            for perm_id in permission_ids:
                RolePermission.objects.create(role=instance, permission_id=perm_id)
        return instance


class LoginSerializer(serializers.Serializer):
    """
    登录请求序列化器

    校验用户名和密码必填，密码字段只写不返回。
    """

    username = serializers.CharField(required=True)
    password = serializers.CharField(required=True, write_only=True)


class TokenResponseSerializer(serializers.Serializer):
    """
    登录成功响应序列化器

    用于 drf-spectacular 生成 API 文档时的响应示例。
    """

    access_token = serializers.CharField()
    refresh_token = serializers.CharField()
    expires_in = serializers.IntegerField()


class UserInfoSerializer(serializers.ModelSerializer):
    """
    当前登录用户信息序列化器

    额外返回用户拥有的角色编码列表。
    """

    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "nickname", "email", "department", "source", "roles", "is_superuser"]

    def get_roles(self, obj: User) -> List[str]:
        """
        获取用户角色编码列表

        Args:
            obj: 当前用户实例

        Returns:
            角色编码字符串列表
        """
        return list(obj.user_roles.values_list("role__code", flat=True))


class MenuSerializer(serializers.Serializer):
    """
    菜单项序列化器

    用于前端侧边栏菜单结构定义。
    """

    id = serializers.CharField()
    name = serializers.CharField()
    path = serializers.CharField()
    icon = serializers.CharField(required=False)
    children = serializers.ListField(child=serializers.DictField(), required=False)
