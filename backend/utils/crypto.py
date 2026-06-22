import json
import base64
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def get_fernet():
    """基于 CREDENTIAL_SECRET_KEY 生成 Fernet 实例"""
    key = settings.CREDENTIAL_SECRET_KEY
    if not key:
        raise ValueError("CREDENTIAL_SECRET_KEY is not set")

    # Fernet 要求 32 字节 base64 编码的 key
    key_bytes = key.encode("utf-8")
    if len(key_bytes) < 32:
        key_bytes = key_bytes.ljust(32, b"0")
    elif len(key_bytes) > 32:
        key_bytes = key_bytes[:32]

    fernet_key = base64.urlsafe_b64encode(key_bytes)
    return Fernet(fernet_key)


def encrypt_credential(data: dict) -> str:
    """加密凭证数据"""
    f = get_fernet()
    return f.encrypt(json.dumps(data, ensure_ascii=False).encode("utf-8")).decode("utf-8")


def decrypt_credential(encrypted: str) -> dict:
    """解密凭证数据"""
    f = get_fernet()
    try:
        return json.loads(f.decrypt(encrypted.encode("utf-8")).decode("utf-8"))
    except InvalidToken:
        raise ValueError("凭证解密失败，密钥可能不正确")


def mask_credential(data: str, visible_head: int = 4, visible_tail: int = 4) -> str:
    """脱敏展示"""
    if not data or len(data) <= visible_head + visible_tail:
        return "****"
    return f"{data[:visible_head]}****{data[-visible_tail:]}"
