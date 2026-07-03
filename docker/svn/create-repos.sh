#!/bin/bash
# SVN 仓库初始化脚本（容器内运行）
# 在 docker/start.sh 启动 SVN 服务后被调用，负责：
#   1. 创建标准仓库目录（trunk/tags/branches）
#   2. 写入 svnserve.conf / passwd / authz，配置真实场景下的多角色账号
set -e

REPO_ROOT=${SVN_REPO_ROOT:-/var/svn}

# 三类账号密码（模拟真实研发协作场景）
ADMIN_USER=${SVN_ADMIN_USER:-admin}
ADMIN_PASS=${SVN_ADMIN_PASSWORD:-SVNAdmin@2024}
DEV_USER=${SVN_DEV_USER:-developer}
DEV_PASS=${SVN_DEV_PASSWORD:-Developer@2024}
VIEWER_USER=${SVN_VIEWER_USER:-viewer}
VIEWER_PASS=${SVN_VIEWER_PASSWORD:-Viewer@2024}

write_repo_config() {
    local repo_path=$1
    local realm=$2

    cat > "${repo_path}/conf/svnserve.conf" <<EOF
[general]
anon-access = none
auth-access = write
password-db = passwd
authz-db = authz
realm = ${realm}

[sasl]
use-sasl = false
EOF

    cat > "${repo_path}/conf/passwd" <<EOF
[users]
${ADMIN_USER} = ${ADMIN_PASS}
${DEV_USER} = ${DEV_PASS}
${VIEWER_USER} = ${VIEWER_PASS}
EOF
    chmod 600 "${repo_path}/conf/passwd"

    cat > "${repo_path}/conf/authz" <<EOF
[groups]
admins = ${ADMIN_USER}
developers = ${DEV_USER}
viewers = ${VIEWER_USER}

# 仓库根：所有认证用户可浏览
[/]
@admins = rw
@developers = r
@viewers = r

# 主干：日常开发提交
[/trunk]
@admins = rw
@developers = rw
@viewers = r

# 分支：创建/合并特性分支
[/branches]
@admins = rw
@developers = rw
@viewers = r

# Tag：仅 admin（发布流程）可写，开发只读防止误推
[/tags]
@admins = rw
@developers = r
@viewers = r
EOF
    chmod 644 "${repo_path}/conf/authz"
}

create_repo() {
    local repo_name=$1
    local repo_path="${REPO_ROOT}/${repo_name}"

    if [ ! -d "${repo_path}" ]; then
        echo "创建 SVN 仓库: ${repo_name}"
        svnadmin create "${repo_path}"
        # 创建标准目录结构
        svn mkdir -m "Init trunk/tags/branches" \
            "file://${repo_path}/trunk" \
            "file://${repo_path}/tags" \
            "file://${repo_path}/branches"
    else
        echo "仓库已存在: ${repo_name}"
    fi

    write_repo_config "${repo_path}" "${repo_name} SVN Repository"
}

# 默认创建两个示例仓库
create_repo "demo-project"
create_repo "trace-ship"

echo "✅ SVN 仓库账号配置完成"
echo "   admin     / ${ADMIN_PASS}        （全权限 rw，可推 tag）"
echo "   ${DEV_USER}  / ${DEV_PASS}   （trunk/branches 读写，tag 只读）"
echo "   ${VIEWER_USER}   / ${VIEWER_PASS}     （全只读）"