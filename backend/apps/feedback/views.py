"""
使用反馈视图

提供反馈列表、提交、点赞切换与删除 API。所有登录用户可查看与提交，
仅提交人本人或超管可删除。
"""
from django.db.models import Count
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.feedback.models import Feedback
from apps.feedback.serializers import FeedbackSerializer
from utils.response import error_response, success_response
from utils.viewsets import StandardModelViewSet


class FeedbackViewSet(StandardModelViewSet):
    """
    使用反馈视图集

    全员可见、可提交；点赞为切换式接口；删除仅限本人或超管。
    """

    serializer_class = FeedbackSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["category", "status"]
    search_fields = ["title", "content"]
    ordering_fields = ["created_at", "like_count"]
    ordering = ["-created_at"]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        """反馈列表，聚合点赞数并按时间倒序"""
        if getattr(self, "swagger_fake_view", False):
            return Feedback.objects.none()
        return (
            Feedback.objects.select_related("created_by", "processed_by")
            .prefetch_related("likes")
            .annotate(like_count=Count("likes", distinct=True))
        )

    def perform_create(self, serializer: FeedbackSerializer) -> None:
        """创建时绑定当前用户为提交人"""
        serializer.save(created_by=self.request.user)

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """删除反馈，仅提交人本人或超管可操作"""
        feedback = self.get_object()
        if feedback.created_by != request.user and not request.user.is_superuser:
            return error_response(40301, "仅提交人本人可删除该反馈")
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="like")
    def like(self, request: Request, pk=None) -> Response:
        """
        点赞切换

        已点赞则取消，未点赞则点赞，返回最新点赞数与状态。
        """
        feedback = self.get_object()
        if feedback.likes.filter(id=request.user.id).exists():
            feedback.likes.remove(request.user)
            liked = False
        else:
            feedback.likes.add(request.user)
            liked = True
        return success_response(
            {"liked": liked, "like_count": feedback.likes.count()},
            message="点赞成功" if liked else "已取消点赞",
        )

    @action(detail=True, methods=["post"], url_path="process")
    def process(self, request: Request, pk=None) -> Response:
        """
        标记反馈为已处理

        仅超管可操作，记录处理人与处理时间。
        """
        if not request.user.is_superuser:
            return error_response(40301, "仅管理员可处理反馈")
        feedback = self.get_object()
        if feedback.status == "processed":
            return error_response(40001, "该反馈已处理")
        feedback.status = "processed"
        feedback.processed_by = request.user
        feedback.processed_at = timezone.now()
        feedback.save(update_fields=["status", "processed_by", "processed_at", "updated_at"])
        serializer = self.get_serializer(feedback)
        return success_response(serializer.data, message="已标记为已处理")
