from django.db import models
from rest_framework import serializers

from apps.credential.models import Credential


class CredentialService:
    """Credential business rules shared by serializers and views."""

    @staticmethod
    def queryset_for_user(user):
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
    def validate_scope(data, instance=None):
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
    def ensure_can_delete(credential: Credential):
        if credential.integrations.exists():
            raise serializers.ValidationError("凭证已被外站绑定引用，无法删除")
        if credential.repositories.exists():
            raise serializers.ValidationError("凭证已被仓库引用，无法删除")
