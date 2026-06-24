"""
系统管理序列化器

包含系统参数和操作日志的序列化器。
"""
from typing import Optional, Dict
from rest_framework import serializers
from apps.system.models import SystemConfig, OperationLog


class SystemConfigSerializer(serializers.ModelSerializer):
    """
    系统参数序列化器
    """

    class Meta:
        model = SystemConfig
        fields = ["id", "key", "value", "description", "is_public", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class OperationLogSerializer(serializers.ModelSerializer):
    """
    操作日志序列化器

    读取时将 user 展开为包含 id、username、nickname 的字典。
    """

    user = serializers.SerializerMethodField()

    class Meta:
        model = OperationLog
        fields = ["id", "user", "module", "action", "resource_type", "resource_id", "detail", "ip", "created_at"]

    def get_user(self, obj: OperationLog) -> Optional[Dict[str, str]]:
        """
        获取操作人简要信息

        Args:
            obj: OperationLog 实例

        Returns:
            用户信息字典或 None
        """
        if obj.user:
            return {
                "id": str(obj.user.id),
                "username": obj.user.username,
                "nickname": obj.user.nickname,
            }
        return None
