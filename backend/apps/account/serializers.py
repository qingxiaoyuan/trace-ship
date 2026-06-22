from rest_framework import serializers
from apps.account.models import User, Role, Permission


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id", "username", "nickname", "email", "phone",
            "source", "ldap_dn", "department", "is_active",
            "is_superuser", "last_login", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "last_login", "created_at", "updated_at"]


class UserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=True)
    role_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)

    class Meta:
        model = User
        fields = [
            "id", "username", "password", "nickname", "email", "phone",
            "source", "department", "is_active", "is_superuser", "role_ids",
        ]
        read_only_fields = ["id"]

    def create(self, validated_data):
        role_ids = validated_data.pop("role_ids", [])
        password = validated_data.pop("password")
        user = User.objects.create(**validated_data)
        user.set_password(password)
        user.save()

        from apps.account.models import UserRole
        for role_id in role_ids:
            UserRole.objects.create(user=user, role_id=role_id)
        return user


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "name", "code", "module", "description", "created_at"]


class RoleSerializer(serializers.ModelSerializer):
    permissions = PermissionSerializer(many=True, read_only=True)
    permission_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True, required=False)

    class Meta:
        model = Role
        fields = ["id", "name", "code", "description", "permissions", "permission_ids", "created_at"]

    def create(self, validated_data):
        permission_ids = validated_data.pop("permission_ids", [])
        role = Role.objects.create(**validated_data)
        from apps.account.models import RolePermission
        for perm_id in permission_ids:
            RolePermission.objects.create(role=role, permission_id=perm_id)
        return role

    def update(self, instance, validated_data):
        permission_ids = validated_data.pop("permission_ids", None)
        instance = super().update(instance, validated_data)
        if permission_ids is not None:
            from apps.account.models import RolePermission
            RolePermission.objects.filter(role=instance).delete()
            for perm_id in permission_ids:
                RolePermission.objects.create(role=instance, permission_id=perm_id)
        return instance


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(required=True)
    password = serializers.CharField(required=True, write_only=True)


class TokenResponseSerializer(serializers.Serializer):
    access_token = serializers.CharField()
    refresh_token = serializers.CharField()
    expires_in = serializers.IntegerField()


class UserInfoSerializer(serializers.ModelSerializer):
    roles = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "nickname", "email", "department", "source", "roles", "is_superuser"]

    def get_roles(self, obj):
        return list(obj.user_roles.values_list("role__code", flat=True))


class MenuSerializer(serializers.Serializer):
    id = serializers.CharField()
    name = serializers.CharField()
    path = serializers.CharField()
    icon = serializers.CharField(required=False)
    children = serializers.ListField(child=serializers.DictField(), required=False)
