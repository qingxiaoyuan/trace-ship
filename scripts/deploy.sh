#!/bin/bash
# ============================================================
# Trace Ship 内网一键部署脚本（在无外网的服务器执行）
#
# 前提：已用 build.sh 打出发布包并解压，本脚本位于包根目录。
# 每个发布包都自带：images/（镜像 tar）、docker-compose.deps.yml（数据层编排）、
# docker-compose.prod.yml（应用层编排）、.env.prod.example、deploy.sh（本脚本）。
#
# 支持模式：
#   --full       第一次部署 —— 加载包内全部镜像；.env.prod 不存在时自动生成
#                （随机密钥）；存在则复用。包内含依赖镜像（postgres.tar）时
#                先启动第三方依赖组（PostgreSQL / Redis / GitLab）并等待健康；
#                包内含应用镜像时再启动前端 / 后端。
#   --backend    部署后端 —— 加载 backend.tar，重建 backend / celery 容器
#   --frontend   部署前端 —— 加载 frontend.tar，重建 frontend 容器
#   --app        部署前后端 —— 同时更新 backend + frontend
#
# 用法：
#   ./deploy.sh              引导式菜单（推荐）
#   ./deploy.sh --full       第一次部署（自动生成环境变量，交互确认 IP/端口）
#   ./deploy.sh --backend    部署后端
#   ./deploy.sh --frontend   部署前端
#   ./deploy.sh --app        部署前后端
#
# 首次部署（依赖包 + 应用包分开构建时）：
#   tar -xzf trace-ship-release-deps-*.tar.gz
#   tar -xzf trace-ship-release-app-*.tar.gz -C trace-ship-release
#   cd trace-ship-release && ./deploy.sh --full
#
# 可选环境变量：
#   SERVER_IP=192.168.x.x    第一次部署时指定服务器 IP（默认自动探测）
#   FRONTEND_PORT=80         前端对外端口（默认 80）
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
DEPS_COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.deps.yml"
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
if [ ! -f "${COMPOSE_FILE}" ] || [ ! -f "${DEPS_COMPOSE_FILE}" ]; then
    echo "❌ 未找到 docker-compose.prod.yml / docker-compose.deps.yml，请确认发布包已正确解压"
    exit 1
fi

# 应用层编排（backend / frontend / celery）
compose() {
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

# 数据层编排（postgres / redis / gitlab），独立 compose 项目，生命周期与应用隔离
compose_deps() {
    docker compose --env-file "${ENV_FILE}" -f "${DEPS_COMPOSE_FILE}" "$@"
}

# ---------- 1. 选择部署模式 ----------
MODE="${1:-}"
if [ -z "${MODE}" ]; then
    echo "====================================="
    echo "  部署引导"
    echo "====================================="
    echo ""
    echo "请选择部署模式："
    if [ -f "${ENV_FILE}" ]; then
        # 已部署过（.env.prod 存在）：不再提供「第一次部署」，避免误重置环境
        echo "  1) 部署后端（复用已有环境变量）"
        echo "  2) 部署前端（复用已有环境变量）"
        echo "  3) 部署前后端（复用已有环境变量）"
        echo "  0) 退出"
        echo ""
        read -rp "请输入编号 [0-3]: " choice
        case "${choice}" in
            1) MODE="--backend" ;;
            2) MODE="--frontend" ;;
            3) MODE="--app" ;;
            0) echo "👋 已取消"; exit 0 ;;
            *) echo "❌ 无效选择"; exit 1 ;;
        esac
    else
        # 未部署过：只提供「第一次部署」（更新部署依赖 .env.prod，尚不可用）
        echo "  1) 第一次部署（自动生成环境变量，含第三方依赖组）"
        echo "  0) 退出"
        echo ""
        read -rp "请输入编号 [0-1]: " choice
        case "${choice}" in
            1) MODE="--full" ;;
            0) echo "👋 已取消"; exit 0 ;;
            *) echo "❌ 无效选择"; exit 1 ;;
        esac
    fi
fi

case "${MODE}" in
    --full|--backend|--frontend|--app) ;;
    *) echo "❌ 未知参数: ${MODE}（支持 --full/--backend/--frontend/--app）"; exit 1 ;;
esac

# 已部署过时执行 --full 仅提示：.env.prod 复用逻辑本身幂等，允许用于分包追加应用镜像的场景
if [ "${MODE}" = "--full" ] && [ -f "${ENV_FILE}" ]; then
    echo "⚠️  检测到已完成第一次部署（.env.prod 已存在），将复用已有配置继续部署"
fi

# ---------- 2. 加载镜像 ----------
load_tar() {
    local tar="$1"
    if [ -f "images/${tar}" ]; then
        echo "  📦 加载 images/${tar} ..."
        docker load -i "images/${tar}"
    fi
}

echo "📦 [1/4] 加载离线镜像..."
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

