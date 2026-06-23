from rest_framework import serializers

from apps.project.models import ProjectMember
from apps.repository.models import CommitRecord, Repository


class RepositorySerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    credential_id = serializers.UUIDField(source="credential.id", read_only=True)

    class Meta:
        model = Repository
        fields = [
            "id", "project", "project_name", "integration",
            "repo_type", "vendor", "name", "url", "external_identity",
            "default_branch", "credential", "credential_id", "credential_mode",
            "specified_user", "health_status", "last_sync_at", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "health_status", "last_sync_at", "created_at", "updated_at"]

    def validate_project(self, value):
        user = self.context["request"].user
        if user.is_superuser:
            return value
        if not ProjectMember.objects.filter(project=value, user=user).exists():
            raise serializers.ValidationError("你只能为所属项目创建仓库")
        return value


class RepositoryListSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = Repository
        fields = [
            "id", "project", "project_name", "repo_type", "vendor",
            "name", "url", "external_identity", "default_branch",
            "health_status", "last_sync_at", "created_at",
        ]


class CommitRecordSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True)
    change_type = serializers.SerializerMethodField(read_only=True)
    parsed_result = serializers.JSONField(source="parsed_message", read_only=True)

    class Meta:
        model = CommitRecord
        fields = [
            "id", "project", "project_name", "repository", "repository_name",
            "commit_hash", "author", "author_email", "message", "committed_at",
            "branch", "change_type", "parsed_result", "review_status",
            "review_reason", "ai_suggestion", "ai_review_at", "created_at",
        ]
        read_only_fields = [
            "id", "project", "repository", "commit_hash", "author", "author_email",
            "message", "committed_at", "branch", "parsed_message", "review_status",
            "review_reason", "ai_suggestion", "ai_review_at", "created_at",
        ]

    def get_change_type(self, obj: CommitRecord) -> str:
        updates = obj.parsed_message.get("updates", [])
        if not updates:
            return "-"
        types = {u.get("type") for u in updates if u.get("type")}
        if types == {"A"}:
            return "A类"
        if types == {"F"}:
            return "F类"
        return "/".join(sorted(types)) + "类"
