#!/bin/bash
# Trace Ship 生产环境一键部署脚本
# 启动 backend / frontend / celery / postgres / redis，不含开发用第三方依赖
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

# 检查 .env.prod 是否存在
if [ ! -f .env.prod ]; then
    echo "❌ 未找到 .env.prod 配置文件"
    echo ""
    echo "请先复制模板并填写真实配置："
    echo "  cp .env.prod.example .env.prod"
    echo "  vi .env.prod"
    exit 1
fi

# 加载并校验关键变量
set -a
source .env.prod
set +a

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

if [[ -z "${PACKAGE_WORKSPACE_ROOT}" ]]; then
    echo "❌ .env.prod 中 PACKAGE_WORKSPACE_ROOT 未设置"
    exit 1
fi

# 创建打包工作区目录（DooD 下宿主机与容器共用同一路径）
mkdir -p "${PACKAGE_WORKSPACE_ROOT}"
echo "✅ 打包工作区目录: ${PACKAGE_WORKSPACE_ROOT}"

echo "✅ 配置校验通过"
echo ""
echo "🚀 构建并启动生产服务（首次构建可能需要数分钟）..."
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build

echo ""
echo "====================================="
echo "✅ 生产服务已启动"
echo "====================================="
echo ""
echo "🌐 前端访问地址: http://${ALLOWED_HOSTS%%,*}:${FRONTEND_PORT:-80}"
echo ""
echo "常用命令："
echo "  查看后端日志:   docker compose -f docker-compose.prod.yml logs -f backend"
echo "  查看所有日志:   docker compose -f docker-compose.prod.yml logs -f"
echo "  查看服务状态:   docker compose -f docker-compose.prod.yml ps"
echo "  停止服务:       docker compose -f docker-compose.prod.yml down"
echo "  重新构建并启动: docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build"
echo "====================================="
