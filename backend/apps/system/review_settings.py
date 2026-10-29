"""发布代码审查模型和内置文档型技能配置。"""
from pathlib import Path
from urllib.parse import urlsplit

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from apps.system.ai_config import lock_ai_settings, model_config
from apps.system.models import ReviewSettings, ReviewSettingsVersion, ReviewSkillVersion
from utils.crypto import decrypt_credential, encrypt_credential

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
    skill = serializers.CharField(max_length=200)

    def validate(self, attrs):
        if {"endpoint", "model", "protocol", "api_key"} & set(self.initial_data):
            raise serializers.ValidationError("模型参数统一在「AI 模型服务」中维护，审查配置仅保存技能")
        return attrs

    def validate_skill(self, value: str) -> str:
        if value != SKILL_NAME:
            try:
                if not ReviewSkillVersion.objects.filter(pk=value).exists():
                    raise serializers.ValidationError("所选技能不存在")
            except (ValueError, TypeError, DjangoValidationError):
                raise serializers.ValidationError("所选技能不存在")
        return value



def current_version() -> ReviewSettingsVersion | None:
    settings = ReviewSettings.objects.select_related("current_version").filter(pk=1).first()
    return settings.current_version if settings else None


def settings_response(version: ReviewSettingsVersion | None) -> dict:
    config = model_config()
    return {
        "version_id": str(version.id) if version else None,
        "endpoint": config["endpoint"],
        "model": config["model"],
        "protocol": config["protocol"],
        "has_api_key": bool(config["api_key"]),
        "model_source": "shared",
        "skill": skill_metadata(version),
    }


def _create_version(config: dict, previous: ReviewSettingsVersion | None = None, skill=None) -> ReviewSettingsVersion:
    """只创建不可变版本，不修改已有审批引用的记录。"""
    return ReviewSettingsVersion.objects.create(
        endpoint=config["endpoint"], model=config["model"], protocol=config["protocol"],
        encrypted_api_key=encrypt_credential({"api_key": config["api_key"]}) if config["api_key"] else "",
        skill_name=previous.skill_name if previous else skill.name if skill else SKILL_NAME,
        skill_revision=previous.skill_revision if previous else str(skill.id) if skill else SKILL_REVISION,
        skill_documents=previous.skill_documents if previous else skill.documents if skill else builtin_skill_documents(),
    )


@transaction.atomic
def save_settings(data: dict) -> ReviewSettingsVersion:
    """单独保存所选技能，模型连接参数始终从共享设置读取。"""
    current = lock_ai_settings()
    skill = None if data["skill"] == SKILL_NAME else ReviewSkillVersion.objects.get(pk=data["skill"])
    version = _create_version(model_config(), skill=skill)
    current.current_version = version
    current.save(update_fields=["current_version"])
    return version


@transaction.atomic
def capture_review_settings() -> ReviewSettingsVersion:
    """提审时固定当时的共享模型和审查技能；重试继续引用原版本。"""
    current = lock_ai_settings()
    config = model_config()
    try:
        serializers.URLField(max_length=500).run_validation(config["endpoint"])
        if urlsplit(config["endpoint"]).username is not None or urlsplit(config["endpoint"]).password is not None:
            raise serializers.ValidationError("服务地址不能包含账号或密钥")
        if len(config["model"]) > 200:
            raise serializers.ValidationError("模型名称过长")
    except serializers.ValidationError:
        raise serializers.ValidationError({"workflow": "请先在系统配置的「AI 模型服务」中配置有效的服务地址和模型名称"})
    previous = current.current_version
    if previous and all(getattr(previous, key) == config[key] for key in ("endpoint", "model", "protocol")):
        previous_key = decrypt_credential(previous.encrypted_api_key).get("api_key", "") if previous.encrypted_api_key else ""
        if previous_key == config["api_key"]:
            return previous
    version = _create_version(config, previous=previous)
    current.current_version = version
    current.save(update_fields=["current_version"])
    return version
