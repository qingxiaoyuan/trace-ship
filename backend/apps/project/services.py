from rest_framework import serializers

from apps.project.models import ProjectIntegration, ProjectMember


class ProjectService:
    """Project-related business rules."""

    VALID_INTEGRATION_VENDORS = {
        "git_repo": {"gitlab", "gitea", "github", "gitee"},
        "svn_repo": {"svn"},
        "jenkins": {"jenkins"},
    }

    @staticmethod
    def validate_integration(data, instance=None):
        integration_type = data.get("integration_type", getattr(instance, "integration_type", None))
        vendor = data.get("vendor", getattr(instance, "vendor", ""))
        credential_mode = data.get("credential_mode", getattr(instance, "credential_mode", "fixed"))
        credential = data.get("credential", getattr(instance, "credential", None))
        specified_user = data.get("specified_user", getattr(instance, "specified_user", None))

        valid_vendors = ProjectService.VALID_INTEGRATION_VENDORS.get(integration_type, set())
        if vendor and valid_vendors and vendor not in valid_vendors:
            raise serializers.ValidationError({"vendor": f"{integration_type} 不支持 vendor={vendor}"})

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
    def add_creator_as_manager(project, user):
        ProjectMember.objects.get_or_create(
            project=project,
            user=user,
            defaults={"role": "manager"},
        )
