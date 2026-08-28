"""
通知序列化器
"""
from rest_framework import serializers

from apps.notification.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    """
    通知序列化器
    """

    class Meta:
        model = Notification
        fields = [
            "id", "notification_type", "title", "content",
            "is_read", "read_at", "related_type", "related_id", "created_at",
        ]
        read_only_fields = [
            "id", "notification_type", "title", "content",
            "related_type", "related_id", "created_at",
        ]


class NotificationBroadcastSerializer(serializers.Serializer):
    """
    系统通知发送参数（管理员广播）

    scope=all 时下发全部启用用户；scope=users 时按 user_ids 指定接收人。
    """

    title = serializers.CharField(max_length=200)
    content = serializers.CharField(max_length=2000)
    scope = serializers.ChoiceField(choices=["all", "users"], default="all")
    user_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, allow_empty=False
    )

    def validate_title(self, value: str) -> str:
        """标题去空白后必填"""
        value = value.strip()
        if not value:
            raise serializers.ValidationError("通知标题不能为空")
        return value

    def validate_content(self, value: str) -> str:
        """内容去空白后必填"""
        value = value.strip()
        if not value:
            raise serializers.ValidationError("通知内容不能为空")
        return value

    def validate(self, attrs: dict) -> dict:
        """scope=users 时必须指定接收用户"""
        if attrs.get("scope") == "users" and not attrs.get("user_ids"):
            raise serializers.ValidationError({"user_ids": "指定用户发送时必须选择接收用户"})
        return attrs
