#!/bin/bash
# 配置 Docker 镜像加速器
# 需要 root 权限执行

set -e

cat > /etc/docker/daemon.json <<'EOF'
{
  "data-root": "/media/sangfor/vdb/docker",
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com"
  ]
}
EOF

echo "✅ Docker 镜像加速器已写入 /etc/docker/daemon.json"
echo ""
echo "🔄 重启 Docker 服务..."
systemctl restart docker
systemctl status docker --no-pager

echo ""
echo "====================================="
echo "配置完成，现在可以执行 ./start.sh 启动服务"
echo "====================================="
