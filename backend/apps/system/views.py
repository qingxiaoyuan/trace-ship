"""
系统管理视图

提供系统参数配置和操作日志查询接口，仅超管可访问。
"""
from django_filters.rest_framework import DjangoFilterBackend, DateTimeFromToRangeFilter
from django_filters import FilterSet
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


class OperationLogFilter(FilterSet):
    """操作日志过滤器，支持时间范围与结果过滤。"""

    created_at = DateTimeFromToRangeFilter(field_name="created_at")

    class Meta:
        model = OperationLog
        fields = ["module", "action", "user", "result", "created_at"]


class OperationLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    操作日志视图集

    仅支持查询，按模块、动作、用户、结果、时间范围过滤，仅超管可访问。
    """

    queryset = OperationLog.objects.select_related("user")
    serializer_class = OperationLogSerializer
    permission_classes = [IsAuthenticated, IsSuperUser]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_class = OperationLogFilter
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]
