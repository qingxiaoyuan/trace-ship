"""
系统管理视图

提供系统参数配置和操作日志查询接口，仅超管可访问。
"""
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import viewsets, filters
from rest_framework.permissions import IsAuthenticated

from apps.system.models import SystemConfig, OperationLog
from apps.system.serializers import SystemConfigSerializer, OperationLogSerializer
from utils.permissions import IsSuperUser


class SystemConfigViewSet(viewsets.ModelViewSet):
    """
    系统参数视图集

    使用 key 作为 lookup 字段，仅超管可操作。
    """

    queryset = SystemConfig.objects.all()
    serializer_class = SystemConfigSerializer
    permission_classes = [IsAuthenticated, IsSuperUser]
    lookup_field = "key"
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    search_fields = ["key", "description"]


class OperationLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    操作日志视图集

    仅支持查询，按模块、动作、用户过滤，仅超管可访问。
    """

    queryset = OperationLog.objects.select_related("user")
    serializer_class = OperationLogSerializer
    permission_classes = [IsAuthenticated, IsSuperUser]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["module", "action", "user"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]
