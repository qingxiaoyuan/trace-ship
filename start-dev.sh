#!/bin/bash
# 本地开发一键启动脚本：同时启动 Django 后端和 React 前端

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

# 如果已经启动过，先停止旧进程
if [ -f "$LOG_DIR/backend.pid" ] || [ -f "$LOG_DIR/frontend.pid" ]; then
  echo "检测到已有进程，先执行停止..."
  "$ROOT_DIR/stop-dev.sh" || true
  sleep 1
fi

echo "启动后端 (http://localhost:8000)..."
cd "$ROOT_DIR/backend"
export DJANGO_SETTINGS_MODULE=config.settings.dev
nohup python manage.py runserver 0.0.0.0:8000 > "$LOG_DIR/backend.log" 2>&1 &
echo $! > "$LOG_DIR/backend.pid"

echo "启动前端 (http://localhost:5173)..."
cd "$ROOT_DIR/frontend"
nohup npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
echo $! > "$LOG_DIR/frontend.pid"

echo ""
echo "启动完成："
echo "  后端: http://localhost:8000  日志: $LOG_DIR/backend.log"
echo "  前端: http://localhost:5173  日志: $LOG_DIR/frontend.log"
echo ""
echo "查看实时日志："
echo "  tail -f $LOG_DIR/backend.log"
echo "  tail -f $LOG_DIR/frontend.log"
echo ""
echo "停止服务："
echo "  ./stop-dev.sh"
