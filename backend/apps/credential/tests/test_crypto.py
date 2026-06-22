import pytest
from utils.crypto import encrypt_credential, decrypt_credential, mask_credential


def test_encrypt_decrypt():
    data = {"token": "glpat-xxxxxxxxxxxx"}
    encrypted = encrypt_credential(data)
    assert encrypted != str(data)
    decrypted = decrypt_credential(encrypted)
    assert decrypted == data


def test_mask_credential():
    assert mask_credential("glpat-abcdef123456") == "glpa****3456"
    assert mask_credential("short") == "****"
    assert mask_credential("") == "****"
