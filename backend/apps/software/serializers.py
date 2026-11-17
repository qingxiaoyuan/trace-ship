"""软件目录请求与响应。"""

from rest_framework import serializers

from apps.account.models import User
from apps.software.models import ProjectSoftware, Software, software_slug
from apps.software.services import can_manage_software


class SoftwareUserSerializer(serializers.ModelSerializer):
    """软件页面所需的最少账号信息。"""

    class Meta:
        model = User
        fields = ["id", "username", "nickname"]


class SoftwareSummarySerializer(serializers.ModelSerializer):
    """提供软件身份及可显示的主仓库信息。"""

    repository_name = serializers.CharField(source="repository.name", read_only=True)

    class Meta:
        model = Software
        fields = ["id", "repository", "repository_name", "slug", "name", "description", "is_active"]


class SoftwareSerializer(SoftwareSummarySerializer):
    owner = SoftwareUserSerializer(read_only=True)
    can_maintain = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()
    maintainers = serializers.SerializerMethodField()

    def get_can_maintain(self, software: Software) -> bool:
        return self.get_can_manage(software) or any(
            grant.user_id == self.context["request"].user.pk for grant in software.maintainer_grants.all()
        )

    def get_can_manage(self, software: Software) -> bool:
        return can_manage_software(software, self.context["request"].user)

    def get_maintainers(self, software: Software) -> list[dict]:
        if not self.get_can_manage(software):
            return []
        users = (grant.user for grant in software.maintainer_grants.all())
        return SoftwareUserSerializer(users, many=True).data

    class Meta(SoftwareSummarySerializer.Meta):
        fields = [*SoftwareSummarySerializer.Meta.fields, "owner", "can_maintain", "can_manage", "maintainers"]


class SoftwareRegistrationSerializer(serializers.Serializer):
    repository = serializers.UUIDField()
    slug = serializers.CharField(max_length=80, validators=[software_slug])
    name = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True)


class SoftwareUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)
    owner_username = serializers.CharField(max_length=150, required=False)

    def validate(self, attrs: dict) -> dict:
        immutable = {"repository", "slug"}.intersection(self.initial_data)
        if immutable:
            raise serializers.ValidationError("登记后不能修改软件标识或主仓库。")
        return attrs


class SoftwareGrantSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)


class ProjectSoftwareSerializer(serializers.ModelSerializer):
    software = SoftwareSummarySerializer(read_only=True)
    can_view_repository = serializers.SerializerMethodField()
    is_usable = serializers.SerializerMethodField()

    def get_can_view_repository(self, selection: ProjectSoftware) -> bool:
        return selection.software.repository_id in self.context["visible_repository_ids"]

    def get_is_usable(self, selection: ProjectSoftware) -> bool:
        return (
            selection.is_active
            and selection.software.is_active
            and selection.software.repository_id in self.context["usable_repository_ids"]
        )

    class Meta:
        model = ProjectSoftware
        fields = ["id", "software", "is_active", "can_view_repository", "is_usable"]


class ProjectSoftwareSelectionSerializer(serializers.Serializer):
    software = serializers.UUIDField()


class ProjectSoftwareStateSerializer(serializers.Serializer):
    is_active = serializers.BooleanField()
