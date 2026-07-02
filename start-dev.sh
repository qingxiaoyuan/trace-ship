#!/bin/bash
# 本地开发一键启动脚本：同时启动 Django 后端、Celery Worker 和 React 前端

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

# 如果已经启动过，先停止旧进程
if [ -f "$LOG_DIR/backend.pid" ] || [ -f "$LOG_DIR/celery.pid" ] || [ -f "$LOG_DIR/frontend.pid" ]; then
  echo "检测到已有进程，先执行停止..."
  "$ROOT_DIR/stop-dev.sh" || true
  sleep 1
fi

# 端口占用检查
check_port() {
  local port=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof -i ":$port" -sTCP:LISTEN >/dev/null 2>&1 && return 0
  elif command -v ss >/dev/null 2>&1; then
    ss -tln 2>/dev/null | grep -q ":$port " && return 0
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tln 2>/dev/null | grep -q ":$port " && return 0
  fi
  return 1
}

kill_port() {
  local port=$1
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids=$(lsof -t -i ":$port" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "释放端口 $port (PID: $pids)..."
      kill $pids 2>/dev/null || true
      sleep 1
    fi
  fi
}

wait_for_service() {
  local service=$1
  local url=$2
  local timeout=${3:-30}
  local waited=0
  echo -n "等待 $service 启动"
  while [ "$waited" -lt "$timeout" ]; do
    if curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null | grep -qE '^[23]'; then
      echo " 启动成功"
      return 0
    fi
    echo -n "."
    sleep 1
    waited=$((waited + 1))
  done
  echo " 启动失败"
  return 1
}

# ========== 启动后端 ==========
echo "启动后端 (http://localhost:8000)..."
cd "$ROOT_DIR/backend"
export DJANGO_SETTINGS_MODULE=config.settings.dev

# 数据库配置（与 docker/.env 保持一致）
export DB_HOST="localhost"
export DB_PORT="5432"
export DB_NAME="release_manager"
export DB_USER="release_manager"
export DB_PASSWORD="ReleaseManager@2024"

# Redis 配置（与 docker/.env 保持一致）
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
export REDIS_PASSWORD="ReleaseManager@2024"

# OpenLDAP 配置（与 docker/openldap 容器保持一致）
export LDAP_SERVER_URI="ldap://localhost:389"
export LDAP_BIND_DN="cn=admin,dc=example,dc=com"
export LDAP_BIND_PASSWORD="admin"
export LDAP_USER_SEARCH_BASE="ou=users,dc=example,dc=com"

# 优先使用项目自带的 .venv（Python 3.11）
PYTHON_BIN="$ROOT_DIR/backend/.venv/bin/python"
PIP_BIN="$ROOT_DIR/backend/.venv/bin/pip"

if [ ! -x "$PYTHON_BIN" ] || [ ! -x "$PIP_BIN" ]; then
  echo "未找到完整的本地虚拟环境，尝试创建 .venv..."
  if python3 -m venv "$ROOT_DIR/backend/.venv" >/dev/null 2>&1; then
    PYTHON_BIN="$ROOT_DIR/backend/.venv/bin/python"
    PIP_BIN="$ROOT_DIR/backend/.venv/bin/pip"
  else
    echo "创建 .venv 失败，回退到系统 Python（开发环境）..."
    PYTHON_BIN="python3"
    PIP_BIN="python3 -m pip"
  fi
fi

# 检查并安装后端依赖
if ! "$PYTHON_BIN" -c "import django" >/dev/null 2>&1; then
  echo "后端依赖未安装，正在安装 requirements.txt..."
  # 检测系统 Python 是否为 externally-managed
  if "$PYTHON_BIN" -m pip --version >/dev/null 2>&1 && [ "$PIP_BIN" = "python3 -m pip" ]; then
    if ! "$PYTHON_BIN" -m pip install -r "$ROOT_DIR/backend/requirements.txt" >/dev/null 2>&1; then
      echo "系统 pip 受限，尝试使用 --break-system-packages 安装..."
      "$PYTHON_BIN" -m pip install --break-system-packages -r "$ROOT_DIR/backend/requirements.txt"
    fi
  else
    "$PIP_BIN" install -r "$ROOT_DIR/backend/requirements.txt"
  fi
fi

# 数据库迁移与基础数据
if [ -z "${SKIP_MIGRATE:-}" ]; then
  echo "执行数据库迁移..."
  "$PYTHON_BIN" manage.py migrate
fi
if [ -z "${SKIP_INIT_DATA:-}" ]; then
  echo "初始化基础数据..."
  "$PYTHON_BIN" manage.py init_base_data || true
fi

if check_port 8000; then
  echo "警告：端口 8000 已被占用，尝试释放..."
  kill_port 8000
fi

if check_port 8000; then
  echo "错误：端口 8000 仍被占用，请手动检查"
  exit 1
fi

nohup "$PYTHON_BIN" manage.py runserver 0.0.0.0:8000 > "$LOG_DIR/backend.log" 2>&1 &
echo $! > "$LOG_DIR/backend.pid"

# ========== 启动 Celery ==========
echo "启动 Celery Worker..."
nohup "$PYTHON_BIN" -m celery -A config worker -l info > "$LOG_DIR/celery.log" 2>&1 &
echo $! > "$LOG_DIR/celery.pid"

# ========== 启动前端 ==========
echo "启动前端 (http://localhost:5173)..."
cd "$ROOT_DIR/frontend"

if check_port 5173; then
  echo "警告：端口 5173 已被占用，尝试释放..."
  kill_port 5173
fi

if check_port 5173; then
  echo "错误：端口 5173 仍被占用，请手动检查"
  exit 1
fi

nohup npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
echo $! > "$LOG_DIR/frontend.pid"

# ========== 健康检查 ==========
BACKEND_OK=false
CELERY_OK=false
FRONTEND_OK=false

if wait_for_service "后端" "http://localhost:8000/health/" 30; then
  BACKEND_OK=true
else
  echo "后端启动失败，查看日志: $LOG_DIR/backend.log"
fi

sleep 2
if [ -f "$LOG_DIR/celery.pid" ] && kill -0 "$(cat "$LOG_DIR/celery.pid")" >/dev/null 2>&1; then
  CELERY_OK=true
  echo "Celery Worker 启动成功"
else
  echo "Celery Worker 启动失败，查看日志: $LOG_DIR/celery.log"
fi

if wait_for_service "前端" "http://localhost:5173/" 30; then
  FRONTEND_OK=true
else
  echo "前端启动失败，查看日志: $LOG_DIR/frontend.log"
fi

if [ "$BACKEND_OK" != "true" ] || [ "$CELERY_OK" != "true" ] || [ "$FRONTEND_OK" != "true" ]; then
  echo ""
  echo "部分服务启动失败，正在清理..."
  "$ROOT_DIR/stop-dev.sh" || true
  exit 1
fi

echo ""
echo "启动完成："
echo "  后端: http://localhost:8000  日志: $LOG_DIR/backend.log"
echo "  Celery: Worker 已启动  日志: $LOG_DIR/celery.log"
echo "  前端: http://localhost:5173  日志: $LOG_DIR/frontend.log"
echo ""
echo "查看实时日志："
echo "  tail -f $LOG_DIR/backend.log"
echo "  tail -f $LOG_DIR/celery.log"
echo "  tail -f $LOG_DIR/frontend.log"
echo ""
echo "停止服务："
echo "  ./stop-dev.sh"
