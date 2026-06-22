from rest_framework import serializers
from apps.system.models import SystemConfig, OperationLog


class SystemConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = SystemConfig
        fields = ["id", "key", "value", "description", "is_public", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class OperationLogSerializer(serializers.ModelSerializer):
    user = serializers.SerializerMethodField()

    class Meta:
        model = OperationLog
        fields = ["id", "user", "module", "action", "resource_type", "resource_id", "detail", "ip", "created_at"]

    def get_user(self, obj):
        if obj.user:
            return {"id": str(obj.user.id), "username": obj.user.username, "nickname": obj.user.nickname}
        return None
