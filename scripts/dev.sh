#!/bin/bash
# ============================================================
# Trace Ship 开发环境脚本
#
# 直接执行（无参数）进入引导式菜单：
#   scripts/dev.sh
#
# 也支持命令式调用（便于脚本化）：
#   scripts/dev.sh deps [--test]   启动第三方开发容器（PostgreSQL / Redis / GitLab；
#                                  --test 追加 OpenLDAP / phpLDAPadmin / SVN 模拟服务）
#   scripts/dev.sh backend         本地启动后端（自动迁移 + runserver + Celery worker，后台运行）
#   scripts/dev.sh frontend        本地启动前端（Vite dev server，后台运行）
#   scripts/dev.sh all [--test]    一键启动全部（依赖 + 后端 + 前端 + Celery worker）
#   scripts/dev.sh down            关闭所有（本地后端/前端/Celery worker 进程 + 全部第三方容器）
#   scripts/dev.sh status          查看各组件运行状态
#   scripts/dev.sh logs <目标>     跟踪日志（backend / frontend / celery-worker / <compose 服务名>）
#   scripts/dev.sh gitlab-admin    创建/重置 GitLab 管理员（admin / admin123）
#
# 后台进程的 PID 与日志保存在 scripts/.run/ 下。
# 本地后端启动时会自动拉起 Celery worker；Celery beat 仍需手动启动（定时任务调试）。
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/docker"
RUN_DIR="${SCRIPT_DIR}/.run"
mkdir -p "${RUN_DIR}"

# ---------- 通用函数 ----------

# 选择 compose 命令
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
else
    echo "❌ 未安装 Docker Compose，请先安装"
    exit 1
fi

compose_dev() {
    ${COMPOSE_CMD} -f "${DOCKER_DIR}/docker-compose.yml" "$@"
}

# 加载 docker/.env（首次使用自动从模板生成）
load_env() {
    if [ ! -f "${DOCKER_DIR}/.env" ]; then
        echo "ℹ️  首次使用，从 .env.example 生成 docker/.env"
        cp "${DOCKER_DIR}/.env.example" "${DOCKER_DIR}/.env"
    fi
    set -a
    source "${DOCKER_DIR}/.env"
    set +a
}

# 判断进程是否存活
pid_alive() {
    local pid_file="$1"
    [ -f "${pid_file}" ] && kill -0 "$(cat "${pid_file}")" 2>/dev/null
}

# 后台启动并记录 PID
start_bg() {
    local name="$1"; shift
    local pid_file="${RUN_DIR}/${name}.pid"
    local log_file="${RUN_DIR}/${name}.log"
    if pid_alive "${pid_file}"; then
        echo "⚠️ ${name} 已在运行（PID $(cat "${pid_file}")），日志: ${log_file}"
        return 0
    fi
    nohup "$@" > "${log_file}" 2>&1 &
    echo $! > "${pid_file}"
    echo "✅ ${name} 已启动（PID $!），日志: ${log_file}"
}

stop_bg() {
    local name="$1"
    local pid_file="${RUN_DIR}/${name}.pid"
    if pid_alive "${pid_file}"; then
        kill "$(cat "${pid_file}")" 2>/dev/null || true
        echo "🛑 ${name} 已停止"
    fi
    rm -f "${pid_file}"
}

