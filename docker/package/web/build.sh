#!/bin/bash
# 构建 Trace Ship Web 打包镜像（trace-ship/web-builder）
# 用法：
#   ./build.sh                              构建默认镜像 trace-ship/web-builder:node22
#   ./build.sh <镜像名:标签>                自定义镜像名，如 registry.internal/trace-ship/web-builder:node22
#   ./build.sh --export [镜像名:标签]       构建并导出为离线 tar 包（用于分发到内网打包机）
# 环境变量：
#   NPM_REGISTRY   构建时写入镜像的默认 npm 源，默认官方源 https://registry.npmjs.org/
#                  示例: NPM_REGISTRY=http://127.0.0.1:28081/repository/npm-group/ ./build.sh
#   也可在同目录 .env 文件中配置(参照 .env.example)，环境变量优先级高于 .env
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# 记录命令行传入的环境变量（优先级最高，不被 .env 覆盖）
CLI_NPM_REGISTRY="${NPM_REGISTRY:-}"

# 加载同目录 .env 文件（不存在则跳过）
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# 优先级: 命令行环境变量 > .env > 内置默认值
IMAGE="trace-ship/web-builder:node22"
NPM_REGISTRY="${CLI_NPM_REGISTRY:-${NPM_REGISTRY:-https://registry.npmjs.org/}}"
EXPORT=0

usage() {
    sed -n '2,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
}

for arg in "$@"; do
    case "${arg}" in
        --export|-e)
            EXPORT=1
            ;;
        -h|--help)
            usage
            ;;
        *)
            IMAGE="${arg}"
            ;;
    esac
done

echo "====================================="
echo "构建 Web 打包镜像"
echo "====================================="
echo ""

if ! command -v docker &> /dev/null; then
    echo "❌ 未安装 Docker，请先安装"
    exit 1
fi

echo "🚀 构建镜像: ${IMAGE}"
echo "   默认 npm 源: ${NPM_REGISTRY}"
docker build --build-arg NPM_REGISTRY="${NPM_REGISTRY}" -t "${IMAGE}" "${SCRIPT_DIR}"

echo ""
echo "✅ 构建完成: ${IMAGE}"

if [ "${EXPORT}" -eq 1 ]; then
    TAR_NAME="$(echo "${IMAGE}" | tr '/:' '--').tar"
    echo ""
    echo "📦 导出离线镜像包: ${TAR_NAME}"
    docker save -o "${TAR_NAME}" "${IMAGE}"
    echo "✅ 导出完成"
    echo "   文件: ${SCRIPT_DIR}/${TAR_NAME}"
    echo "   大小: $(du -h "${TAR_NAME}" | cut -f1)"
    echo ""
    echo "拷贝到内网打包机后加载："
    echo "  docker load -i ${TAR_NAME}"
fi

echo ""
echo "接下来在系统「打包镜像」中登记："
echo "  打包类型:     web"
echo "  Docker 镜像:  ${IMAGE}"
echo "  脚本入口:     /usr/local/bin/trace-ship-build"
echo "  默认构建目录: ."
echo "  默认产物目录: dist"
