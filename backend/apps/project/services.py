"""
项目业务服务

封装外站绑定的 vendor 校验、凭证模式校验以及创建者自动加入项目等逻辑。
"""
from typing import Optional
from rest_framework import serializers

from apps.project.models import ProjectIntegration, ProjectMember


class ProjectService:
    """
    项目相关业务规则服务
    """

    # 每种绑定类型支持的 vendor 集合
    VALID_INTEGRATION_VENDORS = {
        "git_repo": {"gitlab", "gitea", "github", "gitee"},
        "svn_repo": {"svn"},
        "jenkins": {"jenkins"},
    }

    @staticmethod
    def validate_integration(data: dict, instance: Optional[ProjectIntegration] = None) -> dict:
        """
        校验外站绑定的 vendor 与凭证模式一致性

        Args:
            data: 待校验数据
            instance: 更新的目标实例（可选）

        Returns:
            校验通过的数据

        Raises:
            ValidationError: 校验失败时抛出
        """
        integration_type = data.get("integration_type", getattr(instance, "integration_type", None))
        vendor = data.get("vendor", getattr(instance, "vendor", ""))
        credential_mode = data.get("credential_mode", getattr(instance, "credential_mode", "fixed"))
        credential = data.get("credential", getattr(instance, "credential", None))
        specified_user = data.get("specified_user", getattr(instance, "specified_user", None))

        # 校验 vendor 是否属于当前绑定类型支持的平台
        valid_vendors = ProjectService.VALID_INTEGRATION_VENDORS.get(integration_type, set())
        if vendor and valid_vendors and vendor not in valid_vendors:
            raise serializers.ValidationError({"vendor": f"{integration_type} 不支持 vendor={vendor}"})

        # 校验凭证模式与凭证/指定用户的匹配关系
        if credential_mode == "fixed" and credential is None:
            raise serializers.ValidationError({"credential": "fixed 凭证模式必须选择凭证"})
        if credential_mode != "fixed" and credential is not None:
            raise serializers.ValidationError({"credential": "非 fixed 凭证模式不能直接绑定凭证"})
        if credential_mode == "specified_user" and specified_user is None:
            raise serializers.ValidationError({"specified_user": "specified_user 凭证模式必须指定用户"})
        if credential_mode != "specified_user" and specified_user is not None:
            raise serializers.ValidationError({"specified_user": "仅 specified_user 凭证模式可以指定用户"})
        return data

    @staticmethod
    def add_creator_as_manager(project, user) -> None:
        """
        将项目创建者自动添加为项目管理员

        Args:
            project: 新创建的项目实例
            user: 创建者用户
        """
        ProjectMember.objects.get_or_create(
            project=project,
            user=user,
            defaults={"role": "manager"},
        )
