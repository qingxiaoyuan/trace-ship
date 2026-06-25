"""
Celery 应用配置

为异步任务和定时任务提供 Celery app 入口，Django 启动时自动发现任务。
"""
import os
from celery import Celery

# 设置默认 Django 配置模块
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")

# 创建 Celery 应用实例
app = Celery("trace_ship")

# 从 Django 配置中读取 CELERY_* 开头的配置项
app.config_from_object("django.conf:settings", namespace="CELERY")

# 自动发现所有已注册 Django app 中的 tasks.py 任务
app.autodiscover_tasks()
