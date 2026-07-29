"""
使用反馈序列化器
"""
from rest_framework import serializers

from apps.feedback.models import Feedback


class FeedbackSerializer(serializers.ModelSerializer):
    """
    使用反馈序列化器

    附带提交人信息、点赞数与当前用户是否已点赞。
    """

    created_by_name = serializers.SerializerMethodField()
    like_count = serializers.SerializerMethodField()
    liked = serializers.SerializerMethodField()

    class Meta:
        model = Feedback
        fields = [
            "id", "title", "content", "category",
            "created_by", "created_by_name",
            "like_count", "liked",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def get_created_by_name(self, obj: Feedback) -> str:
        """提交人显示名，优先昵称"""
        return obj.created_by.nickname or obj.created_by.username

    def get_like_count(self, obj: Feedback) -> int:
        """点赞数：列表/详情走 annotate 聚合值，创建响应兜底实时统计"""
        annotated = getattr(obj, "like_count", None)
        if annotated is not None:
            return annotated
        return obj.likes.count()

    def get_liked(self, obj: Feedback) -> bool:
        """当前请求用户是否已点赞（利用 prefetch 缓存避免额外查询）"""
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        return any(user.id == request.user.id for user in obj.likes.all())

    def validate_title(self, value: str) -> str:
        """标题去空白并校验非空"""
        value = value.strip()
        if not value:
            raise serializers.ValidationError("标题不能为空")
        return value

    def validate_content(self, value: str) -> str:
        """内容去空白并校验非空"""
        value = value.strip()
        if not value:
            raise serializers.ValidationError("内容不能为空")
        return value
