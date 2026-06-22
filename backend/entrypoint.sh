#!/bin/bash
set -e

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

# 执行迁移
echo "Running migrations..."
python manage.py migrate

# 初始化基础数据
echo "Initializing base data..."
python manage.py init_base_data

# 收集静态文件
echo "Collecting static files..."
python manage.py collectstatic --noinput

# 执行传入的命令
exec "$@"
