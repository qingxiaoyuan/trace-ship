#!/bin/bash
# ============================================================
# Trace Ship 业务库运维脚本（备份 / 恢复 / 一致性检查）
#
# 引导式入口，给内网服务器升级前使用。仅操作 PostgreSQL 业务库，
# 不含 GitLab 代码仓库、Redis、打包工作区。
#
# 用法（发布包根目录，与 deploy.sh 同级）：
#   ./db.sh                 引导式菜单（推荐）
#   ./db.sh --backup
#   ./db.sh --restore [备份目录或 postgres.dump 路径]
#   ./db.sh --check
#   ./db.sh --check --load-image   先加载包内 backend.tar（不重建容器）
#   ./db.sh --restore FILE --yes   跳过确认（危险，仅自动化）
#
# 仓库内也可执行：scripts/db.sh（读取 docker/ 下生产编排）
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "====================================="
echo "Trace Ship 业务库运维"
echo "====================================="
echo ""

# ---------- 0. 定位编排与环境文件 ----------
resolve_layout() {
    if [ -f "${SCRIPT_DIR}/docker-compose.prod.yml" ] && [ -f "${SCRIPT_DIR}/docker-compose.deps.yml" ]; then
        WORK_DIR="${SCRIPT_DIR}"
        COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
        DEPS_COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.deps.yml"
        if [ -f "${SCRIPT_DIR}/.env.prod" ]; then
            ENV_FILE="${SCRIPT_DIR}/.env.prod"
        else
            ENV_FILE=""
        fi
        return
    fi

    local repo_docker
    repo_docker="$(cd "${SCRIPT_DIR}/.." && pwd)/docker"
    if [ -f "${repo_docker}/docker-compose.prod.yml" ] && [ -f "${repo_docker}/docker-compose.deps.yml" ]; then
        WORK_DIR="${repo_docker}"
        COMPOSE_FILE="${repo_docker}/docker-compose.prod.yml"
        DEPS_COMPOSE_FILE="${repo_docker}/docker-compose.deps.yml"
        if [ -f "${repo_docker}/.env.prod" ]; then
            ENV_FILE="${repo_docker}/.env.prod"
        elif [ -f "${repo_docker}/.env" ]; then
            ENV_FILE="${repo_docker}/.env"
            echo "⚠️  未找到 docker/.env.prod，回退使用 docker/.env"
        else
            ENV_FILE=""
        fi
        return
    fi

    echo "❌ 未找到 docker-compose.prod.yml / docker-compose.deps.yml"
    echo "   请在发布包根目录执行 ./db.sh，或在仓库内执行 scripts/db.sh"
    exit 1
}

resolve_layout
cd "${WORK_DIR}"
BACKUP_ROOT="${WORK_DIR}/backups"
NETWORK_NAME="trace-ship-net"
BACKEND_IMAGE="trace-ship/backend:latest"

if ! command -v docker &> /dev/null; then
    echo "❌ 未安装 Docker"
    exit 1
fi
if ! docker compose version &> /dev/null; then
    echo "❌ 未安装 Docker Compose v2"
    exit 1
fi