# ---------- deps：启动第三方开发容器 ----------
cmd_deps() {
    local with_test=false
    [ "$1" = "--test" ] && with_test=true

    cd "${DOCKER_DIR}"
    load_env

    echo "====================================="
    echo "Trace Ship 第三方开发容器"
    if [ "${with_test}" = true ]; then
        echo "模式：基础依赖 + 测试模拟服务（LDAP/SVN）"
    else
        echo "模式：基础依赖（PostgreSQL / Redis / GitLab）"
    fi
    echo "====================================="
    echo ""

    local profile_args=""
    [ "${with_test}" = true ] && profile_args="--profile test"

    echo "🚀 启动第三方服务..."
    compose_dev ${profile_args} up -d --build

    # 测试模式下等待 SVN 就绪并初始化仓库（含三角色账号）
    if [ "${with_test}" = true ]; then
        local svn_container="${COMPOSE_PROJECT_NAME:-trace-ship-dev}-svn"
        echo ""
        echo "⏳ 等待 SVN 服务就绪..."
        sleep 5
        if docker ps --format "{{.Names}}" | grep -q "^${svn_container}$"; then
            echo "✅ 初始化 SVN 测试仓库及账号配置..."
            docker cp "${DOCKER_DIR}/svn/create-repos.sh" "${svn_container}:/tmp/create-repos.sh"
            docker exec "${svn_container}" sh /tmp/create-repos.sh
            docker exec "${svn_container}" rm -f /tmp/create-repos.sh
        else
            echo "⚠️ SVN 容器未启动，跳过仓库初始化"
        fi
    fi

    echo ""
    echo "====================================="
    echo "第三方服务启动完成，访问地址："
    echo "====================================="
    echo ""
    echo "🦊 GitLab:      http://localhost:${GITLAB_HTTP_PORT:-18929}"
    echo "   管理员: admin / admin123（待 GitLab 就绪后执行 scripts/dev.sh gitlab-admin 创建）"
    echo "🐘 PostgreSQL:  localhost:${POSTGRES_PORT:-5432}  库 ${POSTGRES_DB:-release_manager}"
    echo "🔴 Redis:       localhost:${REDIS_PORT:-6379}"
    if [ "${with_test}" = true ]; then
        echo "👤 OpenLDAP:    ldap://localhost:${LDAP_PORT:-389}  (cn=admin,dc=example,dc=com)"
        echo "🖥️  phpLDAPadmin: http://localhost:${PHPLDAPADMIN_PORT:-8090}"
        echo "📁 SVN:         svn://localhost:${SVN_PORT:-3690}/trace-ship"
        echo "   三角色账号: admin / developer / viewer（密码见 docker/svn/create-repos.sh）"
    fi
    echo ""
    echo "提示：scripts/dev.sh backend / frontend 启动本地应用；scripts/dev.sh down 关闭所有"
}

# ---------- backend：本地启动后端 ----------
cmd_backend() {
    cd "${ROOT_DIR}/backend"
    load_env

    # 选择 Python 解释器：依次尝试 .venv / PATH 中的 python3 / /usr/bin/python3，
    # 以「能 import django」为准（.venv 可能未装依赖，PATH 也可能被空 venv 污染）
    local py=""
    for candidate in ".venv/bin/python" "python3" "/usr/bin/python3"; do
        if [ -x "$(command -v "${candidate}" 2>/dev/null || echo "${candidate}")" ] \
            && ${candidate} -c "import django" 2>/dev/null; then
            py="${candidate}"
            break
        fi
    done
    if [ -z "${py}" ]; then
        echo "❌ 未找到可用的 Python 解释器（需要已安装 Django）"
        echo "   请创建虚拟环境并安装依赖：cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
        return 1
    fi
    echo "ℹ️  使用 Python 解释器: ${py}"

    # 本地开发环境变量（端口/密码跟随 docker/.env）
    export DJANGO_SETTINGS_MODULE=config.settings.dev
    export DB_HOST=localhost
    export DB_PORT="${POSTGRES_PORT:-5432}"
    export DB_NAME="${POSTGRES_DB:-release_manager}"
    export DB_USER="${POSTGRES_USER:-release_manager}"
    export DB_PASSWORD="${POSTGRES_PASSWORD:-ReleaseManager@2024}"
    export REDIS_HOST=localhost
    export REDIS_PORT="${REDIS_PORT:-6379}"
    export REDIS_PASSWORD="${REDIS_PASSWORD:-ReleaseManager@2024}"
    export SECRET_KEY="${DJANGO_SECRET_KEY:-django-insecure-dev-only}"
    export CREDENTIAL_SECRET_KEY="${CREDENTIAL_SECRET_KEY:-dev-only-credential-secret-key-32!}"

    # 若 OpenLDAP 容器在运行（--test 模式），自动接上 LDAP 认证
    local ldap_container="${COMPOSE_PROJECT_NAME:-trace-ship-dev}-openldap"
    if docker ps --format "{{.Names}}" | grep -q "^${ldap_container}$"; then
        export LDAP_SERVER_URI="ldap://localhost:${LDAP_PORT:-389}"
        export LDAP_BIND_DN="cn=admin,dc=example,dc=com"
        export LDAP_BIND_PASSWORD="${LDAP_ADMIN_PASSWORD:-LDAPAdmin@2024}"
        export LDAP_USER_SEARCH_BASE="ou=users,dc=example,dc=com"
        echo "ℹ️  检测到 OpenLDAP 容器，已启用 LDAP 认证"
    fi

    # 等待 PostgreSQL 容器健康
    local pg_container="${COMPOSE_PROJECT_NAME:-trace-ship-dev}-postgres"
    if ! docker ps --format "{{.Names}}" | grep -q "^${pg_container}$"; then
        echo "❌ PostgreSQL 容器未运行，请先执行: scripts/dev.sh deps"
        return 1
    fi
    echo "⏳ 等待 PostgreSQL 就绪..."
    for i in $(seq 1 30); do
        [ "$(docker inspect -f '{{.State.Health.Status}}' "${pg_container}" 2>/dev/null)" = "healthy" ] && break
        sleep 1
    done

    echo "🔧 执行数据库迁移..."
    ${py} manage.py migrate

    echo "🚀 启动 Django 开发服务器: http://localhost:${BACKEND_PORT:-8000}"
    start_bg backend ${py} manage.py runserver "0.0.0.0:${BACKEND_PORT:-8000}"
    echo "🚀 启动 Celery worker（队列: celery）"
    start_bg celery-worker ${py} -m celery -A config worker -l info -Q celery --concurrency=2
}

