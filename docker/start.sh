#!/bin/bash
# 第三方服务一键启动脚本（数据库、缓存、Git、LDAP、SVN）
# 应用服务（backend / frontend / celery）请在本地分别启动，便于开发调试
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

echo "====================================="
echo "Release Manager 第三方服务一键部署"
echo "====================================="
echo ""

# 检查 docker 和 docker-compose
if ! command -v docker &> /dev/null; then
    echo "❌ 未安装 Docker，请先安装 Docker"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ 未安装 Docker Compose，请先安装 Docker Compose"
    exit 1
fi

# 加载环境变量
if [ -f .env ]; then
    echo "✅ 加载环境变量: .env"
    set -a
    source .env
    set +a
else
    echo "⚠️ 未找到 .env 文件，将使用默认值"
fi

# 创建必要目录
echo "✅ 创建持久化目录..."
mkdir -p \
    postgres/init \
    openldap/init \
    svn

# 选择 compose 命令
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

echo "✅ 使用命令: ${COMPOSE_CMD}"
echo ""

# 启动服务（默认仅启动无 profile 的第三方依赖服务）
echo "🚀 启动第三方服务..."
${COMPOSE_CMD} up -d --build

# 等待 SVN 服务就绪并初始化仓库（含账号配置）
SVN_CONTAINER="${COMPOSE_PROJECT_NAME:-release-manager-dev}-svn"
echo ""
echo "⏳ 等待 SVN 服务就绪..."
sleep 5

if docker ps --format "{{.Names}}" | grep -q "^${SVN_CONTAINER}$"; then
    echo "✅ 初始化 SVN 测试仓库及账号配置..."
    docker cp "${SCRIPT_DIR}/svn/create-repos.sh" "${SVN_CONTAINER}:/tmp/create-repos.sh"
    docker exec "${SVN_CONTAINER}" sh /tmp/create-repos.sh
    docker exec "${SVN_CONTAINER}" rm -f /tmp/create-repos.sh
else
    echo "⚠️ SVN 容器未启动，跳过仓库初始化"
fi

echo ""
echo "====================================="
echo "第三方服务启动完成，访问地址如下："
echo "====================================="
echo ""
echo "🌐 Gitea (Git 仓库):     http://localhost:${GITEA_HTTP_PORT:-3000}"
echo "   管理员账号: ${GITEA_ADMIN_USER:-gitea_admin} / ${GITEA_ADMIN_PASSWORD:-GiteaAdmin@2024}"
echo ""
echo "👤 OpenLDAP (域账号):    ldap://localhost:${LDAP_PORT:-389}"
echo "   Base DN: dc=$(echo ${LDAP_DOMAIN:-example.com} | sed 's/\./,dc=/g')"
echo "   管理员账号: cn=admin,dc=$(echo ${LDAP_DOMAIN:-example.com} | sed 's/\./,dc=/g')"
echo "   密码: ${LDAP_ADMIN_PASSWORD:-LDAPAdmin@2024}"
echo ""
echo "🖥️  phpLDAPadmin:         http://localhost:${PHPLDAPADMIN_PORT:-8090}"
echo "   Login DN: cn=admin,dc=$(echo ${LDAP_DOMAIN:-example.com} | sed 's/\./,dc=/g')"
echo ""
echo "📁 SVN 仓库:"
echo "   svn 协议:    svn://localhost:${SVN_PORT:-3690}/trace-ship"
echo "   http 协议:   http://localhost:${SVN_HTTP_PORT:-3691}/svn/trace-ship"
echo "   仓库列表:    http://localhost:${SVN_HTTP_PORT:-3691}/repos/"
echo "   模拟真实场景的三角色账号（svn/http 共用同一套）："
echo "     admin     / ${SVN_ADMIN_PASSWORD:-SVNAdmin@2024}        （全权限 rw，可推 tag）"
echo "     developer / ${SVN_DEV_PASSWORD:-Developer@2024}  （trunk/branches 读写，tag 只读）"
echo "     viewer    / ${SVN_VIEWER_PASSWORD:-Viewer@2024}      （全只读）"
echo ""
echo "🐘 PostgreSQL:           localhost:${POSTGRES_PORT:-5432}"
echo "   数据库: ${POSTGRES_DB:-release_manager}"
echo "   用户: ${POSTGRES_USER:-release_manager} / ${POSTGRES_PASSWORD:-ReleaseManager@2024}"
echo ""
echo "🔴 Redis:                localhost:${REDIS_PORT:-6379}"
echo "   密码: ${REDIS_PASSWORD:-ReleaseManager@2024}"
echo ""
echo "====================================="
echo "提示："
echo "- backend / frontend / celery 请在本地启动，便于开发调试"
echo "- 如需一键启动完整应用服务，请使用: ${COMPOSE_CMD} --profile app up -d --build"
echo "====================================="
