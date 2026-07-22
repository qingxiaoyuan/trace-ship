#!/bin/bash
# ============================================================
# Trace Ship 发布包构建脚本（在外网/可联网机器执行）
#
# 支持模式：
#   1. 全量发布包   —— postgres + redis + backend + frontend，用于内网首次/覆盖部署
#   2. 更新发布包   —— 仅后端 / 仅前端 / 前后端，用于内网增量更新
#
# 用法：
#   scripts/build.sh              交互式菜单选择
#   scripts/build.sh --full       全量发布包
#   scripts/build.sh --backend    更新发布包（仅后端）
#   scripts/build.sh --frontend   更新发布包（仅前端）
#   scripts/build.sh --app        更新发布包（前后端一起）
#
# 产出：dist/trace-ship-release-<模式>-<时间戳>.tar.gz
#       拷贝到内网服务器解压后，用包内 deploy.sh 一键部署。
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
GITEA_VERSION="${GITEA_VERSION:-1.21}"
GITLAB_VERSION="${GITLAB_VERSION:-12.4.0-ce.0}"
IMAGE_PREFIX="${IMAGE_PREFIX:-}"

# ---------- 1. 选择构建模式 ----------
MODE="${1:-}"
if [ -z "${MODE}" ]; then
    echo "请选择构建模式："
    echo "  1) 全量发布包（postgres + redis + backend + frontend，用于覆盖式部署）"
    echo "  2) 更新发布包 - 仅后端"
    echo "  3) 更新发布包 - 仅前端"
    echo "  4) 更新发布包 - 前后端一起"
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

# ---------- 2. 确定本包包含的镜像 ----------
APP_IMAGES=()      # 需要构建的业务镜像
SAVE_BACKEND=0
SAVE_FRONTEND=0
SAVE_DEPS=0
EXTRA_IMAGES=()    # 可选额外第三方镜像（仅导出，deploy 只加载不编排）

case "${MODE}" in
    --full)
        APP_IMAGES=("backend" "frontend")
        SAVE_BACKEND=1
        SAVE_FRONTEND=1
        SAVE_DEPS=1
        ;;
    --backend)
        APP_IMAGES=("backend")
        SAVE_BACKEND=1
        ;;
    --frontend)
        APP_IMAGES=("frontend")
        SAVE_FRONTEND=1
        ;;
    --app)
        APP_IMAGES=("backend" "frontend")
        SAVE_BACKEND=1
        SAVE_FRONTEND=1
        ;;
esac

# 全量模式可选打包额外第三方镜像（如内网也需要 GitLab/Gitea）
if [ "${MODE}" = "--full" ] && [ -t 0 ]; then
    echo ""
    echo "全量包默认包含: postgres:${POSTGRES_VERSION} / redis:${REDIS_VERSION} / backend / frontend"
    read -rp "是否额外打包第三方镜像？（空格分隔，可选: gitlab gitea，回车跳过）: " extras
    for e in ${extras}; do
        case "${e}" in
            gitlab) EXTRA_IMAGES+=("${IMAGE_PREFIX}gitlab/gitlab-ce:${GITLAB_VERSION}") ;;
            gitea)  EXTRA_IMAGES+=("${IMAGE_PREFIX}gitea/gitea:${GITEA_VERSION}") ;;
            *) echo "⚠️  忽略未知镜像: ${e}" ;;
        esac
    done
fi

MODE_NAME="${MODE#--}"
echo ""
echo "📌 构建模式: ${MODE_NAME}"
echo ""

# ---------- 3. 构建业务镜像 ----------
echo "🚀 [1/3] 构建业务镜像: ${APP_IMAGES[*]}（首次约数分钟）..."
docker compose -f "${COMPOSE_FILE}" build "${APP_IMAGES[@]}"

# ---------- 4. 拉取依赖镜像 ----------
if [ ${SAVE_DEPS} -eq 1 ]; then
    echo ""
    echo "🚀 [2/3] 拉取基础镜像 postgres / redis ..."
    docker pull "${IMAGE_PREFIX}postgres:${POSTGRES_VERSION}"
    docker pull "${IMAGE_PREFIX}redis:${REDIS_VERSION}"
fi
for img in "${EXTRA_IMAGES[@]}"; do
    docker pull "${img}"
done

# ---------- 5. 校验并导出镜像 tar ----------
echo ""
echo "🚀 [3/3] 校验并导出镜像..."
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

[ ${SAVE_BACKEND} -eq 1 ]  && save_image "trace-ship/backend:latest" "backend.tar"
[ ${SAVE_FRONTEND} -eq 1 ] && save_image "trace-ship/frontend:latest" "frontend.tar"
if [ ${SAVE_DEPS} -eq 1 ]; then
    save_image "${IMAGE_PREFIX}postgres:${POSTGRES_VERSION}" "postgres.tar"
    save_image "${IMAGE_PREFIX}redis:${REDIS_VERSION}" "redis.tar"
fi
idx=0
for img in "${EXTRA_IMAGES[@]}"; do
    idx=$((idx + 1))
    save_image "${img}" "extra-${idx}.tar"
done

# ---------- 6. 组装发布包 ----------
cp "${COMPOSE_FILE}" "${PKG_DIR}/docker-compose.prod.yml"
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
BACKEND_IMAGE=trace-ship/backend:latest
FRONTEND_IMAGE=trace-ship/frontend:latest
EXTRA_IMAGES=${EXTRA_IMAGES[*]}
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
echo "内网部署步骤："
echo "  1. 拷贝 ${PKG_NAME} 到内网服务器"
echo "  2. tar -xzf ${PKG_NAME} && cd trace-ship-release"
echo "  3. ./deploy.sh          # 交互式选择部署模式"
if [ "${MODE}" = "--full" ]; then
    echo "     （覆盖式全量发布：自动生成全新 .env.prod 环境变量）"
else
    echo "     （更新发布：需先完成过一次全量发布，复用已有 .env.prod）"
fi
if [ ${#EXTRA_IMAGES[@]} -gt 0 ]; then
    echo ""
    echo "⚠️  额外镜像（${EXTRA_IMAGES[*]}）仅导入，不参与编排，需在内网自行启动"
fi
echo ""
