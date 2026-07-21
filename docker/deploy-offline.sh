#!/bin/bash
# ============================================================
# Trace Ship 内网一键部署脚本（在无外网的服务器执行）
#
# 前提：已用 build-offline.sh 打出离线安装包并解压到当前目录。
#
# 功能：
#   1. 加载离线镜像 tar
#   2. 首次部署时引导生成 .env.prod（自动生成随机密钥）
#   3. 创建打包工作区目录
#   4. 启动全部生产服务并做健康检查
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

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

# ---------- 1. 加载离线镜像 ----------
TAR="trace-ship-images.tar"
if [ ! -f "${TAR}" ]; then
    echo "❌ 未找到 ${TAR}"
    echo "请确认离线安装包已正确解压到 ${SCRIPT_DIR}"
    exit 1
fi

echo "📦 [1/4] 加载离线镜像（文件较大，请稍候）..."
docker load -i "${TAR}"
echo "✅ 镜像加载完成"
echo ""

# ---------- 2. 准备 .env.prod ----------
if [ ! -f .env.prod ]; then
    echo "🔧 [2/4] 首次部署，生成 .env.prod ..."
    if [ ! -f .env.prod.example ]; then
        echo "❌ 未找到 .env.prod.example 模板"
        exit 1
    fi
    cp .env.prod.example .env.prod

    # 自动生成随机密钥并替换占位符（兼容 GNU/BSD sed）
    DJANGO_KEY="$(head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 50)"
    CRED_KEY="$(head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 32)"
    sed -i.bak "s|must-replace-with-random-50-chars-secret-key-here|${DJANGO_KEY}|" .env.prod
    sed -i.bak "s|must-replace-with-32-bytes-random-key-here|${CRED_KEY}|" .env.prod
    rm -f .env.prod.bak

    echo "✅ 已自动生成随机密钥"
    echo ""
    echo "⚠️  请编辑 .env.prod 完成以下必填项，然后重新运行本脚本："
    echo "     - ALLOWED_HOSTS          （把 YOUR_SERVER_IP 改为服务器真实 IP）"
    echo "     - CORS_ALLOWED_ORIGINS   （同上）"
    echo "     - POSTGRES_PASSWORD      （数据库密码，建议修改）"
    echo "     - REDIS_PASSWORD         （Redis 密码，建议修改）"
    echo ""
    echo "   编辑命令: vi .env.prod"
    exit 0
fi

echo "🔧 [2/4] 使用已有 .env.prod"

# 加载配置
set -a
source .env.prod
set +a

# 校验必填项
FAIL=0
if [[ "${ALLOWED_HOSTS}" == *YOUR_SERVER_IP* ]]; then
    echo "❌ .env.prod 中 ALLOWED_HOSTS 仍是占位符 YOUR_SERVER_IP"
    FAIL=1
fi
if [[ "${CORS_ALLOWED_ORIGINS}" == *YOUR_SERVER_IP* ]]; then
    echo "❌ .env.prod 中 CORS_ALLOWED_ORIGINS 仍是占位符 YOUR_SERVER_IP"
    FAIL=1
fi
if [[ -z "${PACKAGE_WORKSPACE_ROOT}" ]]; then
    echo "❌ .env.prod 中 PACKAGE_WORKSPACE_ROOT 未设置"
    FAIL=1
fi
if [ ${FAIL} -eq 1 ]; then
    echo ""
    echo "请先修正 .env.prod 后重新运行本脚本"
    exit 1
fi

# ---------- 3. 创建工作区目录 ----------
echo "🔧 [3/4] 准备打包工作区: ${PACKAGE_WORKSPACE_ROOT}"
mkdir -p "${PACKAGE_WORKSPACE_ROOT}"

# ---------- 4. 启动服务 ----------
echo ""
echo "🚀 [4/4] 启动生产服务..."
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d

echo ""
echo "⏳ 等待服务就绪..."
sleep 5

# 健康检查（最多等待 60 秒）
BACKEND_OK=0
for i in $(seq 1 20); do
    if docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T backend \
        sh -c "curl -sf http://localhost:8000/health/ >/dev/null 2>&1" 2>/dev/null; then
        BACKEND_OK=1
        break
    fi
    sleep 3
done

echo ""
echo "====================================="
if [ ${BACKEND_OK} -eq 1 ]; then
    echo "✅ 部署完成，后端健康检查通过"
else
    echo "⚠️  服务已启动，但后端健康检查未通过，请查看日志排查"
fi
echo "====================================="
echo ""
echo "🌐 前端访问: http://${ALLOWED_HOSTS%%,*}:${FRONTEND_PORT:-80}"
echo "   默认账号: admin / admin@123  (请尽快登录修改)"
echo ""
echo "📋 服务状态:"
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
echo ""
echo "常用命令："
echo "  查看日志:   docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f backend"
echo "  重启服务:   docker compose --env-file .env.prod -f docker-compose.prod.yml restart"
echo "  停止服务:   docker compose --env-file .env.prod -f docker-compose.prod.yml down"
echo ""
