"""
Django 项目基础配置（所有环境共享）

包含数据库、认证、REST Framework、JWT、Celery、Redis、缓存等核心配置。
环境特定覆盖项位于 dev.py / prod.py / test.py。
"""
import os
from datetime import timedelta
from pathlib import Path

from celery.schedules import crontab

# 项目根目录：backend/
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# 安全密钥：生产环境必须通过环境变量注入，不可使用默认值
SECRET_KEY = os.getenv("SECRET_KEY", "django-insecure-change-me-in-production")

# 调试模式：仅开发环境开启
DEBUG = os.getenv("DEBUG", "False").lower() == "true"

# 允许访问的域名列表，逗号分隔
ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "*").split(",")

# Django 应用定义
INSTALLED_APPS = [
    # Django 内置应用
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # 第三方应用
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    "drf_spectacular",
    # 本地业务应用
    "apps.account.apps.AccountConfig",
    "apps.credential.apps.CredentialConfig",
    "apps.project.apps.ProjectConfig",
    "apps.repository.apps.RepositoryConfig",
    "apps.release.apps.ReleaseConfig",
    # Jenkins 模块已下线：仅保留迁移 tombstone（release.0001 历史迁移依赖），
    # 无任何模型、API 与业务逻辑，详见 apps/jenkins/models.py
    "apps.jenkins.apps.JenkinsConfig",
    "apps.package.apps.PackageConfig",
    "apps.system.apps.SystemConfig",
    "apps.workflow.apps.WorkflowConfig",
    "apps.notification.apps.NotificationConfig",
    "apps.feedback.apps.FeedbackConfig",
]

# 中间件：请求/响应依次经过下列中间件处理
MIDDLEWARE = [
    # 跨域中间件（必须放在最前面）
    "corsheaders.middleware.CorsMiddleware",
    # Django 安全中间件
    "django.middleware.security.SecurityMiddleware",
    # 会话中间件
    "django.contrib.sessions.middleware.SessionMiddleware",
    # 通用中间件（URL 重写、Content-Type 等）
    "django.middleware.common.CommonMiddleware",
    # CSRF 校验（前后端分离场景下主要保护 admin 等传统表单）
    "django.middleware.csrf.CsrfViewMiddleware",
    # 认证中间件：将 request.user 注入到请求对象
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # 消息框架中间件
    "django.contrib.messages.middleware.MessageMiddleware",
    # 点击劫持防护
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # 自定义操作日志中间件
    "utils.middleware.OperationLogMiddleware",
    # 自定义异常处理中间件
    "utils.middleware.ExceptionHandlerMiddleware",
]

# 模板引擎配置
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# 根 URL 配置模块
ROOT_URLCONF = "config.urls"

# WSGI 应用入口
WSGI_APPLICATION = "config.wsgi.application"

# 数据库配置（默认 PostgreSQL）
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DB_NAME", "release_manager"),
        "USER": os.getenv("DB_USER", "release_manager"),
        "PASSWORD": os.getenv("DB_PASSWORD", "ReleaseManager@2024"),
        "HOST": os.getenv("DB_HOST", "localhost"),
        "PORT": os.getenv("DB_PORT", "5432"),
    }
}

# 密码校验器（用于创建/修改密码时的复杂度检查）
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# 自定义用户模型（替代 Django 默认 User）
AUTH_USER_MODEL = "account.User"

# LDAP 认证配置
AUTH_LDAP_SERVER_URI = os.getenv("LDAP_SERVER_URI", "")
AUTH_LDAP_BIND_DN = os.getenv("LDAP_BIND_DN", "")
AUTH_LDAP_BIND_PASSWORD = os.getenv("LDAP_BIND_PASSWORD", "")
AUTH_LDAP_USER_SEARCH_BASE = os.getenv("LDAP_USER_SEARCH_BASE", "")
AUTH_LDAP_USER_ATTR_MAP = {
    "first_name": "cn",
    "email": "mail",
}
AUTH_LDAP_ALWAYS_UPDATE_USER = True

# 认证后端：配置了 LDAP 时优先使用 LDAP，否则仅使用 Django 本地认证
if AUTH_LDAP_SERVER_URI and AUTH_LDAP_USER_SEARCH_BASE:
    import ldap
    from django_auth_ldap.config import LDAPSearch
    AUTH_LDAP_USER_SEARCH = LDAPSearch(
        AUTH_LDAP_USER_SEARCH_BASE,
        ldap.SCOPE_SUBTREE,
        "(uid=%(user)s)",
    )
    # ldaps 证书校验策略与 CA 证书（环境变量方式接入时使用，
    # 「系统配置」页面的 ldap_* 键由 apps.account.ldap_config 在登录时动态应用）
    _tls_reqcert_map = {
        "demand": ldap.OPT_X_TLS_DEMAND,
        "allow": ldap.OPT_X_TLS_ALLOW,
        "never": ldap.OPT_X_TLS_NEVER,
        "try": ldap.OPT_X_TLS_TRY,
    }
    _tls_reqcert = os.getenv("LDAP_TLS_REQCERT", "").lower()
    _ca_cert_path = os.getenv("LDAP_CA_CERT_PATH", "")
    if _tls_reqcert in _tls_reqcert_map or _ca_cert_path:
        AUTH_LDAP_CONNECTION_OPTIONS = {}
        if _tls_reqcert in _tls_reqcert_map:
            AUTH_LDAP_CONNECTION_OPTIONS[ldap.OPT_X_TLS_REQUIRE_CERT] = _tls_reqcert_map[_tls_reqcert]
        if _ca_cert_path:
            AUTH_LDAP_CONNECTION_OPTIONS[ldap.OPT_X_TLS_CACERTFILE] = _ca_cert_path
    AUTHENTICATION_BACKENDS = [
        "django_auth_ldap.backend.LDAPBackend",
        "django.contrib.auth.backends.ModelBackend",
    ]
