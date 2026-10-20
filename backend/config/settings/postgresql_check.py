"""仅供一次性隔离容器执行 PostgreSQL 行锁回归，不读取业务数据库配置。"""

import os

from .test import *

if os.environ.get("TRACE_SHIP_POSTGRES_CHECKS") != "1":
    raise RuntimeError("PostgreSQL 检查必须通过隔离检查入口启动")
if not os.environ.get("TRACE_SHIP_POSTGRES_PASSWORD"):
    raise RuntimeError("隔离 PostgreSQL 检查缺少本次临时密码")

# 主机、用户和库名固定到专用 Compose 服务，宿主 DB_* 不参与解析。
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": "trace_ship_checks",
        "USER": "trace_ship_checks",
        "PASSWORD": os.environ["TRACE_SHIP_POSTGRES_PASSWORD"],
        "HOST": "postgres",
        "PORT": "5432",
        "OPTIONS": {"connect_timeout": 5, "options": "-c lock_timeout=12000 -c statement_timeout=30000"},
        "TEST": {"NAME": "trace_ship_checks_test"},
    }
}
