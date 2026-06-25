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
