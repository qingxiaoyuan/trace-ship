#!/bin/bash
# SVN 仓库初始化脚本
set -e

REPO_ROOT=/home/svn
ADMIN_USER=${SVN_USER:-svnadmin}
ADMIN_PASS=${SVN_PASSWORD:-SVNAdmin@2024}

create_repo() {
    local repo_name=$1
    local repo_path="${REPO_ROOT}/${repo_name}"

    if [ -d "${repo_path}" ]; then
        echo "仓库已存在: ${repo_name}"
        return
    fi

    echo "创建 SVN 仓库: ${repo_name}"
    svnadmin create "${repo_path}"

    # 配置仓库权限
    cat > "${repo_path}/conf/svnserve.conf" <<EOF
[general]
anon-access = none
auth-access = write
password-db = passwd
authz-db = authz
realm = ${repo_name}
EOF

    cat > "${repo_path}/conf/passwd" <<EOF
[users]
${ADMIN_USER} = ${ADMIN_PASS}
EOF

    cat > "${repo_path}/conf/authz" <<EOF
[groups]
admins = ${ADMIN_USER}

[/]
@admins = rw
* = r
EOF

    # 创建标准目录结构
    svn mkdir -m "Init trunk/tags/branches" \
        "file://${repo_path}/trunk" \
        "file://${repo_path}/tags" \
        "file://${repo_path}/branches"
}

# 创建测试仓库
create_repo "demo-project"
create_repo "trace-ship"

echo "✅ SVN 仓库初始化完成"