# ---------- frontend：本地启动前端 ----------
cmd_frontend() {
    cd "${ROOT_DIR}/frontend"

    if [ ! -d node_modules ]; then
        echo "📦 首次运行，安装前端依赖..."
        npm install
    fi

    echo "🚀 启动 Vite 开发服务器: http://localhost:8855（/api 代理到 localhost:8000）"
    start_bg frontend npm run dev
}

# ---------- down：关闭所有 ----------
cmd_down() {
    echo "🛑 停止本地后端 / 前端进程..."
    stop_bg backend
    stop_bg frontend
    stop_bg celery-worker
    # 兜底：清理可能游离的进程
    pkill -f "manage.py runserver" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    pkill -f "celery -A config worker" 2>/dev/null || true

    echo "🛑 停止全部第三方容器（含 test / app profile）..."
    cd "${DOCKER_DIR}"
    compose_dev --profile test --profile app down

    echo "✅ 已全部关闭"
}

# ---------- status：查看状态 ----------
cmd_status() {
    echo "📋 本地进程:"
    for name in backend frontend celery-worker; do
        if pid_alive "${RUN_DIR}/${name}.pid"; then
            echo "  ✅ ${name} 运行中（PID $(cat "${RUN_DIR}/${name}.pid")）"
        else
            echo "  ⬜ ${name} 未运行"
        fi
    done
    echo ""
    echo "📋 第三方容器:"
    cd "${DOCKER_DIR}"
    compose_dev --profile test --profile app ps
}

# ---------- logs：跟踪日志 ----------
cmd_logs() {
    local target="$1"
    case "${target}" in
        backend|frontend|celery-worker)
            local log_file="${RUN_DIR}/${target}.log"
            [ -f "${log_file}" ] || { echo "❌ 日志不存在: ${log_file}"; return 1; }
            tail -f "${log_file}"
            ;;
        "")
            echo "❌ 用法: scripts/dev.sh logs <backend|frontend|celery-worker|compose服务名>"
            return 1
            ;;
        *)
            cd "${DOCKER_DIR}"
            compose_dev logs -f "${target}"
            ;;
    esac
}

# ---------- gitlab-admin：创建/重置 GitLab 管理员（admin / admin123） ----------
cmd_gitlab_admin() {
    load_env
    local gitlab_container="${COMPOSE_PROJECT_NAME:-trace-ship-dev}-gitlab"

    if ! docker ps --format "{{.Names}}" | grep -q "^${gitlab_container}$"; then
        echo "❌ GitLab 容器未运行，请先执行: scripts/dev.sh deps"
        return 1
    fi

    echo "⏳ 等待 GitLab 就绪（首次启动需数分钟）..."
    local ready=false
    for i in $(seq 1 120); do
        if [ "$(docker inspect -f '{{.State.Health.Status}}' "${gitlab_container}" 2>/dev/null)" = "healthy" ]; then
            ready=true
            break
        fi
        sleep 5
    done
    if [ "${ready}" != true ]; then
        echo "❌ 等待 GitLab 就绪超时，可执行 scripts/dev.sh logs gitlab 查看启动进度后重试"
        return 1
    fi

    echo "🔧 创建/重置管理员账号 admin（幂等，可重复执行）..."
    # 注意：邮箱不能用 admin@example.com（GitLab 内置 root 的默认邮箱，会撞唯一索引）
    # admin123 长度刚好 8 位但属弱密码，GitLab 默认弱密码校验可能拒绝，故用 save!(validate: false) 绕过
    docker exec "${gitlab_container}" gitlab-rails runner "
u = User.find_or_initialize_by(username: 'admin')
u.email = 'admin@trace-ship.local'
u.name = 'Administrator'
u.password = 'admin123'
u.password_confirmation = 'admin123'
u.admin = true
u.confirmed_at ||= Time.now
u.save!(validate: false)
puts 'admin user ready'
"

    echo ""
    echo "✅ GitLab 管理员已就绪："
    echo "   地址:  http://localhost:${GITLAB_HTTP_PORT:-18929}"
    echo "   账号:  admin / admin123"
    echo "   （内置 root 账号保留为兜底，密码见 docker/.env 中 GITLAB_ROOT_PASSWORD）"
}

