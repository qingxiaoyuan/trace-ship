"""
凭证管理数据模型

Credential 模型用于统一存储各类外部系统凭证，敏感内容加密后落库。
"""
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


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


class RepositoryCredentialLoan(models.Model):
    """仓库凭证借用授权。

    凭证仍归个人所有；借用记录只声明哪些产品可以在指定仓库上执行哪些
    操作，不复制、不转移、更不暴露凭证明文。
    """

    SCOPE_CHOICES = [
        ("read", "读取仓库"),
        ("create_tag", "创建 Tag"),
        ("delete_tag", "删除 Tag"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    repository = models.ForeignKey(
        "repository.Repository", on_delete=models.CASCADE,
        related_name="credential_loans", verbose_name="仓库",
    )
    credential = models.ForeignKey(
        Credential, on_delete=models.PROTECT,
        related_name="repository_loans", verbose_name="凭证",
    )
    lender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        related_name="credential_loans", verbose_name="出借人",
    )
    allowed_products = models.ManyToManyField(
        "project.Project", related_name="credential_loans",
        verbose_name="允许使用的产品",
    )
    permission_scope = models.JSONField(
        default=list, verbose_name="授权操作",
        help_text="可选值：read、create_tag、delete_tag",
    )
    expires_at = models.DateTimeField(null=True, blank=True, verbose_name="授权过期时间")
    is_active = models.BooleanField(default=True, verbose_name="是否有效")
    revoked_at = models.DateTimeField(null=True, blank=True, verbose_name="撤销时间")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "repository_credential_loan"
        verbose_name = "仓库凭证借用"
        verbose_name_plural = "仓库凭证借用"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["repository", "is_active"]),
            models.Index(fields=["lender", "is_active"]),
        ]

    def __str__(self) -> str:
        return f"{self.repository.name} - {self.credential.name}"

    def is_valid_for(self, project, operation: str = "read") -> bool:
        """判断借用记录在指定产品与操作下是否仍有效。"""
        if not self.is_active or self.revoked_at:
            return False
        if self.expires_at and self.expires_at <= timezone.now():
            return False
        if not self.credential.is_active:
            return False
        if self.credential.expires_at and self.credential.expires_at <= timezone.now():
            return False
        if operation not in (self.permission_scope or []):
            return False
        return self.allowed_products.filter(id=project.id).exists()


class CredentialUsageLog(models.Model):
    """凭证借用审计记录，只记录上下文和结果，绝不记录敏感内容。"""

    RESULT_CHOICES = [("success", "成功"), ("failure", "失败")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="credential_usage_logs", verbose_name="操作人",
    )
    lender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="lent_credential_usage_logs", verbose_name="出借人",
    )
    credential = models.ForeignKey(
        Credential, on_delete=models.PROTECT,
        related_name="usage_logs", verbose_name="凭证",
    )
    loan = models.ForeignKey(
        RepositoryCredentialLoan, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="usage_logs", verbose_name="借用记录",
    )
    product = models.ForeignKey(
        "project.Project", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="credential_usage_logs", verbose_name="产品",
    )
    repository = models.ForeignKey(
        "repository.Repository", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="credential_usage_logs", verbose_name="仓库",
    )
    product_component = models.ForeignKey(
        "project.ProductComponent", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="credential_usage_logs", verbose_name="产品组件",
    )
    operation = models.CharField(max_length=50, verbose_name="操作")
    result = models.CharField(max_length=20, choices=RESULT_CHOICES, verbose_name="结果")
    failure_reason = models.TextField(blank=True, verbose_name="失败原因")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="使用时间")

    class Meta:
        db_table = "credential_usage_log"
        verbose_name = "凭证使用审计"
        verbose_name_plural = "凭证使用审计"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["credential", "created_at"]),
            models.Index(fields=["product", "created_at"]),
            models.Index(fields=["repository", "created_at"]),
        ]
