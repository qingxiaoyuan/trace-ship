import importlib
import sys

import pytest
from django.core.exceptions import ImproperlyConfigured


def reload_prod_settings(monkeypatch, **env):
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    sys.modules.pop("config.settings.base", None)
    sys.modules.pop("config.settings.prod", None)
    return importlib.import_module("config.settings.prod")


def test_prod_rejects_default_secret_key(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "django-insecure-change-me-in-production")
    monkeypatch.setenv("CREDENTIAL_SECRET_KEY", "secure-credential-key")
    monkeypatch.setenv("ALLOWED_HOSTS", "trace-ship.example.com")
    monkeypatch.setenv("CORS_ALLOW_ALL_ORIGINS", "False")

    with pytest.raises(ImproperlyConfigured, match="SECRET_KEY"):
        reload_prod_settings(monkeypatch)


def test_prod_rejects_default_credential_secret_key(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "secure-django-key")
    monkeypatch.setenv("CREDENTIAL_SECRET_KEY", "change-me-in-production-32bytes!")
    monkeypatch.setenv("ALLOWED_HOSTS", "trace-ship.example.com")
    monkeypatch.setenv("CORS_ALLOW_ALL_ORIGINS", "False")

    with pytest.raises(ImproperlyConfigured, match="CREDENTIAL_SECRET_KEY"):
        reload_prod_settings(monkeypatch)


def test_prod_rejects_wildcard_allowed_hosts(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "secure-django-key")
    monkeypatch.setenv("CREDENTIAL_SECRET_KEY", "secure-credential-key")
    monkeypatch.setenv("ALLOWED_HOSTS", "*")
    monkeypatch.setenv("CORS_ALLOW_ALL_ORIGINS", "False")

    with pytest.raises(ImproperlyConfigured, match="ALLOWED_HOSTS"):
        reload_prod_settings(monkeypatch)


def test_prod_rejects_cors_allow_all(monkeypatch):
    monkeypatch.setenv("SECRET_KEY", "secure-django-key")
    monkeypatch.setenv("CREDENTIAL_SECRET_KEY", "secure-credential-key")
    monkeypatch.setenv("ALLOWED_HOSTS", "trace-ship.example.com")
    monkeypatch.setenv("CORS_ALLOW_ALL_ORIGINS", "True")

    with pytest.raises(ImproperlyConfigured, match="CORS_ALLOW_ALL_ORIGINS"):
        reload_prod_settings(monkeypatch)
