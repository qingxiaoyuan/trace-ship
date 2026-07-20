#!/bin/bash
# ============================================================
# Trace Ship 一键离线构建脚本（在外网/可联网机器执行）
#
# 功能：
#   1. 构建 backend / frontend 业务镜像
#   2. 拉取 postgres / redis 基础镜像
#   3. 导出全部镜像为 tar
#   4. 连同 compose、配置模板、内网部署脚本一起打成离线安装包
#
# 产出：trace-ship-offline-<日期>.tar.gz，拷贝到内网服务器后，
#       用 deploy-offline.sh 一键部署。
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

echo "====================================="
echo "Trace Ship 离线安装包构建（外网）"
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

# ---------- 1. 准备 .env.prod（仅用于读取版本号，不存在则用模板） ----------
if [ ! -f .env.prod ]; then
    if [ -f .env.prod.example ]; then
        echo "ℹ️  未找到 .env.prod，临时复制 .env.prod.example 用于读取版本配置"
        cp .env.prod.example .env.prod
        TEMP_ENV=1
    else
        echo "❌ 未找到 .env.prod.example"
        exit 1
    fi
fi

set -a
source .env.prod
set +a

POSTGRES_VERSION="${POSTGRES_VERSION:-16}"
REDIS_VERSION="${REDIS_VERSION:-7}"
IMAGE_PREFIX="${IMAGE_PREFIX:-}"

echo "📌 基础镜像版本: postgres:${POSTGRES_VERSION}  redis:${REDIS_VERSION}"
echo ""

# ---------- 2. 构建业务镜像 ----------
echo "🚀 [1/4] 构建 backend / frontend 镜像（首次约数分钟）..."
docker compose --env-file .env.prod -f docker-compose.prod.yml build backend frontend

# ---------- 3. 拉取基础镜像 ----------
echo ""
echo "🚀 [2/4] 拉取基础镜像..."
docker pull "${IMAGE_PREFIX}postgres:${POSTGRES_VERSION}"
docker pull "${IMAGE_PREFIX}redis:${REDIS_VERSION}"

# ---------- 4. 校验镜像齐全 ----------
IMAGES=(
    "trace-ship/backend:latest"
    "trace-ship/frontend:latest"
    "${IMAGE_PREFIX}postgres:${POSTGRES_VERSION}"
    "${IMAGE_PREFIX}redis:${REDIS_VERSION}"
)

echo ""
echo "🚀 [3/4] 校验镜像..."
MISSING=()
for img in "${IMAGES[@]}"; do
    if docker image inspect "${img}" >/dev/null 2>&1; then
        echo "  ✅ ${img}"
    else
        echo "  ❌ ${img} (缺失)"
        MISSING+=("${img}")
    fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
    echo "❌ 有镜像缺失，构建失败"
    exit 1
fi

# ---------- 5. 导出镜像 tar ----------
echo ""
echo "🚀 [4/4] 导出镜像并打包..."
docker save -o trace-ship-images.tar "${IMAGES[@]}"

# ---------- 6. 组装离线安装包 ----------
PKG_DIR="trace-ship-offline"
rm -rf "${PKG_DIR}"
mkdir -p "${PKG_DIR}"

cp trace-ship-images.tar "${PKG_DIR}/"
cp docker-compose.prod.yml "${PKG_DIR}/"
cp .env.prod.example "${PKG_DIR}/"
cp start-prod.sh "${PKG_DIR}/"
cp deploy-offline.sh "${PKG_DIR}/" 2>/dev/null || true

DATE="$(date +%Y%m%d-%H%M%S)"
PKG_NAME="trace-ship-offline-${DATE}.tar.gz"
tar -czf "${PKG_NAME}" -C . "${PKG_DIR}"

# 清理临时文件
rm -rf "${PKG_DIR}" trace-ship-images.tar
if [ "${TEMP_ENV}" = "1" ]; then
    rm -f .env.prod
fi

echo ""
echo "====================================="
echo "✅ 离线安装包构建完成"
echo "====================================="
echo ""
echo "📦 安装包: ${SCRIPT_DIR}/${PKG_NAME}"
echo "   大小: $(du -h "${PKG_NAME}" | cut -f1)"
echo ""
echo "内网部署步骤："
echo "  1. 拷贝 ${PKG_NAME} 到内网服务器"
echo "  2. tar -xzf ${PKG_NAME} && cd trace-ship-offline"
echo "  3. ./deploy-offline.sh"
echo ""