if [ -f "${ENV_FILE}" ]; then
    # 已有配置：直接复用（保证分包首次部署、重复执行 --full 时幂等，不会重置数据库密码）
    echo "🔧 [2/4] 复用已有 .env.prod"
elif [ "${MODE}" = "--full" ]; then
    echo "🔧 [2/4] 第一次部署：自动生成全新 .env.prod ..."
    echo ""

    # 交互终端下引导确认关键参数（环境变量已指定时跳过，回车即取默认值）
    DETECTED_IP="$(detect_ip)"
    if [ -z "${SERVER_IP}" ] && [ -t 0 ]; then
        read -rp "  服务器 IP（回车使用自动探测: ${DETECTED_IP}）: " input_ip
        SERVER_IP="${input_ip:-${DETECTED_IP}}"
    else
        SERVER_IP="${SERVER_IP:-${DETECTED_IP}}"
    fi
    if [ -z "${FRONTEND_PORT}" ] && [ -t 0 ]; then
        read -rp "  前端对外端口（回车使用: 80）: " input_port
        FRONTEND_PORT="${input_port:-80}"
    else
        FRONTEND_PORT="${FRONTEND_PORT:-80}"
    fi
    PACKAGE_WORKSPACE_ROOT="${PACKAGE_WORKSPACE_ROOT:-/data/trace-ship/package_workspaces}"
    if [ "${FRONTEND_PORT}" = "80" ]; then
        FRONTEND_ORIGIN="http://${SERVER_IP}"
    else
        FRONTEND_ORIGIN="http://${SERVER_IP}:${FRONTEND_PORT}"
    fi

    # 从发布包 VERSION 文件读取镜像版本（保持与构建时一致）
    if [ -f VERSION ]; then
        POSTGRES_VERSION="$(grep '^POSTGRES_VERSION=' VERSION | cut -d= -f2)"
        REDIS_VERSION="$(grep '^REDIS_VERSION=' VERSION | cut -d= -f2)"
        GITLAB_VERSION="$(grep '^GITLAB_VERSION=' VERSION | cut -d= -f2)"
    fi
    POSTGRES_VERSION="${POSTGRES_VERSION:-16}"
    REDIS_VERSION="${REDIS_VERSION:-7}"
    GITLAB_VERSION="${GITLAB_VERSION:-14.10.5-ce.0}"
    GITLAB_HTTP_PORT="${GITLAB_HTTP_PORT:-18929}"
    GITLAB_SSH_PORT="${GITLAB_SSH_PORT:-2224}"

    POSTGRES_PASSWORD="$(rand_str 24)"
    REDIS_PASSWORD="$(rand_str 24)"
    GITLAB_ROOT_PASSWORD="$(rand_str 20)"
    DJANGO_SECRET_KEY="$(rand_str 50)"
    CREDENTIAL_SECRET_KEY="$(rand_str 32)"

    cat > "${ENV_FILE}" <<EOF
# Trace Ship 生产环境配置（由 deploy.sh 于 $(date '+%Y-%m-%d %H:%M:%S') 自动生成）
COMPOSE_PROJECT_NAME=trace-ship
TIMEZONE=Asia/Shanghai
IMAGE_PREFIX=

POSTGRES_VERSION=${POSTGRES_VERSION}
POSTGRES_DB=release_manager
POSTGRES_USER=release_manager
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

REDIS_VERSION=${REDIS_VERSION}
REDIS_PASSWORD=${REDIS_PASSWORD}

GITLAB_VERSION=${GITLAB_VERSION}
GITLAB_HTTP_PORT=${GITLAB_HTTP_PORT}
GITLAB_SSH_PORT=${GITLAB_SSH_PORT}
GITLAB_ROOT_PASSWORD=${GITLAB_ROOT_PASSWORD}
GITLAB_EXTERNAL_URL=http://${SERVER_IP}:${GITLAB_HTTP_PORT}

DJANGO_SECRET_KEY=${DJANGO_SECRET_KEY}
CREDENTIAL_SECRET_KEY=${CREDENTIAL_SECRET_KEY}

ALLOWED_HOSTS=${SERVER_IP},backend,localhost,127.0.0.1
CORS_ALLOW_ALL_ORIGINS=False
CORS_ALLOWED_ORIGINS=${FRONTEND_ORIGIN}

FRONTEND_PORT=${FRONTEND_PORT}

PACKAGE_WORKSPACE_ROOT=${PACKAGE_WORKSPACE_ROOT}

# 发布预览单分支最大提交扫描数（可选，默认 100）
# RELEASE_PREVIEW_MAX_COMMITS=100

# LDAP（可选，接入外部 LDAP/AD 后取消注释并填写）
# LDAP_SERVER_URI=ldap://your-ldap-server:389
# LDAP_BIND_DN=cn=admin,dc=example,dc=com
# LDAP_BIND_PASSWORD=
# LDAP_USER_SEARCH_BASE=ou=users,dc=example,dc=com

