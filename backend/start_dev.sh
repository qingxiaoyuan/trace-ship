#!/bin/bash
# Trace Ship 本地开发启动脚本
# 依赖：PostgreSQL、Redis 已通过 brew services 启动

set -e

cd "$(dirname "$0")"

# 激活虚拟环境
source .venv/bin/activate

# 环境变量
export DJANGO_SETTINGS_MODULE=config.settings.dev
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=release_manager
export DB_USER=release_manager
export DB_PASSWORD=ReleaseManager@2024
export REDIS_HOST=localhost
export REDIS_PORT=6379
export REDIS_PASSWORD=ReleaseManager@2024
export SECRET_KEY=django-insecure-change-me-in-production
export CREDENTIAL_SECRET_KEY=change-me-in-production-32bytes!

# 检查 PostgreSQL
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1; do
  echo "等待 PostgreSQL 就绪..."
  sleep 1
done

# 检查 Redis
until redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" ping >/dev/null 2>&1; do
  echo "等待 Redis 就绪..."
  sleep 1
done

# 执行迁移
echo "执行数据库迁移..."
python manage.py migrate > /dev/null

# 启动开发服务器（使用 8001 端口，避免与 Docker Desktop 默认 8000 冲突）
echo "启动 Django 开发服务器: http://localhost:8001"
python manage.py runserver 0.0.0.0:8001
