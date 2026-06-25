"""
项目管理序列化器

包含项目、项目成员、项目外站绑定的序列化器，以及支持字符串/数字双格式的状态字段。
"""
from typing import Any
from rest_framework import serializers
from apps.project.models import Project, ProjectMember, ProjectIntegration
from apps.account.serializers import UserSerializer
from apps.project.services import ProjectService


class ProjectStatusField(serializers.IntegerField):
    """
    项目状态字段

    同时支持 "active"/"inactive" 字符串和 1/0 数字输入，便于前端直接传字符串状态。
    """

    ACTIVE = 1
    INACTIVE = 0

    def to_internal_value(self, data: Any) -> int:
        """
        将外部值转换为内部整数状态

        Args:
            data: 输入值，可以是字符串或数字

        Returns:
            整数状态值
        """
        if isinstance(data, str):
            if data == "active":
                data = self.ACTIVE
            elif data == "inactive":
                data = self.INACTIVE
        return super().to_internal_value(data)

    def to_representation(self, value: int) -> int:
        """
        内部值原样输出

        Args:
            value: 内部整数状态

        Returns:
            原值
        """
        return value


class ProjectSerializer(serializers.ModelSerializer):
    """
    项目序列化器

    读取时展开负责人名称，状态字段支持字符串/数字双格式。
    """

    leader_name = serializers.CharField(source="leader.nickname", read_only=True)
    status = ProjectStatusField()

    class Meta:
        model = Project
        fields = [
            "id", "code", "name", "leader", "leader_name", "description",
            "version_rule", "release_rule", "status", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ProjectListSerializer(serializers.ModelSerializer):
    """
    项目列表序列化器

    字段精简，适合列表展示。
    """

    leader_name = serializers.CharField(source="leader.nickname", read_only=True)
    status = ProjectStatusField()

    class Meta:
        model = Project
        fields = ["id", "code", "name", "leader_name", "status", "created_at"]


class ProjectMemberSerializer(serializers.ModelSerializer):
    """
    项目成员序列化器

    读取时展开用户信息，写入时通过 user_id 指定用户。
    """

    user = UserSerializer(read_only=True)
    user_id = serializers.UUIDField(write_only=True)

    class Meta:
        model = ProjectMember
        fields = ["id", "user", "user_id", "role", "created_at"]
        read_only_fields = ["id", "created_at"]


class ProjectIntegrationSerializer(serializers.ModelSerializer):
    """
    项目外站绑定序列化器

    读取时展开关联凭证名称和指定用户名称，写入时调用 ProjectService 校验 vendor 与凭证模式。
    """

    credential_name = serializers.CharField(source="credential.name", read_only=True)
    specified_user_name = serializers.CharField(source="specified_user.nickname", read_only=True)

    class Meta:
        model = ProjectIntegration
        fields = [
            "id", "integration_type", "vendor", "name", "external_identity",
            "config", "credential", "credential_name", "credential_mode",
            "specified_user", "specified_user_name", "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs: dict) -> dict:
        """
        校验外站绑定的 vendor 与凭证模式一致性

        Args:
            attrs: 待校验的属性字典

        Returns:
            校验通过的字典
        """
        return ProjectService.validate_integration(attrs, self.instance)
