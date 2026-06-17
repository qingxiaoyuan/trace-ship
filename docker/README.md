# Release Manager 第三方服务 Docker 一键部署

本目录用于集中管理 Release Manager 项目依赖的所有第三方外部系统的本地 Docker 开发/测试环境。

包含服务：

| 服务 | 用途 | 默认端口 |
|-----|------|---------|
| PostgreSQL | 主数据库 | 5432 |
| Redis | 缓存 / 会话 / 任务队列 | 6379 |
| Gitea | Git 仓库（GitLab 轻量替代） | 13000 |
| Jenkins | 自动打包构建 | 18080 |
| OpenLDAP | 域账号认证 | 389 |
| phpLDAPadmin | LDAP 管理界面 | 18090 |
| SVN Server | SVN 仓库 | 3690 |

## 目录结构

```
docker/
├── .env                          # 环境变量/密码配置
├── .env.example                  # 环境变量模板
├── docker-compose.yml            # 服务编排
├── start.sh                      # 一键启动
├── stop.sh                       # 一键停止
├── restart.sh                    # 一键重启
├── setup-docker-mirror.sh        # Docker 镜像加速器配置脚本
├── README.md                     # 本文件
├── jenkins/
│   ├── plugins.txt               # Jenkins 预装插件
│   └── init.groovy.d/            # Jenkins 初始化脚本
├── openldap/
│   ├── Dockerfile                # OpenLDAP 本地构建文件
│   ├── slapd.conf                # OpenLDAP 配置
│   ├── init.sh                   # OpenLDAP 启动初始化脚本
│   └── init/                     # LDAP 初始化数据
├── postgres/
│   └── init/                     # PostgreSQL 初始化脚本
└── svn/
    ├── Dockerfile                # SVN 本地构建文件
    └── create-repos.sh           # SVN 仓库初始化脚本（备用）
```

## 前置要求

- Docker 20.10+
- Docker Compose 2.0+
- Linux/macOS/Windows(WSL2)

## 快速开始

### 1. 进入目录

```bash
cd docker
```

### 2. 修改配置（可选）

```bash
cp .env.example .env
# 编辑 .env 修改密码和端口
```

### 3. 一键启动

```bash
./start.sh
```

脚本会自动：
- 检查 Docker 环境
- 创建持久化目录
- 拉取/构建镜像并启动所有服务
- 初始化 SVN 测试仓库
- 初始化 OpenLDAP 测试用户
- 打印各服务访问地址和账号

### 4. 一键停止

```bash
./stop.sh
```

### 5. 一键重启

```bash
./restart.sh
```

## 默认访问地址

### Gitea（Git 仓库）

- 地址：http://localhost:13000
- 管理员：`gitea_admin` / `GiteaAdmin@2024`

首次使用需要登录后创建仓库和 Token，然后在 Release Manager 中配置 Gitea 仓库。

### Jenkins（自动打包）

- 地址：http://localhost:18080
- 管理员：`admin` / `Jenkins@2024`

### OpenLDAP（域账号）

- 地址：`ldap://localhost:389`
- Base DN：`dc=example,dc=com`
- 管理员：`cn=admin,dc=example,dc=com` / `LDAPAdmin@2024`

### phpLDAPadmin

- 地址：http://localhost:18090
- Login DN：`cn=admin,dc=example,dc=com`

### SVN

- 地址：`svn://localhost:3690/demo-project`
- 本地轻量 SVN 服务（基于 Alpine 本地构建），默认无认证
- 启动时会自动创建 `demo-project` 和 `trace-ship` 两个测试仓库
- 如需认证，可修改 `svn/Dockerfile` 或接入 `svnserve.conf` 配置

### PostgreSQL

- 地址：`localhost:5432`
- 数据库：`release_manager`
- 用户：`release_manager` / `ReleaseManager@2024`

### Redis

- 地址：`localhost:6379`
- 密码：`ReleaseManager@2024`

## 测试账号（LDAP）

| 账号 | 密码 | 角色 |
|-----|------|-----|
| jiangxin | password123 | 开发人员 |
| zhangsan | password123 | 项目管理员 |
| lisi | password123 | 测试人员 |
| wangwu | password123 | 审核人 |

## 常见问题

### 1. 无法拉取 Docker 镜像 / Docker Hub 访问超时

当前环境可能无法直接访问 Docker Hub。可通过以下任一方式解决：

**方式一：配置 Docker 镜像加速器（推荐）**

编辑 `/etc/docker/daemon.json`，添加国内镜像加速器（以阿里云为例）：

```json
{
  "registry-mirrors": [
    "https://your-id.mirror.aliyuncs.com",
    "https://hub-mirror.c.163.com",
    "https://mirror.baidubce.com"
  ]
}
```

然后重启 Docker：

```bash
sudo systemctl restart docker
```

**方式二：使用私有镜像仓库前缀**

在 `.env` 中设置镜像前缀：

```bash
IMAGE_PREFIX=registry.cn-hangzhou.aliyuncs.com/your-namespace/
```

需提前将所需镜像推送到该私有仓库。

**方式三：手动导入离线镜像包**

在能访问 Docker Hub 的机器上导出镜像：

```bash
docker pull postgres:16 redis:7 gitea/gitea:1.21 jenkins/jenkins:lts osixia/phpldapadmin:latest
docker save -o release-manager-images.tar postgres:16 redis:7 gitea/gitea:1.21 jenkins/jenkins:lts osixia/phpldapadmin:latest
```

拷贝到目标机器后导入：

```bash
docker load -i release-manager-images.tar
```

### 2. 端口冲突

如果本地已有服务占用端口，修改 `.env` 文件中的对应端口，然后重启。

### 3. Jenkins 插件安装慢

Jenkins 首次启动会安装 `plugins.txt` 中的插件，可能需要 2-3 分钟。可以通过以下命令查看日志：

```bash
docker logs -f release-manager-dev-jenkins
```

### 4. 数据持久化

所有数据都通过 Docker Volume 持久化，停止服务不会丢失数据。如需完全重置：

```bash
./stop.sh
docker volume rm release-manager-dev_postgres_data release-manager-dev_redis_data release-manager-dev_gitea_data release-manager-dev_jenkins_home release-manager-dev_ldap_data release-manager-dev_svn_data
./start.sh
```

### 5. 放到单独机器部署

将整个 `docker` 目录复制到目标机器，修改 `.env` 中的端口和 IP，执行 `./start.sh` 即可。其他机器访问时把 `localhost` 换成目标机器 IP。

### 6. 切换 GitLab

Gitea 用于轻量测试。如需测试 GitLab，可将 `docker-compose.yml` 中的 `gitea` 服务替换为 GitLab 镜像（注意 GitLab 需要 4GB+ 内存）。

## 注意事项

- 本环境仅用于开发/测试，**不要直接用于生产**。
- 默认密码较弱，请在真实环境中修改 `.env` 中的密码。
- LDAP、Jenkins、SVN 等配置为最小可用配置，生产环境请按安全规范加固。
