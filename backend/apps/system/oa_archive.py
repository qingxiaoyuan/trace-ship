"""OA 软件归档的独立系统配置。"""
from urllib.parse import urlsplit

from rest_framework import serializers

from apps.system.models import SystemConfig

OA_ARCHIVE_URL_KEY = "oa_archive_url"


class OaArchiveConfigInput(serializers.Serializer):
    url = serializers.URLField(allow_blank=True, max_length=2000)

    def validate_url(self, value: str) -> str:
        parsed = urlsplit(value)
        if value and (parsed.scheme not in ("http", "https") or parsed.username or parsed.password or parsed.fragment):
            raise serializers.ValidationError("请输入不含认证信息和片段的完整 HTTP(S) 接口地址")
        return value


class OaArchiveConfig:
    @staticmethod
    def get_url() -> str:
        return SystemConfig.objects.filter(key=OA_ARCHIVE_URL_KEY).values_list("value", flat=True).first() or ""

    @staticmethod
    def save(url: str) -> None:
        SystemConfig.objects.update_or_create(
            key=OA_ARCHIVE_URL_KEY,
            defaults={"value": url, "description": "OA 软件归档接口完整地址", "is_public": False},
        )