# ---------- all：一键启动全部 ----------
cmd_all() {
    cmd_deps "$1"
    cmd_backend
    cmd_frontend
}

# ---------- 引导式菜单（无参数执行时进入） ----------
cmd_menu() {
    while true; do
        echo ""
        echo "====================================="
        echo "  Trace Ship 开发环境引导"
        echo "====================================="

        # 状态概览
        local be_status="⬜ 未运行" fe_status="⬜ 未运行"
        pid_alive "${RUN_DIR}/backend.pid" && be_status="✅ 运行中"
        pid_alive "${RUN_DIR}/frontend.pid" && fe_status="✅ 运行中"
        local cw_status="⬜ 未运行"
        pid_alive "${RUN_DIR}/celery-worker.pid" && cw_status="✅ 运行中"
        local dep_count=0
        dep_count=$(docker ps --format "{{.Names}}" 2>/dev/null | grep -c "^trace-ship-dev-") || true
        echo "  后端: ${be_status}   前端: ${fe_status}   Celery: ${cw_status}   第三方容器: ${dep_count} 个运行中"
        echo ""
        echo "  1) 启动第三方开发容器（PostgreSQL / Redis / GitLab）"
        echo "  2) 启动第三方开发容器 + 测试模拟（LDAP / SVN）"
        echo "  3) 启动后端（本地，自动迁移 + Celery worker）"
        echo "  4) 启动前端（本地 Vite）"
        echo "  5) 一键启动全部（依赖 + 后端 + 前端 + Celery worker）"
        echo "  6) 查看状态"
        echo "  7) 跟踪日志"
        echo "  8) 关闭所有"
        echo "  9) 创建 GitLab 管理员（admin / admin123）"
        echo "  0) 退出"
        echo ""
        read -rp "请选择 [0-9]: " choice

        case "${choice}" in
            1) cmd_deps || echo "⚠️ 操作失败，请检查上方输出" ;;
            2) cmd_deps --test || echo "⚠️ 操作失败，请检查上方输出" ;;
            3) cmd_backend || echo "⚠️ 操作失败，请检查上方输出" ;;
            4) cmd_frontend || echo "⚠️ 操作失败，请检查上方输出" ;;
            5) cmd_all || echo "⚠️ 操作失败，请检查上方输出" ;;
            6) cmd_status || true ;;
            7)
                read -rp "日志目标（backend / frontend / celery-worker / postgres / redis / gitlab ...）: " log_target
                [ -n "${log_target}" ] && cmd_logs "${log_target}"
                ;;
            8)
                read -rp "确认关闭所有（本地进程 + 第三方容器）？[y/N]: " confirm
                if [ "${confirm}" = "y" ] || [ "${confirm}" = "Y" ]; then
                    cmd_down || echo "⚠️ 操作失败，请检查上方输出"
                else
                    echo "已取消"
                fi
                ;;
            9) cmd_gitlab_admin || echo "⚠️ 操作失败，请检查上方输出" ;;
            0) echo "👋 再见"; exit 0 ;;
            *) echo "❌ 无效选择，请重新输入" ;;
        esac
    done
}

# ---------- 入口 ----------
case "${1:-}" in
    "")           cmd_menu ;;
    deps)         cmd_deps "$2" ;;
    backend)      cmd_backend ;;
    frontend)     cmd_frontend ;;
    all)          cmd_all "$2" ;;
    down)         cmd_down ;;
    status)       cmd_status ;;
    logs)         cmd_logs "$2" ;;
    gitlab-admin) cmd_gitlab_admin ;;
    *)
        echo "Trace Ship 开发环境脚本"
        echo ""
        echo "用法: scripts/dev.sh [命令]（无参数进入引导式菜单）"
        echo ""
        echo "  deps [--test]   启动第三方开发容器（--test 追加 LDAP/SVN 模拟）"
        echo "  backend         本地启动后端（自动迁移 + Celery worker，后台运行）"
        echo "  frontend        本地启动前端（Vite dev server，后台运行）"
        echo "  all [--test]    一键启动全部（依赖 + 后端 + 前端 + Celery worker）"
        echo "  down            关闭所有（本地进程 + 第三方容器）"
        echo "  status          查看运行状态"
        echo "  logs <目标>     跟踪日志（backend / frontend / celery-worker / compose 服务名）"
        echo "  gitlab-admin    创建/重置 GitLab 管理员（admin / admin123）"
        exit 1
        ;;
esac
