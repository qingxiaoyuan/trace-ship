#!/bin/bash
# ============================================================
# Trace Ship 发布包构建脚本（在外网/可联网机器执行）
#
# 支持模式：
#   --deps       第三方依赖包 —— postgres + redis + gitlab，用于内网首次部署
#   --backend    后端更新包   —— 仅 backend（含 celery 同镜像）
#   --frontend   前端更新包   —— 仅 frontend
#   --app        应用更新包   —— backend + frontend
#
# 用法：
#   scripts/build.sh              交互式菜单选择
#   scripts/build.sh --deps
#   scripts/build.sh --backend | --frontend | --app
#
# 产出：dist/trace-ship-release-<模式>-<时间戳>.tar.gz
#       每个包都自带 deploy.sh、compose 编排与 .env.prod.example，
#       拷贝到内网服务器解压后用包内 deploy.sh 一键部署。
#
# 首次部署流程：分别构建 --deps 与 --app 两个包，在内网服务器解压到
# 同一目录后执行 ./deploy.sh --full（详见 deploy.sh 头部说明）。
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"
DIST_DIR="${ROOT_DIR}/dist"
COMPOSE_FILE="${DOCKER_DIR}/docker-compose.prod.yml"

cd "${ROOT_DIR}"

echo "====================================="
echo "Trace Ship 发布包构建（外网）"
echo "====================================="
echo ""

# ---------- 0. 环境检查 ----------
if ! command -v docker &> /dev/null; then
    echo "❌ 未安装 Docker"
    exit 1
fi
if ! docker compose version &> /dev/null; then
    echo "❌ 未安装 Docker Compose v2"
    exit 1
fi

# 读取版本配置（优先 .env.prod，其次 .env，最后默认值）
ENV_SRC=""
for f in "${DOCKER_DIR}/.env.prod" "${DOCKER_DIR}/.env"; do
    if [ -f "$f" ]; then
        ENV_SRC="$f"
        break
    fi
done
if [ -n "${ENV_SRC}" ]; then
    set -a
    source "${ENV_SRC}"
    set +a
    echo "ℹ️  版本配置来源: ${ENV_SRC}"
fi
POSTGRES_VERSION="${POSTGRES_VERSION:-16}"
REDIS_VERSION="${REDIS_VERSION:-7}"
GITLAB_VERSION="${GITLAB_VERSION:-14.10.5-ce.0}"
GITLAB_IMAGE="${GITLAB_IMAGE:-gitlab/gitlab-ce}"
IMAGE_PREFIX="${IMAGE_PREFIX:-}"

# compose 文件整体插值需要这些变量，构建阶段不实际使用，缺失时补占位默认值
POSTGRES_DB="${POSTGRES_DB:-release_manager}"
POSTGRES_USER="${POSTGRES_USER:-release_manager}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-build-placeholder}"
REDIS_PASSWORD="${REDIS_PASSWORD:-build-placeholder}"
GITLAB_ROOT_PASSWORD="${GITLAB_ROOT_PASSWORD:-build-placeholder}"
GITLAB_EXTERNAL_URL="${GITLAB_EXTERNAL_URL:-http://localhost:18929}"
DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY:-build-placeholder}"
CREDENTIAL_SECRET_KEY="${CREDENTIAL_SECRET_KEY:-build-placeholder}"
ALLOWED_HOSTS="${ALLOWED_HOSTS:-localhost}"
PACKAGE_WORKSPACE_ROOT="${PACKAGE_WORKSPACE_ROOT:-/data/trace-ship/package_workspaces}"
export POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD REDIS_PASSWORD
export GITLAB_ROOT_PASSWORD GITLAB_EXTERNAL_URL
export DJANGO_SECRET_KEY CREDENTIAL_SECRET_KEY ALLOWED_HOSTS PACKAGE_WORKSPACE_ROOT

# ---------- 1. 选择构建模式 ----------
MODE="${1:-}"
if [ -z "${MODE}" ]; then
    echo "====================================="
    echo "  发布包构建引导"
    echo "====================================="
    echo ""
    echo "请选择构建模式："
    echo "  1) 第三方依赖包（postgres + redis + gitlab，用于内网首次部署）"
    echo "  2) 后端更新包（仅 backend，含 celery 同镜像）"
    echo "  3) 前端更新包（仅 frontend）"
    echo "  4) 应用更新包（backend + frontend）"
    echo "  0) 退出"
    echo ""
    read -rp "请输入编号 [0-4]: " choice
    case "${choice}" in
        1) MODE="--deps" ;;
        2) MODE="--backend" ;;
        3) MODE="--frontend" ;;
        4) MODE="--app" ;;
        0) echo "👋 已取消"; exit 0 ;;
        *) echo "❌ 无效选择"; exit 1 ;;
    esac
fi

case "${MODE}" in
    --deps|--backend|--frontend|--app) ;;
    *) echo "❌ 未知参数: ${MODE}（支持 --deps/--backend/--frontend/--app）"; exit 1 ;;
esac

# ---------- 2. 确定本包包含的镜像 ----------
APP_SERVICES=()    # 需要构建的业务服务
SAVE_DEPS=0

