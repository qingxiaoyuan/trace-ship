#!/bin/bash
# 导出 Trace Ship 全部镜像为离线 tar 包（在外网机器执行）
# 用法：先 ./start-prod.sh 构建镜像，再执行本脚本导出
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

if [ ! -f .env.prod ]; then
    echo "❌ 未找到 .env.prod，请先配置"
    exit 1
fi

set -a
source .env.prod
set +a

POSTGRES_VERSION="${POSTGRES_VERSION:-16}"
REDIS_VERSION="${REDIS_VERSION:-7}"

# 需要导出的镜像清单（与 compose 中 image: 一致）
IMAGES=(
    "trace-ship/backend:latest"
    "trace-ship/frontend:latest"
    "postgres:${POSTGRES_VERSION}"
    "redis:${REDIS_VERSION}"
)

echo "====================================="
echo "导出离线镜像"
echo "====================================="
echo ""

# 检查镜像是否存在
MISSING=()
for img in "${IMAGES[@]}"; do
    if docker image inspect "${img}" >/dev/null 2>&1; then
        echo "✅ ${img}"
    else
        echo "❌ ${img} (不存在)"
        MISSING+=("${img}")
    fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
    echo ""
    echo "缺少镜像，请先在外网机器构建/拉取："
    echo "  ./start-prod.sh --build          # 构建 backend / frontend"
    echo "  docker pull postgres:${POSTGRES_VERSION}"
    echo "  docker pull redis:${REDIS_VERSION}"
    exit 1
fi

echo ""
echo "📦 导出镜像到 trace-ship-images.tar ..."
docker save -o trace-ship-images.tar "${IMAGES[@]}"

echo ""
echo "✅ 导出完成"
echo "   文件: ${SCRIPT_DIR}/trace-ship-images.tar"
echo "   大小: $(du -h trace-ship-images.tar | cut -f1)"
echo ""
echo "请将以下文件拷贝到内网机器的 docker 目录："
echo "  1. trace-ship-images.tar   (镜像包)"
echo "  2. docker-compose.prod.yml"
echo "  3. .env.prod"
echo "  4. start-prod.sh / load-images.sh / .env.prod.example"
echo ""
echo "内网执行："
echo "  ./load-images.sh && ./start-prod.sh"
