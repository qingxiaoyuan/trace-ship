"""
配置包

包含 Django  settings、WSGI/ASGI 入口、Celery 配置以及根路由。
"""

from .celery import app as celery_app

__all__ = ("celery_app",)
