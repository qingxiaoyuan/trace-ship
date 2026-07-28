#!/bin/bash
set -e

# 通过首参判断角色：gunicorn 为后端 Web 角色，负责迁移与基础数据初始化；
# celery worker/beat 跳过迁移并等待后端健康，避免多容器并发迁移触发
# django_migrations 表/序列重复键竞态（空库首启时尤甚）。
IS_WEB_ROLE=0
if [ "$1" = "gunicorn" ]; then
    IS_WEB_ROLE=1
fi

# 等待 PostgreSQL 就绪
echo "Waiting for PostgreSQL..."
until pg_isready -h "${DB_HOST:-postgres}" -p "${DB_PORT:-5432}" -U "${DB_USER:-release_manager}"; do
  sleep 1
done
echo "PostgreSQL is ready."

# 等待 Redis 就绪
echo "Waiting for Redis..."
if [ -n "${REDIS_PASSWORD:-}" ]; then
  until redis-cli -h "${REDIS_HOST:-redis}" -p "${REDIS_PORT:-6379}" -a "${REDIS_PASSWORD}" ping | grep -q PONG; do
    sleep 1
  done
else
  until redis-cli -h "${REDIS_HOST:-redis}" -p "${REDIS_PORT:-6379}" ping | grep -q PONG; do
    sleep 1
  done
fi
echo "Redis is ready."

if [ "${IS_WEB_ROLE}" = "1" ]; then
    # 仅后端执行迁移
    echo "Running migrations..."
    python manage.py migrate

    # 初始化基础数据
    echo "Initializing base data..."
    python manage.py init_base_data

    # 收集静态文件
    echo "Collecting static files..."
    python manage.py collectstatic --noinput
else
    # celery 角色等待后端健康（确保表结构初始化完成后再连库消费任务）
    BACKEND_HEALTH_URL="http://backend:8000/health/"
    echo "Waiting for backend ${BACKEND_HEALTH_URL} to be ready..."
    for i in $(seq 1 120); do
        if curl -sf "${BACKEND_HEALTH_URL}" >/dev/null 2>&1; then
            echo "Backend is ready."
            break
        fi
        if [ "$i" = "120" ]; then
            echo "⚠️  等待后端健康超时（240s），继续启动 celery（可能因表未就绪而报错）"
        fi
        sleep 2
    done
fi

# 执行传入的命令
exec "$@"
