from rest_framework import serializers
from apps.project.models import Project, ProjectMember, ProjectIntegration
from apps.account.serializers import UserSerializer


class ProjectSerializer(serializers.ModelSerializer):
    leader_name = serializers.CharField(source="leader.nickname", read_only=True)

    class Meta:
        model = Project
        fields = [
            "id", "code", "name", "leader", "leader_name", "description",
            "version_rule", "release_rule", "status", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ProjectListSerializer(serializers.ModelSerializer):
    leader_name = serializers.CharField(source="leader.nickname", read_only=True)

    class Meta:
        model = Project
        fields = ["id", "code", "name", "leader_name", "status", "created_at"]


class ProjectMemberSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    user_id = serializers.UUIDField(write_only=True)

    class Meta:
        model = ProjectMember
        fields = ["id", "user", "user_id", "role", "created_at"]
        read_only_fields = ["id", "created_at"]


class ProjectIntegrationSerializer(serializers.ModelSerializer):
    credential_name = serializers.CharField(source="credential.name", read_only=True)
    specified_user_name = serializers.CharField(source="specified_user.nickname", read_only=True)

    class Meta:
        model = ProjectIntegration
        fields = [
            "id", "integration_type", "vendor", "name", "external_identity",
            "config", "credential", "credential_name", "credential_mode",
            "specified_user", "specified_user_name", "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
