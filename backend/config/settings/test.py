"""
测试环境配置

继承 base.py，使用 SQLite 内存数据库和本地缓存，加速单元测试。
"""
from .base import *

# 测试环境开启调试模式便于问题排查
DEBUG = True

# 使用 SQLite 内存数据库，避免依赖外部 PostgreSQL
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": ":memory:",
    }
}

# 测试环境仅使用 Django 本地认证
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
]
AUTH_LDAP_SERVER_URI = ""
AUTH_LDAP_BIND_DN = ""
AUTH_LDAP_BIND_PASSWORD = ""
AUTH_LDAP_USER_SEARCH_BASE = ""

# 使用本地内存缓存
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}

# Celery 使用内存消息队列，无需外部 Redis
CELERY_BROKER_URL = "memory://"
CELERY_RESULT_BACKEND = "memory://"

# 测试环境允许所有跨域来源
CORS_ALLOW_ALL_ORIGINS = True

# 使用 MD5 密码哈希器加速测试中的密码处理
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.MD5PasswordHasher",
]

# 关闭日志输出，减少测试噪音
LOGGING = {
    "version": 1,
    "disable_existing_loggers": True,
}