else:
    AUTHENTICATION_BACKENDS = [
        "django.contrib.auth.backends.ModelBackend",
    ]

# 国际化与时区
LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True

# 静态文件配置
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# 模型默认主键类型
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Redis 连接配置
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")
REDIS_DB_CACHE = int(os.getenv("REDIS_DB_CACHE", "1"))
REDIS_DB_CELERY = int(os.getenv("REDIS_DB_CELERY", "0"))
REDIS_DB_BLACKLIST = int(os.getenv("REDIS_DB_BLACKLIST", "2"))

# 拼接 Redis 连接 URL（带密码时格式为 redis://:password@host:port）
_redis_password_part = f":{REDIS_PASSWORD}@" if REDIS_PASSWORD else ""
_redis_base_url = f"redis://{_redis_password_part}{REDIS_HOST}:{REDIS_PORT}"

# Django 缓存后端（使用 Redis）
CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": f"{_redis_base_url}/{REDIS_DB_CACHE}",
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
        },
    }
}

# Celery 配置
CELERY_BROKER_URL = f"{_redis_base_url}/{REDIS_DB_CELERY}"
CELERY_RESULT_BACKEND = f"{_redis_base_url}/{REDIS_DB_CELERY}"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE
CELERY_ENABLE_UTC = True

# Celery beat 定时任务：每个整点清理草稿发布申请
CELERY_BEAT_SCHEDULE = {
    "cleanup-draft-releases-hourly": {
        "task": "apps.release.tasks.cleanup_draft_releases",
        "schedule": crontab(minute=0),
        "args": (),
    },
}

# 发布预览单分支最大提交扫描数（RELEASE_PREVIEW_MAX_COMMITS 可覆盖），默认 10 条以内。
# 方案 A：仅用于在最近 N 条提交中定位上一个 tag；若超出该范围未找到 tag commit，
# 仍回退 compare 接口取 tag 到分支头的完整区间差异，保证结果完整。
RELEASE_PREVIEW_MAX_COMMITS = int(os.getenv("RELEASE_PREVIEW_MAX_COMMITS", "10"))

# 系统内置打包工作区根目录
PACKAGE_WORKSPACE_ROOT = os.getenv("PACKAGE_WORKSPACE_ROOT", str(BASE_DIR / "package_workspaces"))

# Nexus 仓库（Nexus Repository Manager 3.x）连接配置，用于打包镜像选择
NEXUS_BASE_URL = os.getenv("NEXUS_BASE_URL", "")
NEXUS_USERNAME = os.getenv("NEXUS_USERNAME", "")
NEXUS_PASSWORD = os.getenv("NEXUS_PASSWORD", "")
NEXUS_TIMEOUT = int(os.getenv("NEXUS_TIMEOUT", "10"))
# 镜像拉取地址（host:port），通常为 Nexus docker connector 端口；
# 为空时从 NEXUS_BASE_URL 中提取
NEXUS_REGISTRY_HOST = os.getenv("NEXUS_REGISTRY_HOST", "")

# Django REST Framework 全局配置
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # 默认使用 JWT 认证
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        # 默认所有接口需要登录
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "utils.pagination.StandardPagination",
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
        "rest_framework.filters.SearchFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "EXCEPTION_HANDLER": "utils.exceptions.custom_exception_handler",
}

# 文件上传大小限制
# 镜像 tar 包导入（apps.package.views.PackageImageViewSet.import_image）等大文件上传场景，
# 关闭请求体大小检查：nginx 侧通过 client_max_body_size 放开，后端 import_image 流式写盘，不会整包读入内存
DATA_UPLOAD_MAX_MEMORY_SIZE = None

# JWT 认证配置
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=int(os.getenv("JWT_ACCESS_TOKEN_LIFETIME_MINUTES", "60"))),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=int(os.getenv("JWT_REFRESH_TOKEN_LIFETIME_DAYS", "7"))),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# drf-spectacular 自动 API 文档配置
SPECTACULAR_SETTINGS = {
    "TITLE": "Trace Ship API",
    "DESCRIPTION": "软件版本发布管理系统 API",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "COMPONENT_SPLIT_REQUEST": True,
}

# 凭证加密密钥（用于加密存储 Git/SVN/LDAP/AI 等凭据）
CREDENTIAL_SECRET_KEY = os.getenv("CREDENTIAL_SECRET_KEY", "change-me-in-production-32bytes!")

# 跨域资源共享（CORS）配置
CORS_ALLOW_ALL_ORIGINS = os.getenv("CORS_ALLOW_ALL_ORIGINS", "True").lower() == "true"
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

# 日志配置
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
}
