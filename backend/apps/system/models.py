"""
系统管理数据模型

包含系统参数（SystemConfig）、操作日志（OperationLog）和开放接口访问令牌（AccessToken）。
"""
import hashlib
import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class SystemConfig(models.Model):
    """
    系统参数模型

    用于存储 key-value 形式的系统级配置，可配置是否公开。

    Attributes:
        id: UUID 主键
        key: 配置键（唯一）
        value: 配置值
        description: 说明
        is_public: 是否公开
        created_at: 创建时间
        updated_at: 更新时间
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=200, unique=True, verbose_name="配置键")
    value = models.TextField(verbose_name="配置值")
    description = models.TextField(blank=True, verbose_name="说明")
    is_public = models.BooleanField(default=False, verbose_name="是否公开")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "sys_config"
        verbose_name = "系统参数"

    def __str__(self) -> str:
        """返回配置键"""
        return self.key


class OperationLog(models.Model):
    """
    操作日志模型

    记录用户关键操作，用于审计和排查。

    Attributes:
        id: UUID 主键
        user: 操作用户
        module: 模块
        action: 动作
        resource_type: 资源类型
        resource_id: 资源 ID
        detail: 详情（JSON）
        ip: 客户端 IP
        created_at: 操作时间
    """

    RESULT_CHOICES = [
        ("success", "成功"),
        ("failure", "失败"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="operation_logs",
        verbose_name="用户",
    )
    module = models.CharField(max_length=100, verbose_name="模块")
    action = models.CharField(max_length=100, verbose_name="动作")
    resource_type = models.CharField(max_length=100, verbose_name="资源类型")
    resource_id = models.CharField(max_length=200, blank=True, verbose_name="资源ID")
    detail = models.JSONField(default=dict, verbose_name="详情")
    result = models.CharField(
        max_length=20,
        choices=RESULT_CHOICES,
        default="success",
        verbose_name="结果",
    )
    description = models.CharField(max_length=500, blank=True, verbose_name="操作描述")
    ip = models.CharField(max_length=100, blank=True, verbose_name="IP地址")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="操作时间")

    class Meta:
        db_table = "sys_operation_log"
        verbose_name = "操作日志"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        """返回用户-模块-动作描述"""
        return f"{self.user} - {self.module}.{self.action}"


# 开放接口 scope 编码常量：AccessToken.scopes 的合法取值，新增开放接口时同步扩充
OPEN_API_SCOPES = {
    "release.doc": "按 tag 查询发布变更文档",
    "repo.compare": "查询两个 tag 之间的 commits 与 MRs",
}


class AccessToken(models.Model):
    """
    开放接口访问令牌（类 GitLab Access Token）

    供外部系统调用 /api/open/ 下的只读接口，由超管签发，
    通过 scopes 限定可调用的接口范围。token 不明文落库，仅存 SHA-256 哈希，
    明文仅在创建时返回一次。

    Attributes:
        id: UUID 主键
        name: 接入方/用途名称
        token_hash: token 的 SHA-256 值
        token_prefix: token 前 8 位明文，用于列表脱敏展示
        scopes: 允许访问的开放接口编码列表（OPEN_API_SCOPES 子集）
        is_active: 是否启用（禁用即吊销）
        expires_at: 过期时间（空 = 永久）
        last_used_at / last_used_ip: 最近使用时间与来源 IP
        remark: 备注
        created_by: 创建人
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, verbose_name="名称")
    token_hash = models.CharField(max_length=64, unique=True, editable=False, verbose_name="Token哈希")
    token_prefix = models.CharField(max_length=16, editable=False, verbose_name="Token前缀")
    scopes = models.JSONField(default=list, verbose_name="接口范围")
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    expires_at = models.DateTimeField(null=True, blank=True, verbose_name="过期时间")
    last_used_at = models.DateTimeField(null=True, blank=True, verbose_name="最近使用时间")
    last_used_ip = models.CharField(max_length=100, blank=True, verbose_name="最近使用IP")
    remark = models.CharField(max_length=500, blank=True, verbose_name="备注")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="access_tokens",
        verbose_name="创建人",
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="创建时间")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="更新时间")

    class Meta:
        db_table = "sys_access_token"
        verbose_name = "访问令牌"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        """返回令牌名称与前缀"""
        return f"{self.name} ({self.token_prefix}…)"

    @staticmethod
    def generate_token() -> str:
        """生成明文 token：tsat_ 前缀 + 32 位十六进制随机串"""
        return f"tsat_{secrets.token_hex(16)}"

    @staticmethod
    def hash_token(token: str) -> str:
        """计算 token 的 SHA-256 值（高熵随机串无需慢哈希）"""
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def set_token(self, token: str) -> None:
        """写入 token 哈希与展示前缀（不明文落库）"""
        self.token_hash = self.hash_token(token)
        self.token_prefix = token[:8]

    @property
    def is_expired(self) -> bool:
        """是否已过期（expires_at 为空视为永久有效）"""
        return bool(self.expires_at and self.expires_at <= timezone.now())