case "${MODE}" in
    --deps)
        SAVE_DEPS=1
        echo ""
        echo "依赖包包含: postgres:${POSTGRES_VERSION} / redis:${REDIS_VERSION} / gitlab-ce:${GITLAB_VERSION}"
        echo "⚠️  GitLab 镜像体积较大（约 2.5GB+），请确保磁盘与传输带宽充足"
        ;;
    --backend)
        APP_SERVICES=("backend")
        ;;
    --frontend)
        APP_SERVICES=("frontend")
        ;;
    --app)
        APP_SERVICES=("backend" "frontend")
        ;;
esac

MODE_NAME="${MODE#--}"
echo ""
echo "📌 构建模式: ${MODE_NAME}"
echo ""

# ---------- 3. 构建业务镜像 / 拉取依赖镜像 ----------
STEP_TOTAL=2
if [ ${#APP_SERVICES[@]} -gt 0 ]; then
    echo "🚀 [1/${STEP_TOTAL}] 构建业务镜像: ${APP_SERVICES[*]}（首次约数分钟）..."
    docker compose -f "${COMPOSE_FILE}" build "${APP_SERVICES[@]}"
else
    echo "🚀 [1/${STEP_TOTAL}] 拉取第三方依赖镜像 postgres / redis / gitlab ..."
    docker pull "${IMAGE_PREFIX}postgres:${POSTGRES_VERSION}"
    docker pull "${IMAGE_PREFIX}redis:${REDIS_VERSION}"
    docker pull "${GITLAB_IMAGE}:${GITLAB_VERSION}"
fi

# ---------- 4. 校验并导出镜像 tar ----------
echo ""
echo "🚀 [2/${STEP_TOTAL}] 校验并导出镜像..."
PKG_DIR="${ROOT_DIR}/trace-ship-release"
rm -rf "${PKG_DIR}"
mkdir -p "${PKG_DIR}/images"

save_image() {
    local img="$1" file="$2"
    if ! docker image inspect "${img}" >/dev/null 2>&1; then
        echo "❌ 镜像缺失: ${img}"
        exit 1
    fi
    echo "  ✅ ${img} -> images/${file}"
    docker save -o "${PKG_DIR}/images/${file}" "${img}"
}

if [ ${SAVE_DEPS} -eq 1 ]; then
    save_image "${IMAGE_PREFIX}postgres:${POSTGRES_VERSION}" "postgres.tar"
    save_image "${IMAGE_PREFIX}redis:${REDIS_VERSION}" "redis.tar"
    save_image "${GITLAB_IMAGE}:${GITLAB_VERSION}" "gitlab.tar"
else
    case "${MODE}" in
        --backend|--app) save_image "trace-ship/backend:latest" "backend.tar" ;;
    esac
    case "${MODE}" in
        --frontend|--app) save_image "trace-ship/frontend:latest" "frontend.tar" ;;
    esac
fi

# ---------- 5. 组装发布包 ----------
# 每个包都自带完整部署材料：双 compose 编排 + 环境模板 + 一键部署脚本
cp "${COMPOSE_FILE}" "${PKG_DIR}/docker-compose.prod.yml"
cp "${DOCKER_DIR}/docker-compose.deps.yml" "${PKG_DIR}/docker-compose.deps.yml"
cp "${DOCKER_DIR}/.env.prod.example" "${PKG_DIR}/.env.prod.example"
cp "${SCRIPT_DIR}/deploy.sh" "${PKG_DIR}/deploy.sh"
chmod +x "${PKG_DIR}/deploy.sh"

GIT_COMMIT="$(git -C "${ROOT_DIR}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
cat > "${PKG_DIR}/VERSION" <<EOF
MODE=${MODE_NAME}
BUILD_TIME=$(date '+%Y-%m-%d %H:%M:%S')
GIT_COMMIT=${GIT_COMMIT}
POSTGRES_VERSION=${POSTGRES_VERSION}
REDIS_VERSION=${REDIS_VERSION}
GITLAB_VERSION=${GITLAB_VERSION}
BACKEND_IMAGE=trace-ship/backend:latest
FRONTEND_IMAGE=trace-ship/frontend:latest
EOF

mkdir -p "${DIST_DIR}"
DATE="$(date +%Y%m%d-%H%M%S)"
PKG_NAME="trace-ship-release-${MODE_NAME}-${DATE}.tar.gz"
tar -czf "${DIST_DIR}/${PKG_NAME}" -C "${ROOT_DIR}" "$(basename "${PKG_DIR}")"
rm -rf "${PKG_DIR}"

echo ""
echo "====================================="
echo "✅ 发布包构建完成"
echo "====================================="
echo ""
echo "📦 发布包: ${DIST_DIR}/${PKG_NAME}"
echo "   大小: $(du -h "${DIST_DIR}/${PKG_NAME}" | cut -f1)"
echo ""
case "${MODE}" in
    --deps)
        echo "内网首次部署步骤："
        echo "  1. 拷贝本包与 --app 构建的应用包到内网服务器"
        echo "  2. 两个包解压到同一目录（部署材料相同，镜像互补）"
        echo "  3. ./deploy.sh --full   # 自动生成 .env.prod，先起依赖组再起应用"
        ;;
    *)
        echo "内网更新部署步骤："
        echo "  1. 拷贝 ${PKG_NAME} 到内网服务器"
        echo "  2. tar -xzf ${PKG_NAME} && cd trace-ship-release"
        echo "  3. ./deploy.sh ${MODE}   # 复用已有 .env.prod，滚动更新对应服务"
        echo "     （需先完成过一次全量部署）"
        ;;
esac
echo ""
