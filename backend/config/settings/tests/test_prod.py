"""
生产环境配置测试

验证生产环境配置会拒绝默认密钥、通配 ALLOWED_HOSTS 和允许所有跨域来源等不安全配置。
"""
import importlib
import sys

import pytest
from django.core.exceptions import ImproperlyConfigured


def reload_prod_settings(monkeypatch, **env):
    """
    重新加载生产环境配置模块

    Args:
        monkeypatch: pytest monkeypatch fixture
        **env: 需要设置的环境变量

    Returns:
        重新导入的 prod 配置模块
    """
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    sys.modules.pop("config.settings.base", None)
    sys.modules.pop("config.settings.prod", None)
    return importlib.import_module("config.settings.prod")


def test_prod_rejects_default_secret_key(monkeypatch):
    """生产环境必须修改默认 SECRET_KEY"""
    monkeypatch.setenv("SECRET_KEY", "django-insecure-change-me-in-production")
    monkeypatch.setenv("CREDENTIAL_SECRET_KEY", "secure-credential-key")
    monkeypatch.setenv("ALLOWED_HOSTS", "trace-ship.example.com")
    monkeypatch.setenv("CORS_ALLOW_ALL_ORIGINS", "False")

    with pytest.raises(ImproperlyConfigured, match="SECRET_KEY"):
        reload_prod_settings(monkeypatch)


def test_prod_rejects_default_credential_secret_key(monkeypatch):
    """生产环境必须修改默认 CREDENTIAL_SECRET_KEY"""
    monkeypatch.setenv("SECRET_KEY", "secure-django-key")
    monkeypatch.setenv("CREDENTIAL_SECRET_KEY", "change-me-in-production-32bytes!")
    monkeypatch.setenv("ALLOWED_HOSTS", "trace-ship.example.com")
    monkeypatch.setenv("CORS_ALLOW_ALL_ORIGINS", "False")

    with pytest.raises(ImproperlyConfigured, match="CREDENTIAL_SECRET_KEY"):
        reload_prod_settings(monkeypatch)


def test_prod_rejects_wildcard_allowed_hosts(monkeypatch):
    """生产环境必须显式配置 ALLOWED_HOSTS"""
    monkeypatch.setenv("SECRET_KEY", "secure-django-key")
    monkeypatch.setenv("CREDENTIAL_SECRET_KEY", "secure-credential-key")
    monkeypatch.setenv("ALLOWED_HOSTS", "*")
    monkeypatch.setenv("CORS_ALLOW_ALL_ORIGINS", "False")

    with pytest.raises(ImproperlyConfigured, match="ALLOWED_HOSTS"):
        reload_prod_settings(monkeypatch)


def test_prod_rejects_cors_allow_all(monkeypatch):
    """生产环境禁止 CORS_ALLOW_ALL_ORIGINS"""
    monkeypatch.setenv("SECRET_KEY", "secure-django-key")
    monkeypatch.setenv("CREDENTIAL_SECRET_KEY", "secure-credential-key")
    monkeypatch.setenv("ALLOWED_HOSTS", "trace-ship.example.com")
    monkeypatch.setenv("CORS_ALLOW_ALL_ORIGINS", "True")

    with pytest.raises(ImproperlyConfigured, match="CORS_ALLOW_ALL_ORIGINS"):
        reload_prod_settings(monkeypatch)
