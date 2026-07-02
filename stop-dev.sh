#!/bin/bash
# 停止 start-dev.sh 启动的后端、Celery Worker 和前端进程

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"

stop_service() {
  local service=$1
  local pid_file="$LOG_DIR/$service.pid"

  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    if kill "$pid" 2>/dev/null; then
      echo "已停止 $service (PID: $pid)"
    else
      echo "$service 进程不存在或已退出"
    fi
    rm -f "$pid_file"
  else
    echo "未找到 $service PID 文件，可能未通过 start-dev.sh 启动"
  fi
}

stop_service "backend"
stop_service "celery"
stop_service "frontend"

echo ""
echo "如需重新启动，请运行："
echo "  ./start-dev.sh"
