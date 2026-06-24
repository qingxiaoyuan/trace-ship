#!/usr/bin/env python
"""
Django 命令行工具入口

用于执行 manage.py 命令，默认使用开发环境配置 config.settings.dev。
"""
import os
import sys


def main():
    """
    运行 Django 管理命令

    设置默认 DJANGO_SETTINGS_MODULE 并执行命令行传入的指令。
    """
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