# Nexus 仓库连接（打包镜像选择使用，可选）
NEXUS_BASE_URL=
NEXUS_USERNAME=
NEXUS_PASSWORD=
NEXUS_REGISTRY_HOST=
EOF

    echo "✅ 已生成 .env.prod（服务器 IP: ${SERVER_IP}，密钥/密码均已随机生成）"
    echo "   GitLab 初始 root 密码已随机生成，请查看 .env.prod 中 GITLAB_ROOT_PASSWORD"
else
    echo "❌ 未找到 .env.prod，更新部署需要先完成第一次部署"
    echo "   请先执行第一次部署：./deploy.sh --full"
    exit 1
fi

# 加载配置
set -a
source "${ENV_FILE}"
set +a
mkdir -p "${PACKAGE_WORKSPACE_ROOT:-/data/trace-ship/package_workspaces}"

# ---------- 4. 启动/更新服务 ----------
echo ""
echo "🚀 [3/4] 启动服务..."

# 启动第三方依赖组（PostgreSQL / Redis / GitLab）并等待数据库健康
start_deps() {
    echo "  ▶ 启动第三方依赖组（PostgreSQL / Redis / GitLab）..."
    compose_deps up -d
    echo "  ▶ 等待 PostgreSQL / Redis 健康检查通过..."
    compose_deps up -d --wait postgres redis
}

DEPS_CONTAINER="${COMPOSE_PROJECT_NAME:-trace-ship}-postgres"
case "${MODE}" in
    --full)
        if [ -f images/postgres.tar ]; then
            # 包内含依赖镜像：第一次部署依赖组
            start_deps
        elif docker ps --format "{{.Names}}" | grep -q "^${DEPS_CONTAINER}$"; then
            echo "  ℹ️  依赖组已在运行，跳过（trace-ship-postgres 存活）"
        else
            echo "  ⚠️  包内无依赖镜像且依赖组未运行，跳过依赖启动"
            echo "      请先部署第三方依赖包（build.sh --deps 产物）"
        fi
        # 包内含应用镜像时启动应用层
        if [ -f images/backend.tar ] || [ -f images/frontend.tar ]; then
            echo "  ▶ 启动应用层（Backend / Frontend / Celery）..."
            compose up -d
        else
            echo "  ℹ️  包内无应用镜像，跳过应用启动（应用包请另行部署）"
        fi
        ;;
    --backend|--frontend|--app)
        # 更新部署：依赖组应已在运行，确保其处于启动状态（已运行则为 no-op）
        compose_deps up -d
        case "${MODE}" in
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
        ;;
esac

# ---------- 5. 健康检查（仅在本次启动了后端时执行） ----------
BACKEND_OK=0
if [ "${MODE}" = "--backend" ] || [ "${MODE}" = "--app" ] || [ -f images/backend.tar -a "${MODE}" = "--full" ]; then
    echo ""
    echo "⏳ 等待后端就绪（最多 90 秒，后端启动会自动执行数据库迁移）..."
    sleep 5
    for i in $(seq 1 30); do
        if compose exec -T backend \
            sh -c "curl -sf http://localhost:8000/health/ >/dev/null 2>&1" 2>/dev/null; then
            BACKEND_OK=1
            break
        fi
        sleep 3
    done
else
    BACKEND_OK=2   # 本次未启动后端，跳过检查
fi

echo ""
echo "====================================="
case ${BACKEND_OK} in
    1) echo "✅ 部署完成，后端健康检查通过" ;;
    2) echo "✅ 部署完成" ;;
    0) echo "⚠️  服务已启动，但后端健康检查未通过，请查看日志排查" ;;
esac
echo "====================================="
echo ""
FRONTEND_URL="http://${ALLOWED_HOSTS%%,*}"
[ "${FRONTEND_PORT:-80}" != "80" ] && FRONTEND_URL="${FRONTEND_URL}:${FRONTEND_PORT}"
echo "🌐 前端访问: ${FRONTEND_URL}"
echo "   默认账号: admin / admin@123  (请尽快登录修改)"
echo ""
echo "🦊 GitLab 访问: http://${ALLOWED_HOSTS%%,*}:${GITLAB_HTTP_PORT:-18929}"
echo "   管理员账号: root / .env.prod 中 GITLAB_ROOT_PASSWORD（首次启动需等待数分钟）"
echo ""
echo "📋 应用层服务状态:"
compose ps
echo ""
echo "📋 数据层服务状态:"
compose_deps ps
echo ""
echo "常用命令："
echo "  查看日志:     docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f backend"
echo "  重启应用:     docker compose --env-file .env.prod -f docker-compose.prod.yml restart"
echo "  停止应用:     docker compose --env-file .env.prod -f docker-compose.prod.yml down"
echo "  查看数据层:   docker compose --env-file .env.prod -f docker-compose.deps.yml ps"
echo "  停止数据层:   docker compose --env-file .env.prod -f docker-compose.deps.yml down  # ⚠️ 会停数据库/GitLab，谨慎操作"
echo ""