compose() {
    docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

compose_deps() {
    docker compose --env-file "${ENV_FILE}" -f "${DEPS_COMPOSE_FILE}" "$@"
}

require_env_file() {
    if [ -z "${ENV_FILE}" ] || [ ! -f "${ENV_FILE}" ]; then
        echo "❌ 未找到 .env.prod，请先完成第一次部署（./deploy.sh --full）"
        exit 1
    fi
}

load_env() {
    require_env_file
    set -a
    # shellcheck disable=SC1090
    source "${ENV_FILE}"
    set +a
    POSTGRES_DB="${POSTGRES_DB:-release_manager}"
    POSTGRES_USER="${POSTGRES_USER:-release_manager}"
    if [ -z "${POSTGRES_PASSWORD}" ]; then
        echo "❌ .env.prod 中缺少 POSTGRES_PASSWORD"
        exit 1
    fi
}

psql_exec() {
    compose_deps exec -T \
        -e PGPASSWORD="${POSTGRES_PASSWORD}" \
        postgres \
        psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 "$@"
}

ensure_postgres() {
    load_env
    if ! compose_deps ps --status running --services 2>/dev/null | grep -qx postgres; then
        echo "  ▶ PostgreSQL 未运行，正在启动 postgres ..."
        compose_deps up -d postgres
        echo "  ▶ 等待 PostgreSQL 健康检查通过..."
        compose_deps up -d --wait postgres
    fi
}

dump_path_from_arg() {
    local arg="$1"
    if [ -z "${arg}" ]; then
        echo ""
        return
    fi
    if [ -f "${arg}" ]; then
        echo "${arg}"
        return
    fi
    if [ -f "${BACKUP_ROOT}/${arg}/postgres.dump" ]; then
        echo "${BACKUP_ROOT}/${arg}/postgres.dump"
        return
    fi
    if [ -d "${arg}" ] && [ -f "${arg}/postgres.dump" ]; then
        echo "${arg}/postgres.dump"
        return
    fi
    echo ""
}

list_backup_dirs() {
    if [ ! -d "${BACKUP_ROOT}" ]; then
        return
    fi
    find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort
}

# ---------- 备份 ----------
do_backup() {
    ensure_postgres
    mkdir -p "${BACKUP_ROOT}"
    chmod 700 "${BACKUP_ROOT}" 2>/dev/null || true

    local stamp dir dump meta
    stamp="$(date +%Y%m%d-%H%M%S)"
    dir="${BACKUP_ROOT}/${stamp}"
    dump="${dir}/postgres.dump"
    meta="${dir}/META.txt"
    mkdir -p "${dir}"
    chmod 700 "${dir}"

    echo "📦 备份 PostgreSQL 业务库..."
    echo "   库名: ${POSTGRES_DB}  用户: ${POSTGRES_USER}"
    echo "   目录: ${dir}"

    compose_deps exec -T \
        -e PGPASSWORD="${POSTGRES_PASSWORD}" \
        postgres \
        pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc --no-owner --no-acl \
        > "${dump}"

    if [ ! -s "${dump}" ]; then
        echo "❌ 备份文件为空，请检查 postgres 容器日志"
        rm -rf "${dir}"
        exit 1
    fi
    chmod 600 "${dump}"

    if [ -f "${ENV_FILE}" ]; then
        cp "${ENV_FILE}" "${dir}/env.prod.snapshot"
        chmod 600 "${dir}/env.prod.snapshot"
    fi
    if [ -f "${WORK_DIR}/VERSION" ]; then
        cp "${WORK_DIR}/VERSION" "${dir}/VERSION"
    fi

    cat > "${meta}" <<EOF
BACKUP_TIME=$(date '+%Y-%m-%d %H:%M:%S')
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_USER=${POSTGRES_USER}
HOST=$(hostname 2>/dev/null || echo unknown)
SIZE=$(du -h "${dump}" | cut -f1)
NOTE=仅包含 Trace Ship 业务库（PostgreSQL），不含 GitLab / Redis / 打包工作区
EOF
    chmod 600 "${meta}"

    echo ""
    echo "✅ 备份完成: ${dump}"
    echo "   大小: $(du -h "${dump}" | cut -f1)"
    echo "   已同时保存 env.prod.snapshot（含密钥，请妥善保管）"
}

# ---------- 恢复 ----------
pick_restore_dump() {
    local arg="$1"
    local resolved
    resolved="$(dump_path_from_arg "${arg}")"
    if [ -n "${resolved}" ]; then
        RESTORE_DUMP_FILE="${resolved}"
        return
    fi

    local dirs=()
    while IFS= read -r line; do
        [ -n "${line}" ] && dirs+=("${line}")
    done < <(list_backup_dirs)

    if [ ${#dirs[@]} -eq 0 ]; then
        echo "❌ 未找到备份。默认目录: ${BACKUP_ROOT}"
        echo "   请先执行备份，或把 postgres.dump 路径作为参数传入"
        exit 1
    fi

    if [ ! -t 0 ]; then
        echo "❌ 非交互模式请指定备份：./db.sh --restore <目录或 postgres.dump>"
        exit 1
    fi

    echo "可用备份："
    local i=1
    for d in "${dirs[@]}"; do
        local name size
        name="$(basename "${d}")"
        if [ -f "${d}/postgres.dump" ]; then
            size="$(du -h "${d}/postgres.dump" | cut -f1)"
            echo "  ${i}) ${name}  (${size})"
        else
            echo "  ${i}) ${name}  (缺少 postgres.dump，跳过)"
        fi
        i=$((i + 1))
    done
    echo "  0) 取消"
    echo ""
    local choice
    read -rp "请选择要恢复的备份编号: " choice
    if [ "${choice}" = "0" ] || [ -z "${choice}" ]; then
        echo "👋 已取消"
        exit 0
    fi
    if ! [[ "${choice}" =~ ^[0-9]+$ ]] || [ "${choice}" -lt 1 ] || [ "${choice}" -gt ${#dirs[@]} ]; then
        echo "❌ 无效选择"
        exit 1
    fi
    local selected="${dirs[$((choice - 1))]}/postgres.dump"
    if [ ! -f "${selected}" ]; then
        echo "❌ 该备份缺少 postgres.dump"
        exit 1
    fi
    RESTORE_DUMP_FILE="${selected}"
}

do_restore() {
    local dump="$1"
    local skip_confirm="${2:-0}"
    if [ ! -f "${dump}" ]; then
        echo "❌ 备份文件不存在: ${dump}"
        exit 1
    fi

    ensure_postgres
    echo ""
    echo "⚠️  即将用备份覆盖当前业务库 ${POSTGRES_DB}"
    echo "   备份: ${dump}"
    echo "   大小: $(du -h "${dump}" | cut -f1)"
    echo "   仅恢复 Trace Ship 业务库，不含 GitLab 代码仓库、Redis、打包工作区。"
    echo "   会先停止应用层（backend / celery / frontend），PostgreSQL / Redis / GitLab 保持运行。"
    echo "   此操作不可撤销（除非你还有另一份备份）。"
    echo ""

    if [ "${skip_confirm}" != "1" ]; then
        if [ ! -t 0 ]; then
            echo "❌ 非交互恢复请加 --yes"
            exit 1
        fi
        local confirm
        read -rp "确认恢复请输入 restore: " confirm
        if [ "${confirm}" != "restore" ]; then
            echo "👋 已取消"
            exit 0
        fi
    fi

    echo "  ▶ 停止应用层，避免占用数据库连接..."
    compose stop backend celery-worker celery-beat frontend >/dev/null 2>&1 || true

    echo "  ▶ 断开业务库现有连接..."
    compose_deps exec -T \
        -e PGPASSWORD="${POSTGRES_PASSWORD}" \
        postgres \
        psql -U "${POSTGRES_USER}" -d postgres -v ON_ERROR_STOP=1 \
        -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();" \
        >/dev/null

    echo "  ▶ 重建数据库并导入备份..."
    compose_deps exec -T \
        -e PGPASSWORD="${POSTGRES_PASSWORD}" \
        postgres \
        psql -U "${POSTGRES_USER}" -d postgres -v ON_ERROR_STOP=1 \
        -c "DROP DATABASE IF EXISTS \"${POSTGRES_DB}\";" \
        -c "CREATE DATABASE \"${POSTGRES_DB}\" OWNER \"${POSTGRES_USER}\";"

    set -o pipefail
    if ! cat "${dump}" | compose_deps exec -T \
        -e PGPASSWORD="${POSTGRES_PASSWORD}" \
        postgres \
        pg_restore -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --no-acl --exit-on-error; then
        set +o pipefail
        echo "❌ 恢复失败，数据库可能不完整。请检查备份文件后重试。"
        exit 1
    fi
    set +o pipefail

    echo ""
    echo "✅ 业务库已恢复"
    if [ ! -t 0 ]; then
        echo "   非交互模式未自动拉起应用。需要时执行: ./deploy.sh --app"
        return
    fi
    local restart
    read -rp "是否重新启动应用层？[Y/n] " restart
    restart="${restart:-Y}"
    case "${restart}" in
        Y|y|yes|YES)
            echo "  ▶ 启动应用层..."
            compose up -d
            echo "✅ 应用层已启动"
            ;;
        *)
            echo "   已跳过启动。需要时执行: ./deploy.sh --app"
            ;;
    esac
}

# ---------- 一致性检查 ----------
count_duplicate_repo_urls() {
    compose_deps exec -T \
        -e PGPASSWORD="${POSTGRES_PASSWORD}" \
        postgres \
        psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tAc \
        "SELECT COUNT(*) FROM (SELECT 1 FROM sys_repo GROUP BY vendor, url HAVING COUNT(*) > 1) dup;"
}

sql_inventory() {
    echo "---- SQL 盘点（不改数据）----"
    psql_exec <<'SQL'
\pset pager off
\echo '仓库总数:'
SELECT COUNT(*) AS repositories FROM sys_repo;

\echo ''
\echo '按原始 URL 完全相同的重复登记:'
SELECT vendor, url, COUNT(*) AS n
FROM sys_repo
GROUP BY vendor, url
HAVING COUNT(*) > 1
ORDER BY n DESC, vendor, url;

\echo ''
\echo 'Git 仓库缺少 external_identity:'
SELECT id::text, name, url
FROM sys_repo
WHERE COALESCE(repo_type, '') IN ('git', '')
  AND COALESCE(external_identity, '') = ''
ORDER BY created_at;

\echo ''
\echo '新表是否已创建（升级后应存在 project_component）:'
SELECT
  to_regclass('public.project_component') AS project_component,
  to_regclass('public.repository_credential_loan') AS repository_credential_loan;
SQL
}

has_backend_image() {
    docker image inspect "${BACKEND_IMAGE}" >/dev/null 2>&1
}

maybe_load_backend_image() {
    local force_load="$1"
    local tar="${WORK_DIR}/images/backend.tar"
    if [ ! -f "${tar}" ]; then
        if [ "${force_load}" = "1" ]; then
            echo "⚠️  未找到 ${tar}，跳过加载镜像"
        fi
        return
    fi
    if [ "${force_load}" = "1" ]; then
        echo "📦 加载 ${tar}（不重建容器）..."
        docker load -i "${tar}"
        return
    fi
    # 仅独立菜单进入检查时询问；deploy.sh 调用 --check 时镜像已 load，不再打断
    if [ "${FROM_MENU}" != "1" ] || [ ! -t 0 ]; then
        return
    fi
    local ans
    read -rp "检测到包内 images/backend.tar，是否先加载新镜像再用新代码检查旧库？不重建正在运行的容器 [Y/n] " ans
    ans="${ans:-Y}"
    case "${ans}" in
        Y|y|yes|YES)
            echo "📦 加载 ${tar}（不重建容器）..."
            docker load -i "${tar}"
            ;;
    esac
}

run_django_check() {
    if ! has_backend_image; then
        echo "⚠️  本地没有 ${BACKEND_IMAGE}，跳过 Django 一致性命令。"
        echo "   可先加载包内 images/backend.tar，或完成 ./deploy.sh --app 后再查。"
        return 2
    fi
    if ! docker network inspect "${NETWORK_NAME}" >/dev/null 2>&1; then
        echo "⚠️  网络 ${NETWORK_NAME} 不存在，跳过 Django 一致性命令。"
        return 2
    fi

    echo "---- Django 一致性检查（check_product_repository_consistency）----"
    set +e
    docker run --rm \
        --network "${NETWORK_NAME}" \
        --env-file "${ENV_FILE}" \
        -e TZ="${TIMEZONE:-Asia/Shanghai}" \
        -e DJANGO_SETTINGS_MODULE=config.settings.prod \
        -e DEBUG=False \
        -e DB_HOST=postgres \
        -e DB_PORT=5432 \
        -e DB_NAME="${POSTGRES_DB}" \
        -e DB_USER="${POSTGRES_USER}" \
        -e DB_PASSWORD="${POSTGRES_PASSWORD}" \
        -e REDIS_HOST=redis \
        -e REDIS_PORT=6379 \
        -e REDIS_PASSWORD="${REDIS_PASSWORD}" \
        -e SECRET_KEY="${DJANGO_SECRET_KEY}" \
        -e CREDENTIAL_SECRET_KEY="${CREDENTIAL_SECRET_KEY}" \
        -e ALLOWED_HOSTS="${ALLOWED_HOSTS:-localhost,backend}" \
        -e PACKAGE_WORKSPACE_ROOT="${PACKAGE_WORKSPACE_ROOT:-/data/trace-ship/package_workspaces}" \
        --entrypoint python \
        "${BACKEND_IMAGE}" \
        manage.py check_product_repository_consistency --json --strict
    local status=$?
    set -e
    if [ "${status}" -eq 0 ]; then
        echo "✅ Django 一致性检查通过"
        return 0
    fi
    echo "⚠️  Django 一致性检查未通过（退出码 ${status}）。"
    echo "   若提示 Unknown command，说明当前 backend 镜像还是旧版，请先加载本包 images/backend.tar。"
    return "${status}"
}

do_check() {
    local load_image="${1:-0}"
    ensure_postgres
    maybe_load_backend_image "${load_image}"
    echo ""
    sql_inventory
    local dup_count
    dup_count="$(count_duplicate_repo_urls | tr -d '[:space:]')"
    dup_count="${dup_count:-0}"
    echo ""
    local django_status=0
    set +e
    run_django_check
    django_status=$?
    set -e
    echo ""
    echo "====================================="
    if [ "${dup_count}" != "0" ]; then
        echo "❌ 检查结束：发现 ${dup_count} 组重复物理仓库，必须先处理后才能升级"
        echo "   python manage.py merge_duplicate_repositories --primary <UUID> --duplicate <UUID>"
        echo "====================================="
        return 1
    fi
    if [ "${django_status}" -eq 0 ]; then
        echo "✅ 检查结束：SQL 无重复仓库，Django --strict 通过"
        echo "====================================="
        return 0
    fi
    if [ "${django_status}" -eq 2 ]; then
        echo "ℹ️  检查结束：SQL 无重复仓库；Django 命令未执行"
        echo "====================================="
        return 0
    fi
    echo "⚠️  Django 一致性命令失败（退出码 ${django_status}），但 SQL 未见重复仓库。"
    echo "   这通常是镜像过旧或一次性连库问题，不一定阻断升级。"
    if [ -t 0 ]; then
        local go
        read -rp "是否视为通过并继续？[y/N] " go
        case "${go}" in
            Y|y|yes|YES)
                echo "====================================="
                return 0
                ;;
        esac
        echo "👋 已中止"
        echo "====================================="
        return 1
    fi
    echo "   非交互模式：无重复仓库，不阻断。"
    echo "====================================="
    return 0
}

print_help() {
    cat <<'EOF'
用法:
  ./db.sh                      引导式菜单
  ./db.sh --backup             备份 PostgreSQL 业务库到 ./backups/<时间戳>/
  ./db.sh --restore [目标]     恢复备份（交互选择或指定目录/dump）
  ./db.sh --restore 目标 --yes 跳过确认直接恢复
  ./db.sh --check              SQL 盘点 + Django 一致性检查
  ./db.sh --check --load-image 检查前加载 images/backend.tar（不重建容器）
  ./db.sh --help

说明:
  - 只动 Trace Ship 业务库，不动 GitLab / Redis / 打包工作区。
  - 备份目录默认与 compose 文件同级的 backups/（已加入 .gitignore）。
  - 升级前建议：先 --backup，再 --check，无重复仓库后再 ./deploy.sh --app 或 --upgrade。
  - 只备份/恢复 PostgreSQL 业务库，不含 GitLab / Redis / 打包工作区。
EOF
}

# ---------- 入口 ----------
MODE="${1:-}"
RESTORE_TARGET=""
RESTORE_YES=0
CHECK_LOAD_IMAGE=0
FROM_MENU=0

if [ -z "${MODE}" ]; then
    FROM_MENU=1
    echo "  1) 备份业务库（PostgreSQL）"
    echo "  2) 恢复业务库（覆盖当前库，需输入 restore 确认）"
    echo "  3) 一致性检查（升级前/后盘点重复仓库）"
    echo "  0) 退出"
    echo ""
    read -rp "请输入编号 [0-3]: " choice
    case "${choice}" in
        1) MODE="--backup" ;;
        2) MODE="--restore" ;;
        3) MODE="--check" ;;
        0) echo "👋 已取消"; exit 0 ;;
        *) echo "❌ 无效选择"; exit 1 ;;
    esac
