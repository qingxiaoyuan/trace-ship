#!/bin/sh
# OpenLDAP 初始化并启动脚本

set -e

DATA_DIR=/var/lib/openldap/openldap-data
CONFIG_FILE=/etc/openldap/slapd.conf
RUNTIME_CONFIG=/tmp/slapd-running.conf
ADMIN_PASSWORD="${LDAP_ADMIN_PASSWORD:-LDAPAdmin@2024}"

# 生成 SSHA 密码哈希
ADMIN_PASSWORD_HASH=$(/usr/sbin/slappasswd -s "$ADMIN_PASSWORD")

# 生成运行时配置文件（替换密码占位符）
sed "s|__LDAP_ADMIN_PASSWORD__|${ADMIN_PASSWORD_HASH}|g" "$CONFIG_FILE" > "$RUNTIME_CONFIG"

# 如果数据目录为空，初始化数据库
if [ -z "$(ls -A "$DATA_DIR" 2>/dev/null)" ]; then
    echo "✅ 初始化 OpenLDAP 数据库..."
    /usr/sbin/slaptest -f "$RUNTIME_CONFIG" -F "$DATA_DIR"
fi

# 启动 slapd 后台运行
/usr/sbin/slapd -f "$RUNTIME_CONFIG" -d 256 &
SLAPD_PID=$!

# 等待 slapd 就绪
echo "⏳ 等待 OpenLDAP 就绪..."
for i in $(seq 1 30); do
    if ldapsearch -x -H ldap://localhost:389 -D "cn=admin,dc=example,dc=com" -w "$ADMIN_PASSWORD" -b "dc=example,dc=com" -s base "(objectClass=*)" > /dev/null 2>&1; then
        echo "✅ OpenLDAP 已就绪"
        break
    fi
    sleep 1
done

# 导入测试数据（仅首次）
if [ ! -f "$DATA_DIR/.initialized" ]; then
    echo "✅ 导入测试用户数据..."
    for ldif in /docker-entrypoint-init.d/*.ldif; do
        if [ -f "$ldif" ]; then
            echo "导入: $ldif"
            ldapadd -x -H ldap://localhost:389 -D "cn=admin,dc=example,dc=com" -w "$ADMIN_PASSWORD" -f "$ldif" > /dev/null 2>&1 || true
        fi
    done
    touch "$DATA_DIR/.initialized"
fi

# 等待 slapd 进程结束
wait "$SLAPD_PID"
