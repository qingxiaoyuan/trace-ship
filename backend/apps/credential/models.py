"""
凭证管理数据模型

Credential 模型用于统一存储各类外部系统凭证，敏感内容加密后落库。
"""
import uuid
from typing import Dict
from django.db import models
from django.conf import settings


class Credential(models.Model):
    """
    凭证模型

    支持多种凭证类型（GitLab/Gitea/SVN/Jenkins/LDAP/AI）和认证模式（Token/用户名密码），
    通过 scope 控制可见范围：个人、项目、全局。

    Attributes:
        id: UUID 主键
        name: 凭证名称
        cred_type: 凭证类型
        auth_mode: 认证模式
        encrypted_data: 加密后的凭证数据（JSON 字符串）
        username: 用户名或备注
        expires_at: 过期时间
        scope: 作用范围
        owner: 归属用户
        project: 关联项目（项目级凭证必填）
        is_global: 是否全局可见
        is_active: 是否启用
        last_used_at: 最后使用时间
        created_by: 创建人
        created_at: 创建时间
        updated_at: 更新时间
    """

    CRED_TYPE_CHOICES = [
        ("gitlab_token", "GitLab Token"),
        ("gitea_token", "Gitea Token"),
        ("svn_password", "SVN 密码"),
        ("jenkins_token", "Jenkins Token"),
        ("ldap_password", "LDAP 密码"),
        ("ai_api_key", "AI API Key"),
    ]
    AUTH_MODE_CHOICES = [
        ("token", "Token"),
        ("password", "用户名密码"),
    ]
    SCOPE_CHOICES = [
        ("personal", "个人"),
        ("project", "项目"),
        ("global", "全局"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, verbose_name="凭证名称")
    cred_type = models.CharField(max_length=30, choices=CRED_TYPE_CHOICES, verbose_name="凭证类型")
    auth_mode = models.CharField(max_length=20, choices=AUTH_MODE_CHOICES, verbose_name="认证模式")
    encrypted_data = models.TextField(verbose_name="加密数据")
    username = models.CharField(max_length=200, blank=True, verbose_name="用户名/备注")
    expires_at = models.DateTimeField(null=True, blank=True, verbose_name="过期时间")
    scope = models.CharField(max_length=20, choices=SCOPE_CHOICES, default="personal", verbose_name="作用范围")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="credentials",
        verbose_name="归属用户",
    )
    project = models.ForeignKey(
        "project.Project",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="credentials",
        verbose_name="关联项目",
    )
    is_global = models.BooleanField(default=False, verbose_name="是否全局")
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    last_used_at = models.DateTimeField(null=True, blank=True, verbose_name="最后使用时间")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_credentials",
        verbose_name="创建人",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_credential"
        verbose_name = "凭证"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        """返回凭证名称"""
        return self.name

    def set_data(self, data: Dict[str, str]) -> None:
        """
        设置凭证数据（自动加密）

        Args:
            data: 待加密的凭证字典，如 {"token": "xxx"} 或 {"username": "u", "password": "p"}
        """
        from utils.crypto import encrypt_credential
        self.encrypted_data = encrypt_credential(data)

    def get_data(self) -> Dict[str, str]:
        """
        获取凭证数据（自动解密）

        Returns:
            解密后的凭证字典
        """
        from utils.crypto import decrypt_credential
        return decrypt_credential(self.encrypted_data)

    @property
    def masked_data(self) -> str:
        """
        脱敏展示凭证内容

        根据认证模式对 token 或 password 进行脱敏，解密失败时返回 ****。

        Returns:
            脱敏后的字符串
        """
        from utils.crypto import mask_credential
        try:
            data = self.get_data()
            if self.auth_mode == "token":
                token = data.get("token", "")
                return mask_credential(token)
            else:
                pwd = data.get("password", "")
                return mask_credential(pwd)
        except Exception:
            return "****"
