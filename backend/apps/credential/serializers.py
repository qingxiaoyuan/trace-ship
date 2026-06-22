from rest_framework import serializers
from apps.credential.models import Credential


class CredentialSerializer(serializers.ModelSerializer):
    masked_data = serializers.CharField(read_only=True)
    data = serializers.JSONField(write_only=True, required=False)
    owner_name = serializers.CharField(source="owner.nickname", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = Credential
        fields = [
            "id", "name", "cred_type", "auth_mode", "data", "username",
            "masked_data", "expires_at", "scope", "owner", "owner_name",
            "project", "project_name", "is_global", "is_active",
            "last_used_at", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "masked_data", "owner", "last_used_at", "created_at", "updated_at"]

    def create(self, validated_data):
        data = validated_data.pop("data", {})
        credential = Credential(**validated_data)
        credential.set_data(data)
        credential.save()
        return credential

    def update(self, instance, validated_data):
        data = validated_data.pop("data", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if data is not None:
            instance.set_data(data)
        instance.save()
        return instance


class CredentialListSerializer(serializers.ModelSerializer):
    masked_data = serializers.CharField(read_only=True)
    owner_name = serializers.CharField(source="owner.nickname", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = Credential
        fields = [
            "id", "name", "cred_type", "auth_mode", "username", "masked_data",
            "expires_at", "scope", "owner", "owner_name", "project", "project_name",
            "is_global", "is_active", "last_used_at", "created_at",
        ]
