"""
凭证业务服务

封装凭证的查询范围控制、作用域校验和删除前引用检查等业务规则。
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
        - 普通用户：自己拥有的、全局的、或所在项目的项目级凭证

        Args:
            user: 当前请求用户

        Returns:
            Credential QuerySet
        """
        queryset = Credential.objects.select_related("owner", "project")
        if not user or not user.is_authenticated:
            return queryset.none()
        if user.is_superuser:
            return queryset.all()
        return queryset.filter(
            models.Q(owner=user)
            | models.Q(is_global=True)
            | models.Q(scope="project", project__members__user=user)
        ).distinct()

    @staticmethod
    def validate_scope(data: dict, instance: Credential = None) -> dict:
        """
        校验凭证作用范围与项目、全局标志的一致性

        Args:
            data: 待校验的数据字典
            instance: 更新的目标实例（可选）

        Returns:
            校验通过的数据字典

        Raises:
            ValidationError: 作用范围与项目/全局标志冲突时抛出
        """
        scope = data.get("scope", getattr(instance, "scope", "personal"))
        project = data.get("project", getattr(instance, "project", None))
        is_global = data.get("is_global", getattr(instance, "is_global", False))

        if scope == "project" and project is None:
            raise serializers.ValidationError({"project": "项目级凭证必须关联项目"})
        if scope != "project" and project is not None:
            raise serializers.ValidationError({"project": "非项目级凭证不能关联项目"})
        if scope == "global" and not is_global:
            data["is_global"] = True
        if is_global and scope != "global":
            raise serializers.ValidationError({"is_global": "全局凭证的 scope 必须为 global"})
        return data

    @staticmethod
    def ensure_can_delete(credential: Credential) -> None:
        """
        检查凭证是否可以删除

        若凭证已被仓库或 Jenkins 任务引用，则禁止删除。

        Args:
            credential: 待删除的 Credential 实例

        Raises:
            ValidationError: 存在引用时抛出
        """
        if credential.repositories.exists():
            raise serializers.ValidationError("凭证已被仓库引用，无法删除")
        if credential.jenkins_jobs.exists():
            raise serializers.ValidationError("凭证已被 Jenkins 任务引用，无法删除")
