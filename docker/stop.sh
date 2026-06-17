#!/bin/bash
# 第三方服务一键停止脚本
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# 选择 compose 命令
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

echo "🛑 停止 Release Manager 第三方服务..."
${COMPOSE_CMD} down

echo "✅ 服务已停止"
