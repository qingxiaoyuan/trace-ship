"""发布代码审查模型和内置文档型技能配置。"""
from pathlib import Path
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from apps.system.models import ReviewSettings, ReviewSettingsVersion, ReviewSkillVersion
from utils.crypto import encrypt_credential

SKILL_NAME = "code-review-expert"
SKILL_REVISION = "08b6572ef108f22d4e8a3ecf9182a4bbef097744"
SKILL_SOURCE = f"https://github.com/sanyuan0704/sanyuan-skills/tree/{SKILL_REVISION}/skills/code-review-expert"
SKILL_FILES = (
    "SKILL.md", "references/code-quality-checklist.md", "references/removal-plan.md",
    "references/security-checklist.md", "references/solid-checklist.md", "LICENSE", "ADAPTATION.md",
)


def builtin_skill_documents() -> dict[str, str]:
    """读取随平台发布的固定来源文档，不访问业务仓库或外网。"""
    root = Path(__file__).parent / "review_skill"
    return {name: (root / name).read_text(encoding="utf-8") for name in SKILL_FILES}


def skill_metadata(version: ReviewSettingsVersion | None = None) -> dict:
    revision = version.skill_revision if version else SKILL_REVISION
    name = version.skill_name if version else SKILL_NAME
    files = list(version.skill_documents) if version else list(SKILL_FILES)
    builtin = revision == SKILL_REVISION and name == SKILL_NAME
    source = SKILL_SOURCE if builtin else ""
    return {"name": name, "revision": revision, "source": source, "license": "MIT" if builtin else "", "files": files}


class ReviewSettingsInput(serializers.Serializer):
    endpoint = serializers.URLField(max_length=500)
    model = serializers.CharField(max_length=200, trim_whitespace=True)
    protocol = serializers.ChoiceField(choices=("auto", "openai", "anthropic"))
    api_key = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False, write_only=True)
    skill = serializers.CharField(max_length=200)

    def validate_skill(self, value: str) -> str:
        if value != SKILL_NAME:
            try:
                if not ReviewSkillVersion.objects.filter(pk=value).exists():
                    raise serializers.ValidationError("所选技能不存在")
            except (ValueError, TypeError, DjangoValidationError):
                raise serializers.ValidationError("所选技能不存在")
        return value

    def validate_endpoint(self, value: str) -> str:
        if urlsplit(value).username is not None or urlsplit(value).password is not None:
            raise serializers.ValidationError("服务地址不能包含账号或密钥，请使用密钥字段")
        return value


def current_version() -> ReviewSettingsVersion | None:
    settings = ReviewSettings.objects.select_related("current_version").filter(pk=1).first()
    return settings.current_version if settings else None


def settings_response(version: ReviewSettingsVersion | None) -> dict:
    return {
        "version_id": str(version.id) if version else None,
        "endpoint": version.endpoint if version else "",
        "model": version.model if version else "",
        "protocol": version.protocol if version else "auto",
        "has_api_key": bool(version and version.encrypted_api_key),
        "skill": skill_metadata(version),
    }


@transaction.atomic
def save_settings(data: dict) -> ReviewSettingsVersion:
    """原子切换新版本；省略密钥时保留原值，空字符串表示清除。"""
    ReviewSettings.objects.get_or_create(pk=1)
    current = ReviewSettings.objects.select_for_update().get(pk=1)
    if "api_key" in data:
        encrypted = encrypt_credential({"api_key": data["api_key"]}) if data["api_key"] else ""
    else:
        encrypted = current.current_version.encrypted_api_key if current.current_version else ""
    skill = None if data["skill"] == SKILL_NAME else ReviewSkillVersion.objects.get(pk=data["skill"])
    version = ReviewSettingsVersion.objects.create(
        endpoint=data["endpoint"], model=data["model"], protocol=data["protocol"],
        encrypted_api_key=encrypted, skill_name=skill.name if skill else SKILL_NAME,
        skill_revision=str(skill.id) if skill else SKILL_REVISION,
        skill_documents=skill.documents if skill else builtin_skill_documents(),
    )
    current.current_version = version
    current.save(update_fields=["current_version"])
    return version
