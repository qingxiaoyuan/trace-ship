#!/bin/bash
# ============================================================
# Trace Ship 内网一键部署脚本（在无外网的服务器执行）
#
# 前提：已用 build.sh 打出发布包并解压，本脚本位于包根目录。
#
# 支持模式：
#   1. 覆盖式全量发布 —— 加载全部镜像，自动生成全新 .env.prod，启动所有服务
#   2. 只更新后端     —— 加载 backend.tar，复用已有 .env.prod，重启后端相关容器
#   3. 只更新前端     —— 加载 frontend.tar，复用已有 .env.prod，重启前端容器
#   4. 前后端一起更新 —— 复用已有 .env.prod，重启前后端容器
#
# 用法：
#   ./deploy.sh              交互式菜单选择
#   ./deploy.sh --full       覆盖式全量发布（自动生成环境变量）
#   ./deploy.sh --backend    只更新后端
#   ./deploy.sh --frontend   只更新前端
#   ./deploy.sh --app        前后端一起更新
#
# 可选环境变量：
#   SERVER_IP=192.168.x.x    覆盖式发布时指定服务器 IP（默认自动探测）
#   FRONTEND_PORT=80         前端对外端口（默认 80）
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
ENV_FILE="${SCRIPT_DIR}/.env.prod"

echo "====================================="
echo "Trace Ship 内网一键部署"
echo "====================================="
echo ""

# ---------- 0. 环境检查 ----------
if ! command -v docker &> /dev/null; then
    echo "❌ 未安装 Docker，请先在内网服务器安装 Docker"
    exit 1
fi
if ! docker compose version &> /dev/null; then
    echo "❌ 未安装 Docker Compose v2"
    exit 1
fi
if [ ! -f "${COMPOSE_FILE}" ]; then
    echo "❌ 未找到 docker-compose.prod.yml，请确认发布包已正确解压"
    exit 1
fi

compose() {
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

# ---------- 1. 选择部署模式 ----------
MODE="${1:-}"
if [ -z "${MODE}" ]; then
    echo "请选择部署模式："
    echo "  1) 覆盖式全量发布（自动生成全新环境变量，适用于首次/整体替换）"
    echo "  2) 只更新后端（复用已有环境变量）"
    echo "  3) 只更新前端（复用已有环境变量）"
    echo "  4) 前后端一起更新（复用已有环境变量）"
    echo ""
    read -rp "请输入编号 [1-4]: " choice
    case "${choice}" in
        1) MODE="--full" ;;
        2) MODE="--backend" ;;
        3) MODE="--frontend" ;;
        4) MODE="--app" ;;
        *) echo "❌ 无效选择"; exit 1 ;;
    esac
fi

case "${MODE}" in
    --full|--backend|--frontend|--app) ;;
    *) echo "❌ 未知参数: ${MODE}（支持 --full/--backend/--frontend/--app）"; exit 1 ;;
esac

# ---------- 2. 加载镜像 ----------
load_tar() {
    local tar="$1"
    if [ -f "images/${tar}" ]; then
        echo "  📦 加载 images/${tar} ..."
        docker load -i "images/${tar}"
    fi
}

