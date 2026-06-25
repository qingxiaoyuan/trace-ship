"""
凭证管理序列化器

负责 Credential 的序列化、反序列化以及创建/更新时的加密和作用域校验。
"""
from typing import Dict, Any
from rest_framework import serializers
from apps.credential.models import Credential
from apps.credential.services import CredentialService


class CredentialSerializer(serializers.ModelSerializer):
    """
    凭证读写序列化器

    写入时接收 data 字段（敏感信息），读取时返回 masked_data（脱敏信息）。
    同时展开 owner_name 和 project_name 便于前端展示。

    Attributes:
        masked_data: 只读，脱敏后的凭证内容
        data: 只写，敏感凭证数据
        owner_name: 只读，归属用户显示名
        project_name: 只读，关联项目名称
    """

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

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        """
        校验凭证类型与认证模式的一致性

        Git 类 Token 凭证和 Jenkins Token 只能使用 token 模式；
        SVN/LDAP 密码类凭证只能使用 password 模式。

        Args:
            attrs: 待校验属性

        Returns:
            校验通过的数据

        Raises:
            ValidationError: 类型与模式不匹配时抛出
        """
        cred_type = attrs.get("cred_type", getattr(self.instance, "cred_type", None))
        auth_mode = attrs.get("auth_mode", getattr(self.instance, "auth_mode", None))

        token_types = {"gitlab_token", "gitea_token", "github_token", "gitee_token", "jenkins_token"}
        password_types = {"svn_password", "ldap_password"}

        # 凭证类型友好名称映射
        CRED_TYPE_LABELS = {
            "gitlab_token": "GitLab Token",
            "gitea_token": "Gitea Token",
            "github_token": "GitHub Token",
            "gitee_token": "Gitee Token",
            "jenkins_token": "Jenkins Token",
            "svn_password": "SVN 密码",
            "ldap_password": "LDAP 密码",
        }

        if cred_type in token_types and auth_mode != "token":
            raise serializers.ValidationError(
                {"auth_mode": f"{CRED_TYPE_LABELS.get(cred_type, cred_type)} 必须使用 Token 认证模式"}
            )
        if cred_type in password_types and auth_mode != "password":
            raise serializers.ValidationError(
                {"auth_mode": f"{CRED_TYPE_LABELS.get(cred_type, cred_type)} 必须使用用户名密码认证模式"}
            )

        return attrs

    def create(self, validated_data: Dict[str, Any]) -> Credential:
        """
        创建凭证并加密敏感数据

        Args:
            validated_data: 已校验的数据，包含可选 data 字段

        Returns:
            创建成功的 Credential 实例
        """
        validated_data = CredentialService.validate_scope(validated_data)
        data = validated_data.pop("data", {})
        credential = Credential(**validated_data)
        credential.set_data(data)
        credential.save()
        return credential

    def update(self, instance: Credential, validated_data: Dict[str, Any]) -> Credential:
        """
        更新凭证信息，若传入 data 则重新加密

        Args:
            instance: 待更新的 Credential 实例
            validated_data: 已校验的数据

        Returns:
            更新后的 Credential 实例
        """
        validated_data = CredentialService.validate_scope(validated_data, instance)
        data = validated_data.pop("data", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if data is not None:
            instance.set_data(data)
        instance.save()
        return instance


class CredentialListSerializer(serializers.ModelSerializer):
    """
    凭证列表序列化器

    用于列表接口，字段精简，避免返回敏感信息。
    """

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
