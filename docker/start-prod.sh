#!/bin/bash
# Trace Ship 生产环境一键部署脚本
# 分两段启动：先数据层（docker-compose.deps.yml: postgres / redis / gitlab），
# 待 PostgreSQL / Redis 健康后再启动应用层（docker-compose.prod.yml: backend / frontend / celery）
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

echo "====================================="
echo "Trace Ship 生产环境部署"
echo "====================================="
echo ""

# 检查 Docker 环境
if ! command -v docker &> /dev/null; then
    echo "❌ 未安装 Docker，请先安装"
    exit 1
fi
if ! docker compose version &> /dev/null; then
    echo "❌ 未安装 Docker Compose v2，请先安装"
    exit 1
fi

# 检查 .env.prod 是否存在；本地首次运行可自动生成，生产环境建议手动配置
if [ ! -f .env.prod ]; then
    if [ "$1" = "--auto-env" ] || [ -t 0 ]; then
        echo "ℹ️  未找到 .env.prod，将基于模板自动生成本地配置（随机密钥）..."
        echo ""

        rand_str() {
            head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c "$1"
        }

        detect_ip() {
            ip route get 1 2>/dev/null | awk '{print $7; exit}' \
                || hostname -I 2>/dev/null | awk '{print $1}' \
                || echo "127.0.0.1"
        }

        DETECTED_IP="$(detect_ip)"
        SERVER_IP="${SERVER_IP:-${DETECTED_IP}}"
        FRONTEND_PORT="${FRONTEND_PORT:-80}"
        if [ "${FRONTEND_PORT}" = "80" ]; then
            FRONTEND_ORIGIN="http://${SERVER_IP}"
        else
            FRONTEND_ORIGIN="http://${SERVER_IP}:${FRONTEND_PORT}"
        fi
        PACKAGE_WORKSPACE_ROOT="${PACKAGE_WORKSPACE_ROOT:-/data/trace-ship/package_workspaces}"

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

        cat > .env.prod <<EOF
# Trace Ship 生产环境配置（由 start-prod.sh 于 $(date '+%Y-%m-%d %H:%M:%S') 自动生成）
COMPOSE_PROJECT_NAME=trace-ship
TIMEZONE=Asia/Shanghai
IMAGE_PREFIX=

POSTGRES_VERSION=${POSTGRES_VERSION}
POSTGRES_DB=release_manager
POSTGRES_USER=release_manager
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

REDIS_VERSION=${REDIS_VERSION}
REDIS_PASSWORD=${REDIS_PASSWORD}

GITLAB_IMAGE=gitlab/gitlab-ce
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

# LDAP（可选）
# LDAP_SERVER_URI=ldap://your-ldap-server:389
# LDAP_BIND_DN=cn=admin,dc=example,dc=com
# LDAP_BIND_PASSWORD=
# LDAP_USER_SEARCH_BASE=ou=users,dc=example,dc=com

# Nexus（可选）
# NEXUS_BASE_URL=http://your-nexus-server:8081
# NEXUS_USERNAME=
# NEXUS_PASSWORD=
# NEXUS_REGISTRY_HOST=
EOF
        echo "✅ .env.prod 已生成"
        echo ""
    else
        echo "❌ 未找到 .env.prod 配置文件"
        echo ""
        echo "请先复制模板并填写真实配置："
        echo "  cp .env.prod.example .env.prod"
        echo "  vi .env.prod"
        echo ""
        echo "或在本地首次运行时让脚本自动生成："
        echo "  ./start-prod.sh --auto-env"
        exit 1
    fi
fi

# 加载并校验关键变量
set -a
source .env.prod
set +a

# ---------- 清理环境 ----------
if [ "$1" = "--clean" ]; then
    shift
    force="${1:-}"
    echo "====================================="
    echo "⚠️  即将清理 Trace Ship 本地生产环境"
    echo "====================================="
    echo ""
    echo "本次操作将删除以下内容（数据不可恢复）："
    echo "  - 应用层容器（backend / frontend / celery-worker / celery-beat）"
    echo "  - 数据层容器（postgres / redis / gitlab）"
    echo "  - 命名数据卷（trace-ship-postgres-data / trace-ship-redis-data / trace-ship-gitlab-*）"
    echo "  - 配置文件 .env.prod"
    echo ""

    if [ "${force}" != "--force" ]; then
        read -rp "确认清理? 输入 yes 继续: " confirm
        if [ "${confirm}" != "yes" ]; then
            echo "👋 已取消清理"
            exit 0
        fi
    fi

    echo "🧹 停止并移除应用层服务..."
    docker compose --env-file .env.prod -f docker-compose.prod.yml down --volumes --remove-orphans 2>/dev/null || true

    echo "🧹 停止并移除数据层服务..."
    docker compose --env-file .env.prod -f docker-compose.deps.yml down --volumes --remove-orphans 2>/dev/null || true

    echo "🧹 删除命名数据卷..."
    for vol in trace-ship-postgres-data trace-ship-redis-data trace-ship-gitlab-config trace-ship-gitlab-logs trace-ship-gitlab-data trace-ship-backend-logs trace-ship-celerybeat-data; do
        if docker volume inspect "${vol}" >/dev/null 2>&1; then
            docker volume rm "${vol}" 2>/dev/null || true
            echo "  已删除卷: ${vol}"
        fi
    done

    if [ -f .env.prod ]; then
        rm -f .env.prod
        echo "🧹 已删除 .env.prod"
    fi

    echo ""
    echo "✅ 清理完成，可重新执行 ./start-prod.sh --build 进行全新部署"
    exit 0
