"""
凭证管理数据模型

Credential 模型用于统一存储各类外部系统凭证，敏感内容加密后落库。
"""
import uuid

from django.conf import settings
from django.db import models


class Credential(models.Model):
    """
    凭证模型

    支持多种凭证类型（GitLab/SVN/LDAP）和认证模式（Token/用户名密码）。
    可见性规则（录入时无需选择范围）：
    - 默认均为个人凭证，仅归属用户与超管可见可用
    - 系统共享类型（svn_password / windows_password / ssh_password）所有登录用户可见可用

    Attributes:
        id: UUID 主键
        name: 凭证名称
        cred_type: 凭证类型
        auth_mode: 认证模式
        encrypted_data: 加密后的凭证数据（JSON 字符串）
        username: 用户名或备注
        expires_at: 过期时间
        owner: 归属用户
        is_active: 是否启用
        last_used_at: 最后使用时间
        created_by: 创建人
        created_at: 创建时间
        updated_at: 更新时间
    """

    CRED_TYPE_CHOICES = [
        ("gitlab_token", "GitLab Token"),
        ("svn_password", "SVN 密码"),
        ("ldap_password", "LDAP 密码"),
        ("windows_password", "Windows 密码"),
        ("ssh_password", "SSH 密码"),
    ]
    AUTH_MODE_CHOICES = [
        ("token", "Token"),
        ("password", "用户名密码"),
    ]
    # 全系统共享的凭证类型：所有登录用户可见可用
    SYSTEM_SHARED_CRED_TYPES = {"svn_password", "windows_password", "ssh_password"}

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, verbose_name="凭证名称")
    cred_type = models.CharField(max_length=30, choices=CRED_TYPE_CHOICES, verbose_name="凭证类型")
    auth_mode = models.CharField(max_length=20, choices=AUTH_MODE_CHOICES, verbose_name="认证模式")
    encrypted_data = models.TextField(verbose_name="加密数据")
    username = models.CharField(max_length=200, blank=True, verbose_name="用户名/备注")
    expires_at = models.DateTimeField(null=True, blank=True, verbose_name="过期时间")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="credentials",
        verbose_name="归属用户",
    )
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

    @property
    def is_system_shared(self) -> bool:
        """是否全系统共享（系统共享类型对所有登录用户可见可用）"""
        return self.cred_type in self.SYSTEM_SHARED_CRED_TYPES

    def set_data(self, data: dict[str, str]) -> None:
        """
        设置凭证数据（自动加密）

        Args:
            data: 待加密的凭证字典，如 {"token": "xxx"} 或 {"username": "u", "password": "p"}
        """
        from utils.crypto import encrypt_credential
        self.encrypted_data = encrypt_credential(data)

    def get_data(self) -> dict[str, str]:
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
