"""
凭证加密工具测试

覆盖 encrypt/decrypt 完整性和 mask_credential 脱敏规则。
"""
import pytest
from utils.crypto import encrypt_credential, decrypt_credential, mask_credential


def test_encrypt_decrypt():
    """
    测试凭证加密后可正确解密
    """
    data = {"token": "glpat-xxxxxxxxxxxx"}
    encrypted = encrypt_credential(data)
    assert encrypted != str(data)
    decrypted = decrypt_credential(encrypted)
    assert decrypted == data


def test_mask_credential():
    """
    测试凭证脱敏规则

    期望保留首尾字符，中间替换为 ****；短字符串直接返回 ****。
    """
    assert mask_credential("glpat-abcdef123456") == "glpa****3456"
    assert mask_credential("short") == "****"
    assert mask_credential("") == "****"
