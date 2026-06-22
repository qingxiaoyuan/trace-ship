from .base import *
import os

DEBUG = False

# Security
SECURE_SSL_REDIRECT = os.getenv("SECURE_SSL_REDIRECT", "False").lower() == "true"
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_BROWSER_XSS_FILTER = True
SECURE_CONTENT_TYPE_NOSNIFF = True

CORS_ALLOW_ALL_ORIGINS = False

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