fi

shift $(( $# > 0 ? 1 : 0 )) || true
while [ $# -gt 0 ]; do
    case "$1" in
        --yes|-y) RESTORE_YES=1 ;;
        --load-image) CHECK_LOAD_IMAGE=1 ;;
        --help|-h)
            print_help
            exit 0
            ;;
        --backup|--restore|--check)
            echo "❌ 请只指定一个操作"
            exit 1
            ;;
        *)
            if [ -z "${RESTORE_TARGET}" ]; then
                RESTORE_TARGET="$1"
            else
                echo "❌ 未知参数: $1"
                print_help
                exit 1
            fi
            ;;
    esac
    shift
done

if [ -n "${RESTORE_TARGET}" ] && [ "${MODE}" != "--restore" ]; then
    echo "❌ 多余参数: ${RESTORE_TARGET}"
    print_help
    exit 1
fi

case "${MODE}" in
    --help|-h)
        print_help
        ;;
    --backup)
        do_backup
        ;;
    --restore)
        RESTORE_DUMP_FILE=""
        pick_restore_dump "${RESTORE_TARGET}"
        do_restore "${RESTORE_DUMP_FILE}" "${RESTORE_YES}"
        ;;
    --check)
        do_check "${CHECK_LOAD_IMAGE}"
        ;;
    *)
        echo "❌ 未知参数: ${MODE}"
        print_help
        exit 1
        ;;
esac
