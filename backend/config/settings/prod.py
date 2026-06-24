from .base import *
import os
from django.core.exceptions import ImproperlyConfigured

DEBUG = False

DEFAULT_SECRET_KEY = "django-insecure-change-me-in-production"
DEFAULT_CREDENTIAL_SECRET_KEY = "change-me-in-production-32bytes!"

if SECRET_KEY == DEFAULT_SECRET_KEY:
    raise ImproperlyConfigured("SECRET_KEY must be changed in production.")

if CREDENTIAL_SECRET_KEY == DEFAULT_CREDENTIAL_SECRET_KEY:
    raise ImproperlyConfigured("CREDENTIAL_SECRET_KEY must be changed in production.")

if ALLOWED_HOSTS == ["*"]:
    raise ImproperlyConfigured("ALLOWED_HOSTS must be explicitly configured in production.")

# Security
SECURE_SSL_REDIRECT = os.getenv("SECURE_SSL_REDIRECT", "False").lower() == "true"
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "True").lower() == "true"
CSRF_COOKIE_SECURE = os.getenv("CSRF_COOKIE_SECURE", "True").lower() == "true"
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True

CORS_ALLOW_ALL_ORIGINS = os.getenv("CORS_ALLOW_ALL_ORIGINS", "False").lower() == "true"
if CORS_ALLOW_ALL_ORIGINS:
    raise ImproperlyConfigured("CORS_ALLOW_ALL_ORIGINS must be disabled in production.")

LOG_FILE = os.getenv("DJANGO_LOG_FILE", "/var/log/trace-ship/django.log")
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": LOG_FILE,
            "maxBytes": 10485760,
            "backupCount": 5,
        },
    },
    "root": {
        "handlers": ["file"],
        "level": "WARNING",
    },
}
