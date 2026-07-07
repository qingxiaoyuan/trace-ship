# Release Manager 第三方服务 Docker 一键部署

本目录用于集中管理 Release Manager 项目依赖的所有第三方外部系统的本地 Docker 开发/测试环境。

包含服务：

| 服务 | 用途 | 默认端口 |
|-----|------|---------|
| PostgreSQL | 主数据库 | 5432 |
| Redis | 缓存 / 会话 / 任务队列 | 6379 |
| Gitea | Git 仓库（GitLab 轻量替代） | 13000 |
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
docker pull postgres:16 redis:7 gitea/gitea:1.21 osixia/phpldapadmin:latest
docker save -o release-manager-images.tar postgres:16 redis:7 gitea/gitea:1.21 osixia/phpldapadmin:latest
```

拷贝到目标机器后导入：

```bash
docker load -i release-manager-images.tar
```

### 2. 端口冲突

如果本地已有服务占用端口，修改 `.env` 文件中的对应端口，然后重启。

### 3. 数据持久化

所有数据都通过 Docker Volume 持久化，停止服务不会丢失数据。如需完全重置：

```bash
./stop.sh
docker volume rm release-manager-dev_postgres_data release-manager-dev_redis_data release-manager-dev_gitea_data release-manager-dev_ldap_data release-manager-dev_svn_data
./start.sh
```

### 4. 放到单独机器部署

将整个 `docker` 目录复制到目标机器，修改 `.env` 中的端口和 IP，执行 `./start.sh` 即可。其他机器访问时把 `localhost` 换成目标机器 IP。

### 5. 切换 GitLab

Gitea 用于轻量测试。如需测试 GitLab，可将 `docker-compose.yml` 中的 `gitea` 服务替换为 GitLab 镜像（注意 GitLab 需要 4GB+ 内存）。

## 生产环境部署

生产环境使用独立的 `docker-compose.prod.yml`，仅包含应用运行必需的服务：PostgreSQL / Redis / Backend / Frontend / Celery Worker / Celery Beat。开发用的第三方依赖（Gitea / OpenLDAP / phpLDAPadmin / SVN / Jenkins）不纳入，生产环境请按需接入外部服务。

### 与开发环境的区别

| 项 | 开发 (docker-compose.yml) | 生产 (docker-compose.prod.yml) |
|----|---------------------------|--------------------------------|
| 后端代码 | 挂载源码卷 `../backend:/app` | 镜像内打包（`COPY . .`） |
| 第三方依赖 | 含 Gitea/LDAP/SVN 等 | 仅 PostgreSQL/Redis |
| 端口暴露 | backend/postgres/redis 对外 | 仅前端 80 对外，其余内部网络 |
| 配置文件 | `.env`（弱密码可接受） | `.env.prod`（强制强密钥） |
| Django settings | `config.settings.dev` | `config.settings.prod` |

### 生产部署步骤

1. 进入 docker 目录：

   ```bash
   cd docker
   ```

2. 复制生产配置模板并填写真实值：

   ```bash
   cp .env.prod.example .env.prod
   vi .env.prod
   ```

   **必须修改的项**（`prod.py` 启动时会校验，未修改将拒绝启动）：

   - `DJANGO_SECRET_KEY`：随机 50+ 字符，生成方式：
     ```bash
     python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
     ```
   - `CREDENTIAL_SECRET_KEY`：32 字节随机串，生成方式：
     ```bash
     python -c "import secrets; print(secrets.token_urlsafe(32))"
     ```
   - `POSTGRES_PASSWORD` / `REDIS_PASSWORD`：强密码
   - `ALLOWED_HOSTS`：替换 `YOUR_SERVER_IP` 为真实服务器 IP，逗号分隔
   - `CORS_ALLOWED_ORIGINS`：替换为 `http://真实服务器IP`（端口非 80 时带端口）

3. 一键启动：

   ```bash
   ./start-prod.sh
   ```

   脚本会自动校验配置，构建镜像并启动所有服务。首次构建需要数分钟。

4. 访问：浏览器打开 `http://服务器IP`（默认 80 端口，可在 `.env.prod` 的 `FRONTEND_PORT` 修改）。

### 常用运维命令

```bash
# 查看服务状态
docker compose -f docker-compose.prod.yml ps

# 查看后端日志
docker compose -f docker-compose.prod.yml logs -f backend

# 查看所有日志
docker compose -f docker-compose.prod.yml logs -f

# 停止服务
docker compose -f docker-compose.prod.yml down

# 重新构建并启动（代码更新后）
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build

# 进入后端容器执行命令
docker compose -f docker-compose.prod.yml exec backend python manage.py createsuperuser
```

### 数据持久化

生产环境使用 Docker Volume 持久化以下数据：

| Volume / 挂载 | 类型 | 用途 |
|---------------|------|------|
| `postgres_data` | 命名卷 | PostgreSQL 数据 |
| `redis_data` | 命名卷 | Redis 持久化 |
| `backend_logs` | 命名卷 | 后端日志（`/var/log/trace-ship`） |
| `${PACKAGE_WORKSPACE_ROOT}` | bind mount | 打包工作区（宿主机与容器同路径） |
| `celerybeat_schedule` | 命名卷 | Celery Beat 调度状态 |

完全重置（⚠️ 会删除命名卷数据，但不会删除 bind mount 的打包工作区）：

```bash
docker compose -f docker-compose.prod.yml down -v
```

### Docker 打包任务（DooD 方式）

系统的打包能力（`apps.package`）通过在容器内调用 `docker run` 启动构建容器来执行打包。生产部署采用 **DooD（Docker out of Docker）** 方式实现：

1. **backend / celery-worker 镜像内预装 docker CLI**（仅客户端，不含 daemon）。
2. **挂载宿主机 `/var/run/docker.sock`** 到容器内，容器内的 `docker` 命令通过该 socket 由宿主机 dockerd 执行。
3. **打包工作区用 bind mount 且宿主机/容器路径一致**（`PACKAGE_WORKSPACE_ROOT`）。

> 为什么路径必须一致？打包时执行 `docker run -v {workspace}/source:/workspace/source ...`，这个 `-v` 挂载由宿主机 dockerd 执行，源路径必须是宿主机真实路径。若容器内路径与宿主机不一致，构建容器会挂载到空目录或失败。

**前提条件**：宿主机已安装 Docker 并运行 dockerd，且 `/var/run/docker.sock` 可用。

**安全提示**：挂载 docker.sock 等于赋予容器宿主机 root 权限，请确保部署环境受控。

### 安全注意事项

- `.env.prod` 含敏感密钥，已被 `.gitignore` 忽略，切勿提交。
- 生产环境 backend / postgres / redis 仅在内部网络通信，不对外暴露端口；所有外部请求经前端 nginx 反代 `/api/` 访问后端。
- `prod.py` 强制 `DEBUG=False`、`CORS_ALLOW_ALL_ORIGINS=False`、`SESSION_COOKIE_SECURE=True`，部署在 HTTPS 反向代理后效果最佳。

## 注意事项

- 本环境仅用于开发/测试，**不要直接用于生产**。
- 默认密码较弱，请在真实环境中修改 `.env` 中的密码。
- LDAP、SVN 等配置为最小可用配置，生产环境请按安全规范加固。
