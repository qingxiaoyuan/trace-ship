"""
生产环境配置

继承 base.py 并关闭调试模式，启用安全校验和文件日志。
"""
from .base import *
import os
from django.core.exceptions import ImproperlyConfigured

# 生产环境关闭调试模式
DEBUG = False

# 默认弱密钥（仅用于检查，生产环境必须替换）
DEFAULT_SECRET_KEY = "django-insecure-change-me-in-production"
DEFAULT_CREDENTIAL_SECRET_KEY = "change-me-in-production-32bytes!"

# 校验安全密钥是否已修改
if SECRET_KEY == DEFAULT_SECRET_KEY:
    raise ImproperlyConfigured("SECRET_KEY must be changed in production.")

# 校验凭证加密密钥是否已修改
if CREDENTIAL_SECRET_KEY == DEFAULT_CREDENTIAL_SECRET_KEY:
    raise ImproperlyConfigured("CREDENTIAL_SECRET_KEY must be changed in production.")

# 校验 ALLOWED_HOSTS 是否已显式配置
if ALLOWED_HOSTS == ["*"]:
    raise ImproperlyConfigured("ALLOWED_HOSTS must be explicitly configured in production.")

# 安全相关配置
SECURE_SSL_REDIRECT = os.getenv("SECURE_SSL_REDIRECT", "False").lower() == "true"
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "True").lower() == "true"
CSRF_COOKIE_SECURE = os.getenv("CSRF_COOKIE_SECURE", "True").lower() == "true"
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True

# 生产环境必须显式配置 CORS 来源，不允许全部放行
CORS_ALLOW_ALL_ORIGINS = os.getenv("CORS_ALLOW_ALL_ORIGINS", "False").lower() == "true"
if CORS_ALLOW_ALL_ORIGINS:
    raise ImproperlyConfigured("CORS_ALLOW_ALL_ORIGINS must be disabled in production.")

# 生产环境日志文件路径
LOG_FILE = os.getenv("DJANGO_LOG_FILE", "/var/log/trace-ship/django.log")
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

# 生产环境日志配置：写入文件，只记录 WARNING 及以上级别
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": LOG_FILE,
            "maxBytes": 10485760,  # 单个日志文件 10MB
            "backupCount": 5,       # 保留 5 个备份
        },
    },
    "root": {
        "handlers": ["file"],
        "level": "WARNING",
    },
}