echo "📦 [1/3] 加载离线镜像..."
case "${MODE}" in
    --full)
        for tar in images/*.tar; do
            [ -f "${tar}" ] && { echo "  📦 加载 ${tar} ..."; docker load -i "${tar}"; }
        done
        ;;
    --backend)
        load_tar "backend.tar"
        ;;
    --frontend)
        load_tar "frontend.tar"
        ;;
    --app)
        load_tar "backend.tar"
        load_tar "frontend.tar"
        ;;
esac
echo "✅ 镜像加载完成"
echo ""

# ---------- 3. 环境变量处理 ----------
rand_str() {
    head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c "$1"
}

detect_ip() {
    ip route get 1 2>/dev/null | awk '{print $7; exit}' \
        || hostname -I 2>/dev/null | awk '{print $1}' \
        || echo "127.0.0.1"
}

if [ "${MODE}" = "--full" ]; then
    echo "🔧 [2/3] 覆盖式发布：自动生成全新 .env.prod ..."
    if [ -f "${ENV_FILE}" ]; then
        cp "${ENV_FILE}" "${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
        echo "  ℹ️  已备份旧 .env.prod"
    fi

    SERVER_IP="${SERVER_IP:-$(detect_ip)}"
    FRONTEND_PORT="${FRONTEND_PORT:-80}"
    PACKAGE_WORKSPACE_ROOT="${PACKAGE_WORKSPACE_ROOT:-/data/trace-ship/package_workspaces}"
    if [ "${FRONTEND_PORT}" = "80" ]; then
        FRONTEND_ORIGIN="http://${SERVER_IP}"
    else
        FRONTEND_ORIGIN="http://${SERVER_IP}:${FRONTEND_PORT}"
    fi

    POSTGRES_PASSWORD="$(rand_str 24)"
    REDIS_PASSWORD="$(rand_str 24)"
    DJANGO_SECRET_KEY="$(rand_str 50)"
    CREDENTIAL_SECRET_KEY="$(rand_str 32)"

    cat > "${ENV_FILE}" <<EOF
# Trace Ship 生产环境配置（由 deploy.sh 于 $(date '+%Y-%m-%d %H:%M:%S') 自动生成）
COMPOSE_PROJECT_NAME=trace-ship
TIMEZONE=Asia/Shanghai
IMAGE_PREFIX=

POSTGRES_VERSION=16
POSTGRES_DB=release_manager
POSTGRES_USER=release_manager
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

REDIS_VERSION=7
REDIS_PASSWORD=${REDIS_PASSWORD}

DJANGO_SECRET_KEY=${DJANGO_SECRET_KEY}
CREDENTIAL_SECRET_KEY=${CREDENTIAL_SECRET_KEY}

ALLOWED_HOSTS=${SERVER_IP},backend,localhost,127.0.0.1
CORS_ALLOW_ALL_ORIGINS=False
CORS_ALLOWED_ORIGINS=${FRONTEND_ORIGIN}

FRONTEND_PORT=${FRONTEND_PORT}

PACKAGE_WORKSPACE_ROOT=${PACKAGE_WORKSPACE_ROOT}

# LDAP（可选，取消注释并填写后启用 LDAP 认证）
# LDAP_SERVER_URI=ldap://openldap:389
# LDAP_BIND_DN=cn=admin,dc=example,dc=com
# LDAP_BIND_PASSWORD=
# LDAP_USER_SEARCH_BASE=ou=users,dc=example,dc=com

# Nexus 仓库连接（打包镜像选择使用，可选）
NEXUS_BASE_URL=
NEXUS_USERNAME=
NEXUS_PASSWORD=
NEXUS_REGISTRY_HOST=
EOF

    mkdir -p "${PACKAGE_WORKSPACE_ROOT}"
    echo "✅ 已生成 .env.prod（服务器 IP: ${SERVER_IP}，密钥/密码均已随机生成）"
else
    echo "🔧 [2/3] 更新发布：复用已有 .env.prod"
    if [ ! -f "${ENV_FILE}" ]; then
        echo "❌ 未找到 .env.prod，更新发布要求先完成过一次全量发布"
        echo "   如需首次部署，请选择覆盖式全量发布：./deploy.sh --full"
        exit 1
    fi
fi

# 加载配置
set -a
source "${ENV_FILE}"
set +a
mkdir -p "${PACKAGE_WORKSPACE_ROOT:-/data/trace-ship/package_workspaces}"

# ---------- 4. 启动/更新服务 ----------
echo ""
echo "🚀 [3/3] 启动服务..."
case "${MODE}" in
    --full)
        compose up -d
        ;;
    --backend)
        compose up -d --no-deps --force-recreate backend celery-worker celery-beat
        ;;
    --frontend)
        compose up -d --no-deps --force-recreate frontend
        ;;
    --app)
        compose up -d --no-deps --force-recreate backend celery-worker celery-beat frontend
        ;;
esac

echo ""
echo "⏳ 等待服务就绪..."
sleep 5

# 健康检查（最多等待 90 秒，后端启动会自动执行数据库迁移）
BACKEND_OK=0
for i in $(seq 1 30); do
    if compose exec -T backend \
        sh -c "curl -sf http://localhost:8000/health/ >/dev/null 2>&1" 2>/dev/null; then
        BACKEND_OK=1
        break
    fi
    sleep 3
done

echo ""
echo "====================================="
if [ ${BACKEND_OK} -eq 1 ]; then
    echo "✅ 部署完成，后端健康检查通过"
else
    echo "⚠️  服务已启动，但后端健康检查未通过，请查看日志排查"
fi
echo "====================================="
echo ""
FRONTEND_URL="http://${ALLOWED_HOSTS%%,*}"
[ "${FRONTEND_PORT:-80}" != "80" ] && FRONTEND_URL="${FRONTEND_URL}:${FRONTEND_PORT}"
echo "🌐 前端访问: ${FRONTEND_URL}"
echo "   默认账号: admin / admin@123  (请尽快登录修改)"
echo ""
echo "📋 服务状态:"
compose ps
echo ""
echo "常用命令："
echo "  查看日志:   docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f backend"
echo "  重启服务:   docker compose --env-file .env.prod -f docker-compose.prod.yml restart"
echo "  停止服务:   docker compose --env-file .env.prod -f docker-compose.prod.yml down"
echo ""
