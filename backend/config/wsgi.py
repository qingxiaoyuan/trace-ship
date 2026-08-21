"""
WSGI 入口文件

生产环境部署时（如 Gunicorn/uWSGI）通过此入口加载 Django 应用。
默认使用生产环境配置 config.settings.prod。
"""
import os

from django.core.wsgi import get_wsgi_application

# 设置默认环境变量为生产配置
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.prod")

# WSGI 应用对象
application = get_wsgi_application()
