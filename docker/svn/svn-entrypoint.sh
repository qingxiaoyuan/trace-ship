#!/bin/bash
# SVN 容器入口脚本
# 同时启动：
#   1. svnserve  → 提供 svn:// 协议访问（端口 3690）
#   2. apache2   → 提供 http:// 协议浏览/操作（端口 80，通过 mod_dav_svn）
# 账号体系：以 svnserve 的 conf/passwd 为准，启动时同步到 apache 的 htpasswd
set -e

REPO_ROOT=${SVN_REPO_ROOT:-/var/svn}
HTPASSWD_FILE=${HTPASSWD_FILE:-/etc/apache2/svn.htpasswd}
APACHE_LOCATIONS=${APACHE_LOCATIONS:-/etc/apache2/conf.d/svn-locations.conf}

# ---------- 1. 把所有仓库的 passwd 合并到 htpasswd ----------
sync_passwd_to_htpasswd() {
    : > "${HTPASSWD_FILE}"
    chmod 644 "${HTPASSWD_FILE}" 2>/dev/null || true

    local count=0
    for passwd_file in "${REPO_ROOT}"/*/conf/passwd; do
        [ -f "${passwd_file}" ] || continue
        # svnserve passwd 格式: "user = pass" 或 "# 注释"
        # htpasswd 接受 user:pass（plain，-p），这里用 bcrypt 不必要
        awk -F'=' '
            /^[[:space:]]*[^#[:space:]].*=/ {
                user=$1; pass=$2
                gsub(/[[:space:]]/, "", user)
                gsub(/[[:space:]]/, "", pass)
                if (user != "" && pass != "") print user ":" pass
            }
        ' "${passwd_file}" | while IFS=: read -r user pass; do
            htpasswd -b "${HTPASSWD_FILE}" "${user}" "${pass}" >/dev/null 2>&1 || true
            count=$((count + 1))
        done
    done
    echo "✅ 同步 SVN 账号到 htpasswd，共 $(grep -c ':' ${HTPASSWD_FILE} 2>/dev/null || echo 0) 条"
}

# ---------- 2. 为每个仓库生成 Apache <Location> 段 ----------
generate_apache_locations() {
    : > "${APACHE_LOCATIONS}"

    for repo_dir in "${REPO_ROOT}"/*/; do
        [ -d "${repo_dir}conf" ] || continue
        local name
        name=$(basename "${repo_dir}")

        cat >> "${APACHE_LOCATIONS}" <<EOF
# === ${name} ===
<Location /svn/${name}>
    DAV svn
    SVNPath ${repo_dir}
    AuthType Basic
    AuthName "Trace Ship SVN"
    AuthUserFile ${HTPASSWD_FILE}
    AuthzSVNAccessFile ${repo_dir}conf/authz
    Require valid-user
</Location>

EOF
    done

    # 列出所有仓库（便于浏览器发现）：挂在 /repos 下，避免和 /svn/<name> 子段路径冲突
    cat >> "${APACHE_LOCATIONS}" <<EOF
# === 仓库列表（挂载在 /repos，避免与 /svn/<name> 路径冲突）===
<Location /repos/>
    DAV svn
    SVNParentPath ${REPO_ROOT}
    SVNListParentPath On
    AuthType Basic
    AuthName "Trace Ship SVN"
    AuthUserFile ${HTPASSWD_FILE}
    Require valid-user
</Location>
EOF
}

# ---------- 3. 补全 apache 模块加载 ----------
# alpine 的 httpd.conf 默认不会加载 mod_dav_svn / mod_authz_svn。
# alpine 的 conf.d/dav.conf 已经把 mod_dav / mod_dav_fs 通过相对路径加载了
# （ServerRoot=/var/www 实际找不到，但模块会在 conf.d 第二次加载时报警告）。
# 这里把缺失的两个模块用绝对路径写到独立的 conf 文件里，被 IncludeOptional 自动加载。
ensure_apache_modules() {
    local conf=/etc/apache2/httpd.conf
    local svn_mod_conf=/etc/apache2/conf.d/svn-modules.conf

    cat > "${svn_mod_conf}" <<EOF
# 由 svn-entrypoint.sh 生成：mod_dav_svn 需要 mod_dav 的符号支持，必须用绝对路径加载
LoadModule dav_svn_module /usr/lib/apache2/mod_dav_svn.so
LoadModule authz_svn_module /usr/lib/apache2/mod_authz_svn.so
EOF

    if ! grep -q "^ServerName" "${conf}"; then
        echo "ServerName localhost" >> "${conf}"
    fi
}

echo "======================================="
echo "SVN 容器初始化"
echo "======================================="

ensure_apache_modules
sync_passwd_to_htpasswd
generate_apache_locations

# 让 apache 用户能写 SVN 仓库（HTTP 提交需要修改 db/）
if id apache >/dev/null 2>&1; then
    chown -R apache:apache /var/svn 2>/dev/null || true
    echo "✅ 已调整仓库权限给 apache 用户"
elif id www-data >/dev/null 2>&1; then
    chown -R www-data:www-data /var/svn 2>/dev/null || true
    echo "✅ 已调整仓库权限给 www-data 用户"
else
    chmod -R 777 /var/svn 2>/dev/null || true
    echo "⚠️  找不到 apache/www-data 用户，使用 777 权限"
fi

echo ""
echo "📂 已发现的 SVN 仓库："
for repo_dir in "${REPO_ROOT}"/*/; do
    [ -d "${repo_dir}conf" ] || continue
    echo "   - svn://localhost:3690/$(basename ${repo_dir})"
    echo "     http://localhost/svn/$(basename ${repo_dir})"
done

echo ""
echo "🚀 启动 svnserve (svn://) 与 apache2 (http://) ..."

# svnserve 后台跑（以 apache 用户运行，避免新文件 root 拥有）
if id apache >/dev/null 2>&1; then
    su apache -s /bin/sh -c "svnserve -d -r '${REPO_ROOT}'" 2>/dev/null || svnserve -d -r "${REPO_ROOT}"
elif id www-data >/dev/null 2>&1; then
    su www-data -s /bin/sh -c "svnserve -d -r '${REPO_ROOT}'" 2>/dev/null || svnserve -d -r "${REPO_ROOT}"
else
    svnserve -d -r "${REPO_ROOT}"
fi

# apache2 前台跑（容器主进程）
exec httpd -DFOREGROUND