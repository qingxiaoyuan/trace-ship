#!/bin/bash
# 加载离线镜像包（在内网机器执行）
# 用法：将外网导出的 trace-ship-images.tar 拷到 docker 目录后执行
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

TAR="trace-ship-images.tar"

if [ ! -f "${TAR}" ]; then
    echo "❌ 未找到 ${TAR}"
    echo "请先从外网机器拷贝该文件到 ${SCRIPT_DIR}"
    exit 1
fi

echo "📦 加载镜像（文件较大，请稍候）..."
docker load -i "${TAR}"

echo ""
echo "✅ 已加载镜像："
docker images --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}" | grep -E "trace-ship|postgres|redis" | sort
echo ""
echo "接下来执行 ./start-prod.sh 启动服务"
