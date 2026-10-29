"""脚本生成与发布审查共用的模型连接配置。"""
from urllib.parse import urlsplit

from django.db import transaction
from rest_framework import serializers

from apps.system.models import ReviewSettings, SystemConfig
from apps.system.services import SystemConfigService

AI_CONFIG_KEYS = ["ai_endpoint", "ai_api_key", "ai_model", "ai_protocol"]
AI_SETTINGS_WRITE_MESSAGE = "共享模型参数请在「AI 模型服务」中整组保存"
DEFAULT_AI_MODEL = "deepseek-v4-flash"
DEFAULT_AI_PROTOCOL = "auto"

AI_SETTING_DESCRIPTIONS = {
    "endpoint": "AI 服务地址",
    "api_key": "AI API 密钥",
    "model": "AI 模型名称",
    "protocol": "AI 协议",
    "manifest_chars": "仓库清单文件进入 prompt 的字符上限",
    "tree_chars": "仓库文件树进入 prompt 的字符上限",
    "knowledge_chars": "知识库进入 prompt 的字符上限",
    "exemplar_chars": "历史成功脚本进入 prompt 的字符上限",
    "max_tokens": "AI 脚本生成输出 token 上限",
}


class AISettingsInput(serializers.Serializer):
    endpoint = serializers.URLField(max_length=500, allow_blank=True)
    model = serializers.CharField(max_length=200, allow_blank=True)
    protocol = serializers.ChoiceField(choices=("auto", "openai", "anthropic"), allow_blank=True)
    api_key = serializers.CharField(required=False, allow_blank=True, write_only=True)
    manifest_chars = serializers.CharField(required=False, allow_blank=True)
    tree_chars = serializers.CharField(required=False, allow_blank=True)
    knowledge_chars = serializers.CharField(required=False, allow_blank=True)
    exemplar_chars = serializers.CharField(required=False, allow_blank=True)
    max_tokens = serializers.CharField(required=False, allow_blank=True)

    def validate_endpoint(self, value):
        if urlsplit(value).username is not None or urlsplit(value).password is not None:
            raise serializers.ValidationError("服务地址不能包含账号或密钥，请使用密钥字段")
        return value


def lock_ai_settings() -> ReviewSettings:
    """在调用方事务内协调模型保存、技能保存与提审快照，兼容已有单例表。"""
    ReviewSettings.objects.get_or_create(pk=1)
    return ReviewSettings.objects.select_for_update().get(pk=1)


@transaction.atomic
def save_ai_settings(data: dict[str, str]) -> None:
    """整组切换共享设置；缺省密钥保留，空字段删除并沿用读取默认值。"""
    lock_ai_settings()
    for field, description in AI_SETTING_DESCRIPTIONS.items():
        if field not in data:
            continue
        key, value = f"ai_{field}", data[field]
        if value:
            SystemConfig.objects.update_or_create(key=key, defaults={
                "value": value, "description": description, "is_public": False,
            })
        else:
            SystemConfig.objects.filter(key=key).delete()


def model_config() -> dict[str, str]:
    """统一归一化模型参数；业务各自维护上下文额度与执行快照。"""
    values = SystemConfigService.get_many(AI_CONFIG_KEYS)
    protocol = (values.get("ai_protocol") or "").strip() or DEFAULT_AI_PROTOCOL
    return {
        "endpoint": (values.get("ai_endpoint") or "").strip(),
        "api_key": (values.get("ai_api_key") or "").strip(),
        "model": (values.get("ai_model") or "").strip() or DEFAULT_AI_MODEL,
        "protocol": protocol if protocol in ("auto", "openai", "anthropic") else DEFAULT_AI_PROTOCOL,
    }
