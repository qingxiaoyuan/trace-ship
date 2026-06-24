"""
开发环境配置

继承 base.py 并开启调试模式、SQL 日志，同时禁用 LDAP 以避免本地安装 python-ldap。
"""
from .base import *

# 开启调试模式
DEBUG = True

# 开发环境允许所有 Host
ALLOWED_HOSTS = ["*"]

# 开发环境允许所有跨域来源
CORS_ALLOW_ALL_ORIGINS = True

# 开发环境不使用 LDAP，避免本地必须安装 python-ldap
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
]
AUTH_LDAP_SERVER_URI = ""
AUTH_LDAP_BIND_DN = ""
AUTH_LDAP_BIND_PASSWORD = ""
AUTH_LDAP_USER_SEARCH_BASE = ""

# 开发环境日志：同时输出 INFO 级别日志和 SQL 调试日志
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
    "loggers": {
        "django.db.backends": {
            "handlers": ["console"],
            "level": "DEBUG",
            "propagate": False,
        },
    },
}
