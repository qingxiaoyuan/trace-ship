"""
通知视图

提供通知列表、未读数、标记已读等 API。
"""
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.notification.models import Notification
from apps.notification.serializers import NotificationSerializer
from apps.notification.services import NotificationService
from utils.response import error_response, success_response
from utils.viewsets import StandardReadOnlyModelViewSet


class NotificationViewSet(StandardReadOnlyModelViewSet):
    """
    通知视图集

    用户仅可查看自己的通知。
    """

    queryset = Notification.objects.all()
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["notification_type", "is_read"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]

    def get_queryset(self):
        """仅返回当前用户的通知"""
        if getattr(self, "swagger_fake_view", False):
            return Notification.objects.none()
        return Notification.objects.filter(user=self.request.user)

    def list(self, request: Request, *args, **kwargs) -> Response:
        """通知列表"""
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=False, methods=["get"], url_path="unread-count")
    def unread_count(self, request: Request) -> Response:
        """未读通知数"""
        count = self.get_queryset().filter(is_read=False).count()
        return success_response({"count": count})

    @action(detail=False, methods=["get"], url_path="remind-summary")
    def remind_summary(self, request: Request) -> Response:
        """强提醒聚合：我需要审批的待办任务与需要我整改的意见"""
        data = NotificationService.remind_summary(request.user)
        return success_response(data)

    @action(detail=True, methods=["post"], url_path="read")
    def read(self, request: Request, pk=None) -> Response:
        """标记单条已读"""
        notification = self.get_object()
        try:
            NotificationService.mark_read(notification, request.user)
        except ValueError as exc:
            return error_response(40301, str(exc))
        serializer = self.get_serializer(notification)
        return success_response(serializer.data, message="标记成功")

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request: Request) -> Response:
        """全部已读"""
        count = NotificationService.mark_all_read(request.user)
        return success_response({"count": count}, message="全部已读")

    @action(detail=False, methods=["delete"], url_path="clear")
    def clear(self, request: Request) -> Response:
        """
        清除当前用户全部已读通知

        Args:
            request: DRF Request

        Returns:
            删除条数
        """
        count, _ = self.get_queryset().filter(is_read=True).delete()
        return success_response({"count": count}, message="清除成功")

    @action(detail=False, methods=["delete"], url_path="clear-all")
    def clear_all(self, request: Request) -> Response:
        """
        清除当前用户全部通知（含未读）

        Args:
            request: DRF Request

        Returns:
            删除条数
        """
        count, _ = self.get_queryset().delete()
        return success_response({"count": count}, message="清除成功")
