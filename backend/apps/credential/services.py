"""
凭证业务服务

封装凭证的可见范围控制和删除前引用检查等业务规则。
"""
from django.db import models
from rest_framework import serializers

from apps.credential.models import Credential


class CredentialService:
    """
    Credential 业务规则服务

    被序列化器和视图共享，避免业务逻辑重复。
    """

    @staticmethod
    def queryset_for_user(user) -> models.QuerySet:
        """
        返回当前用户可见的凭证查询集

        规则：
        - 未登录：无数据
        - 超管：全部
        - 普通用户：自己的个人凭证 + 全系统共享的 SVN 凭证

        Args:
            user: 当前请求用户

        Returns:
            Credential QuerySet
        """
        queryset = Credential.objects.select_related("owner")
        if not user or not user.is_authenticated:
            return queryset.none()
        if user.is_superuser:
            return queryset.all()
        return queryset.filter(
            models.Q(owner=user)
            | models.Q(cred_type__in=Credential.SYSTEM_SHARED_CRED_TYPES)
        ).distinct()

    @staticmethod
    def ensure_can_delete(credential: Credential) -> None:
        """
        检查凭证是否可以删除

        若凭证已被仓库引用，则禁止删除。

        Args:
            credential: 待删除的 Credential 实例

        Raises:
            ValidationError: 存在引用时抛出
        """
        if credential.repositories.exists():
            raise serializers.ValidationError("凭证已被仓库引用，无法删除")