fi

if [[ -z "${DJANGO_SECRET_KEY}" ]] || [[ "${DJANGO_SECRET_KEY}" == must-replace-* ]]; then
    echo "❌ .env.prod 中 DJANGO_SECRET_KEY 未修改，请生成随机强密钥"
    exit 1
fi
if [[ -z "${CREDENTIAL_SECRET_KEY}" ]] || [[ "${CREDENTIAL_SECRET_KEY}" == must-replace-* ]]; then
    echo "❌ .env.prod 中 CREDENTIAL_SECRET_KEY 未修改，请生成 32 字节随机密钥"
    exit 1
fi
if [[ "${ALLOWED_HOSTS}" == *YOUR_SERVER_IP* ]]; then
    echo "❌ .env.prod 中 ALLOWED_HOSTS 仍包含占位符 YOUR_SERVER_IP，请填写真实服务器 IP"
    exit 1
fi
if [[ "${CORS_ALLOWED_ORIGINS}" == *YOUR_SERVER_IP* ]]; then
    echo "❌ .env.prod 中 CORS_ALLOWED_ORIGINS 仍包含占位符 YOUR_SERVER_IP，请填写真实服务器 IP"
    exit 1
fi
if [[ "${POSTGRES_PASSWORD}" == ChangeMe_* ]] || [[ "${REDIS_PASSWORD}" == ChangeMe_* ]]; then
    echo "⚠️ 警告：POSTGRES_PASSWORD / REDIS_PASSWORD 仍为模板默认值，建议修改为强密码"
fi

if [[ -z "${GITLAB_ROOT_PASSWORD}" ]] || [[ "${GITLAB_ROOT_PASSWORD}" == ChangeMe_* ]]; then
    echo "⚠️ 警告：GITLAB_ROOT_PASSWORD 未设置或仍为模板默认值，建议修改为强密码"
fi
if [[ "${GITLAB_EXTERNAL_URL}" == *YOUR_SERVER_IP* ]]; then
    echo "⚠️ 警告：GITLAB_EXTERNAL_URL 仍包含占位符 YOUR_SERVER_IP，GitLab 克隆链接将无法正确使用"
fi

if [[ -z "${PACKAGE_WORKSPACE_ROOT}" ]]; then
    echo "❌ .env.prod 中 PACKAGE_WORKSPACE_ROOT 未设置"
    exit 1
fi

# 创建打包工作区目录（DooD 下宿主机与容器共用同一路径）
mkdir -p "${PACKAGE_WORKSPACE_ROOT}"
echo "✅ 打包工作区目录: ${PACKAGE_WORKSPACE_ROOT}"

echo "✅ 配置校验通过"
echo ""

# 构建/启动：传入 --build 或镜像不存在时才构建；离线环境加载镜像后不会触发构建
if [ "$1" = "--build" ] || [ "$1" = "--auto-env" ] || ! docker image inspect trace-ship/backend:latest >/dev/null 2>&1; then
    echo "🚀 构建镜像（首次构建需要数分钟）..."
    docker compose --env-file .env.prod -f docker-compose.prod.yml build
fi

echo "🚀 [1/2] 启动第三方依赖（PostgreSQL / Redis / GitLab）..."
docker compose --env-file .env.prod -f docker-compose.deps.yml up -d

echo "⏳ 等待 PostgreSQL / Redis 健康检查通过..."
docker compose --env-file .env.prod -f docker-compose.deps.yml up -d --wait postgres redis

echo "🚀 [2/2] 启动应用服务（Backend / Frontend / Celery）..."
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d

echo ""
echo "====================================="
echo "✅ 生产服务已启动"
echo "====================================="
echo ""
echo "🌐 前端访问地址: http://${ALLOWED_HOSTS%%,*}:${FRONTEND_PORT:-80}"
echo ""
echo "🦊 GitLab 访问地址: http://${ALLOWED_HOSTS%%,*}:${GITLAB_HTTP_PORT:-18929}"
echo "   注意: GitLab 首次启动需等待数分钟，可执行以下命令观察："
echo "   docker compose -f docker-compose.deps.yml logs -f gitlab"
echo ""
echo "常用命令（应用层，日常运维主要操作这个）："
echo "  查看后端日志:   docker compose -f docker-compose.prod.yml logs -f backend"
echo "  查看所有日志:   docker compose -f docker-compose.prod.yml logs -f"
echo "  查看服务状态:   docker compose -f docker-compose.prod.yml ps"
echo "  停止应用服务:   docker compose -f docker-compose.prod.yml down"
echo "  重新构建并启动: ./start-prod.sh --build"
echo ""
echo "数据层命令（改动极少，谨慎操作）："
echo "  查看依赖状态:   docker compose -f docker-compose.deps.yml ps"
echo "  停止依赖服务:   docker compose -f docker-compose.deps.yml down"
echo "====================================="
