"""
系统管理序列化器

包含系统参数和操作日志的序列化器。
"""

from rest_framework import serializers

from apps.system.ai_config import AI_CONFIG_KEYS, AI_SETTINGS_WRITE_MESSAGE
from apps.system.models import OPEN_API_SCOPES, AccessToken, OperationLog, SystemConfig
from apps.system.services import DOWNLOAD_CIDRS_KEY
from utils.download_access import parse_cidrs

DOWNLOAD_CIDRS_MAX_LENGTH = 24 * 1024


class SystemConfigSerializer(serializers.ModelSerializer):
    """
    系统参数序列化器
    """

    class Meta:
        model = SystemConfig
        fields = ["id", "key", "value", "description", "is_public", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        if attrs.get("key") == DOWNLOAD_CIDRS_KEY:
            raise serializers.ValidationError("请在「文件下载限制」中保存下载白名单")
        # 旧键、新键都核验，禁止借修改 key 或元数据绕过整组保存。
        if any(key in AI_CONFIG_KEYS for key in (attrs.get("key"), getattr(self.instance, "key", None))):
            raise serializers.ValidationError(AI_SETTINGS_WRITE_MESSAGE)
        return attrs


class DownloadPolicySerializer(serializers.Serializer):
    allowed_cidrs = serializers.CharField(allow_blank=True, max_length=DOWNLOAD_CIDRS_MAX_LENGTH)

    def validate_allowed_cidrs(self, value: str) -> str:
        try:
            normalized = "\n".join(str(network) for network in parse_cidrs(value))
        except ValueError as exc:
            raise serializers.ValidationError("请输入有效的 IP 地址或 CIDR 网段") from exc
        if len(normalized) > DOWNLOAD_CIDRS_MAX_LENGTH:
            raise serializers.ValidationError(
                f"规范化后的白名单不能超过 {DOWNLOAD_CIDRS_MAX_LENGTH} 个字符", code="max_length",
            )
        return normalized


class OperationLogSerializer(serializers.ModelSerializer):
    """
    操作日志序列化器

    读取时将 user 展开为包含 id、username、nickname 的字典。
    """

    user = serializers.SerializerMethodField()

    class Meta:
        model = OperationLog
        fields = [
            "id", "user", "module", "action", "resource_type", "resource_id",
            "detail", "description", "result", "ip", "created_at",
        ]

    def get_user(self, obj: OperationLog) -> dict[str, str] | None:
        """
        获取操作人简要信息

        Args:
            obj: OperationLog 实例

        Returns:
            用户信息字典或 None
        """
        if obj.user:
            return {
                "id": str(obj.user.id),
                "username": obj.user.username,
                "nickname": obj.user.nickname,
            }
        return None


class AccessTokenSerializer(serializers.ModelSerializer):
    """
    访问令牌序列化器

    token 明文不入库也不在接口返回（仅创建响应一次性携带，由视图拼装），
    列表/详情只回 token_prefix 脱敏展示。
    """

    created_by = serializers.SerializerMethodField()

    class Meta:
        model = AccessToken
        fields = [
            "id", "name", "token_prefix", "scopes", "is_active", "expires_at",
            "last_used_at", "last_used_ip", "remark", "created_by",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "token_prefix", "last_used_at", "last_used_ip", "created_at", "updated_at"]

    def validate_scopes(self, value: list) -> list:
        """校验 scopes 属于开放接口编码常量，且非空"""
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("接口范围不能为空")
        invalid = [s for s in value if s not in OPEN_API_SCOPES]
        if invalid:
            raise serializers.ValidationError(f"无效的接口范围: {', '.join(invalid)}")
        return value

    def get_created_by(self, obj: AccessToken) -> dict[str, str] | None:
        """获取创建人简要信息"""
        if obj.created_by:
            return {
                "id": str(obj.created_by.id),
                "username": obj.created_by.username,
                "nickname": obj.created_by.nickname,
            }
        return None
