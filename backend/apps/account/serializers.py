"""
账号管理序列化器

负责 User、Role、Permission 以及登录、用户信息、菜单等 DTO 的序列化与校验。
"""

from rest_framework import serializers

from apps.account.models import Permission, Role, User


class RoleBriefSerializer(serializers.ModelSerializer):
    """
    角色简要序列化器

    用于在用户列表中返回角色摘要信息。
    """

    class Meta:
        model = Role
        fields = ["id", "name", "code"]


class UserBriefSerializer(serializers.ModelSerializer):
    """
    用户简要序列化器

    面向人员查询/选择器场景，仅暴露必要公开字段，
    不包含邮箱、手机、LDAP DN、登录时间等敏感信息。
    """

    class Meta:
        model = User
        fields = ["id", "username", "nickname", "department", "is_active"]
        read_only_fields = fields


class UserSerializer(serializers.ModelSerializer):
    """
    用户只读序列化器

    暴露用户公开信息字段，id/last_login/created_at/updated_at 为只读，
    同时展开用户绑定的角色列表。
    """

    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "username", "nickname", "email", "phone",
            "source", "ldap_dn", "department", "is_active",
            "is_superuser", "roles", "last_login", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "last_login", "created_at", "updated_at"]

    def get_roles(self, obj: User) -> list:
        """
        获取用户绑定的角色列表

        通过 user_roles 关联表取出 Role 实例后序列化。建议在视图层通过
        prefetch_related('user_roles__role') 预加载以避免 N+1 查询。

        Args:
            obj: 当前用户实例

        Returns:
            角色摘要字典列表
        """
        roles = [ur.role for ur in obj.user_roles.all()]
        return RoleBriefSerializer(roles, many=True).data


class UserCreateSerializer(serializers.ModelSerializer):
    """
    用户创建/更新序列化器

    接收明文密码（write-only，创建时必填、更新时可选）和可选角色 ID 列表，
    创建用户时自动哈希密码并绑定角色，更新时可选择性修改密码与角色。

    Attributes:
        password: 明文密码，仅写入，创建必填、更新可选
        role_ids: 角色 UUID 列表，仅写入
    """

    password = serializers.CharField(write_only=True, required=False, allow_blank=True)
    role_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)

    class Meta:
        model = User
        fields = [
            "id", "username", "password", "nickname", "email", "phone",
            "source", "department", "is_active", "is_superuser", "role_ids",
        ]
        read_only_fields = ["id"]

    def validate(self, attrs: dict) -> dict:
        """
        校验密码必填条件、LDAP 用户保护及防提权

        - 创建用户时必须提供密码，更新用户时可不传（不传则保持原密码）。
        - LDAP 账号的用户名和密码由 LDAP 服务器管理，更新时静默忽略这两个字段，
          防止前端绕过禁用态直接调接口修改。
        - 非超管始终不能设置/修改 is_superuser，防止提权。
        - 非超管更新时：拥有 system.user 权限可调整启用状态与角色，
          普通用户仅能修改自己的基础信息（管理字段被剔除）。

        Args:
            attrs: 已校验的数据

        Returns:
            校验后的数据
        """
        if self.instance is None and not attrs.get("password"):
            raise serializers.ValidationError({"password": "创建用户时密码为必填项"})
        if self.instance is not None and self.instance.source == "ldap":
            attrs.pop("password", None)
            attrs.pop("username", None)
        # 非超管防提权处理
        request = self.context.get("request")
        if request and not request.user.is_superuser:
            # 非超管始终不能设置/修改 is_superuser
            attrs.pop("is_superuser", None)
            if self.instance is not None:
                # 更新时不允许非超管修改账号来源与用户名（登录标识）
                attrs.pop("source", None)
                attrs.pop("username", None)
                # 仅拥有 system.user 权限可调整启用状态与角色，普通用户仅能改自己基础信息
                has_system_user = request.user.user_roles.filter(
                    role__permissions__code="system.user"
                ).exists()
                if not has_system_user:
                    for field in ("is_active", "role_ids"):
                        attrs.pop(field, None)
        return attrs

    def create(self, validated_data: dict) -> User:
        """
        创建用户并绑定角色

        Args:
            validated_data: 已校验的数据，包含 password 和可选 role_ids

        Returns:
            创建成功的 User 实例
        """
        role_ids: list[str] = validated_data.pop("role_ids", [])
        password: str = validated_data.pop("password")
        user = User.objects.create(**validated_data)
        user.set_password(password)
        user.save()

        # 为用户分配角色
        from apps.account.models import UserRole
        for role_id in role_ids:
            UserRole.objects.create(user=user, role_id=role_id)
        return user

    def update(self, instance: User, validated_data: dict) -> User:
        """
        更新用户信息、密码与角色

        若提供 password 则更新密码；若提供 role_ids 则重新绑定角色。

        Args:
            instance: 待更新的 User 实例
            validated_data: 已校验的数据

        Returns:
            更新后的 User 实例
        """
        role_ids = validated_data.pop("role_ids", None)
        password = validated_data.pop("password", None)

        instance = super().update(instance, validated_data)
        if password:
            instance.set_password(password)
            instance.save()

        if role_ids is not None:
            from apps.account.models import UserRole
            UserRole.objects.filter(user=instance).delete()
            for role_id in role_ids:
                UserRole.objects.create(user=instance, role_id=role_id)
        return instance


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
        permission_ids: list[str] = validated_data.pop("permission_ids", [])
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


class SsoLoginSerializer(serializers.Serializer):
    """
    SSO 登录请求序列化器

    校验 OA 重定向携带的一次性 token 必填，只写不返回。
    """

    token = serializers.CharField(required=True, allow_blank=False, trim_whitespace=True, write_only=True)


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

    额外返回用户拥有的角色编码列表与权限编码列表（供前端细粒度权限控制）。
    """

    roles = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "nickname", "email", "department", "source", "roles", "permissions", "is_superuser"]

    def get_roles(self, obj: User) -> list[str]:
        """
        获取用户角色编码列表

        Args:
            obj: 当前用户实例

        Returns:
            角色编码字符串列表
        """
        return list(obj.user_roles.values_list("role__code", flat=True))

    def get_permissions(self, obj: User) -> list[str]:
        """
        获取用户通过角色关联的全部权限编码列表

        Args:
            obj: 当前用户实例

        Returns:
            权限编码字符串列表
        """
        return list(obj.user_roles.values_list("role__permissions__code", flat=True).distinct())


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
