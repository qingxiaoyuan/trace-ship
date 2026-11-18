"""软件目录请求与响应。"""

from rest_framework import serializers

from apps.account.models import User
from apps.project.services import repository_owner
from apps.software.models import Software, software_slug
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
    owner = serializers.SerializerMethodField()
    can_maintain = serializers.SerializerMethodField()
    latest_release_version = serializers.CharField(read_only=True, default=None)
    latest_release_tag = serializers.CharField(read_only=True, default=None)
    package_config_count = serializers.IntegerField(read_only=True, default=None)

    def get_owner(self, software: Software) -> dict | None:
        owner = repository_owner(software.repository)
        return SoftwareUserSerializer(owner).data if owner else None

    def get_can_maintain(self, software: Software) -> bool:
        return can_manage_software(software, self.context["request"].user)

    class Meta(SoftwareSummarySerializer.Meta):
        fields = [
            *SoftwareSummarySerializer.Meta.fields, "owner", "can_maintain", "latest_release_version",
            "latest_release_tag", "package_config_count",
        ]


class SoftwareRegistrationSerializer(serializers.Serializer):
    repository = serializers.UUIDField()
    slug = serializers.CharField(max_length=80, validators=[software_slug])
    name = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True)


class SoftwareUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)

    def validate(self, attrs: dict) -> dict:
        immutable = {"repository", "slug"}.intersection(self.initial_data)
        if immutable:
            raise serializers.ValidationError("登记后不能修改软件标识或主仓库。")
        return attrs


class ProjectSoftwareSerializer(serializers.Serializer):
    """保持项目软件查询的响应结构，按实时的仓库关联计算。"""

    id = serializers.UUIDField()
    software = SoftwareSummarySerializer(source="*")
    can_view_repository = serializers.BooleanField(default=True)
    is_active = serializers.BooleanField()
    is_usable = serializers.SerializerMethodField()

    def get_is_usable(self, software: Software) -> bool:
        return software.is_active and software.repository_id in self.context["usable_repository_ids"]
