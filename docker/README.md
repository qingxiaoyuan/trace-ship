# Trace Ship 第三方服务 Docker 一键部署

本目录用于集中管理 Trace Ship 项目依赖的第三方系统的 Docker 编排，以及生产环境部署。

## 服务构成

### 基础依赖（默认启动，与生产环境对齐）

| 服务 | 用途 | 默认端口 |
|-----|------|---------|
| PostgreSQL | 主数据库 | 5432 |
| Redis | 缓存 / 会话 / 任务队列 | 6379 |
| GitLab | 代码仓库（分支/提交/MR/tag，发布推 tag 目标） | 18929（HTTP）/ 2224（SSH） |

### 测试环境模拟服务（`--profile test` 启动）

| 服务 | 用途 | 默认端口 |
|-----|------|---------|
| OpenLDAP | 域账号认证模拟 | 389 |
| phpLDAPadmin | LDAP 管理界面 | 18090 |
| SVN Server | 打包产物推送模拟目标 | 3690（svn）/ 3691（http） |

### 应用服务（`--profile app`，一般本地开发不使用）

backend / frontend / celery-worker / celery-beat。开发时建议在本地启动应用，便于热重载和断点调试。

## 目录结构

```
docker/
├── .env                          # 环境变量/密码配置（本地开发）
├── .env.example                  # 环境变量模板
├── .env.prod.example             # 生产环境变量模板
├── docker-compose.yml            # 开发/测试第三方依赖编排
├── docker-compose.deps.yml       # 生产数据层编排（PostgreSQL/Redis/GitLab，独立项目 trace-ship-deps）
├── docker-compose.prod.yml       # 生产应用层编排（Backend/Frontend/Celery，项目 trace-ship）
├── start-prod.sh                 # 本地生产模式一键部署（构建镜像 + 分层启动）
├── setup-docker-mirror.sh        # Docker 镜像加速器配置脚本
├── README.md                     # 本文件
├── openldap/                     # OpenLDAP 本地构建（test profile）
│   ├── Dockerfile
│   ├── slapd.conf
│   ├── init.sh
│   └── init/
├── svn/                          # SVN 本地构建（test profile）
│   ├── Dockerfile
│   ├── svn-entrypoint.sh
│   └── create-repos.sh           # 测试仓库与三角色账号初始化
└── package/                      # 打包构建镜像（DooD 构建容器）
    └── web/
```

## 数据卷命名

所有数据卷统一显式命名为 `trace-ship-*`（在 compose 文件 volumes 块中用 `name:` 指定），不依赖 compose 项目名前缀：

| 卷名 | 用途 |
|------|------|
| `trace-ship-postgres-data` | PostgreSQL 数据 |
| `trace-ship-redis-data` | Redis 持久化 |
| `trace-ship-gitlab-config` | GitLab 配置 |
| `trace-ship-gitlab-logs` | GitLab 日志 |
| `trace-ship-gitlab-data` | GitLab 数据（仓库等） |
| `trace-ship-ldap-data` | OpenLDAP 数据（test） |
| `trace-ship-svn-data` | SVN 仓库数据（test） |
| `trace-ship-backend-logs` | 后端日志（生产） |
| `trace-ship-celerybeat-data` | Celery Beat 调度状态（生产） |

> ⚠️ 从旧版（`release-manager-dev_*` 前缀卷 / Gitea）迁移的注意：
> - 显式卷名后旧卷不会被复用，如需保留旧 PostgreSQL 数据，先 `pg_dump` 备份再恢复
> - Gitea 已移除，代码仓库统一使用 GitLab；原 Gitea 中的仓库需迁移到 GitLab
> - GitLab 12.4 → 17.x 无法直接升级复用旧 `gitlab_data` 卷，新环境使用全新卷初始化

## 前置要求

- Docker 20.10+
- Docker Compose 2.0+
- GitLab 需要 4GB+ 可用内存

## 快速开始（本地开发）

开发环境统一使用根目录的 `scripts/dev.sh` 管理（首次使用会自动从 `.env.example` 生成 `docker/.env`）：

```bash
cd /media/sangfor/vdb/front-workspace/trace-ship

# 启动基础依赖（PostgreSQL / Redis / GitLab）
scripts/dev.sh deps

# 需要 LDAP / SVN 模拟时（测试环境）：追加 OpenLDAP / phpLDAPadmin / SVN，
# 并自动初始化 SVN 测试仓库与三角色账号
scripts/dev.sh deps --test

# 本地启动后端 / 前端（后台运行，日志在 scripts/.run/）
scripts/dev.sh backend
scripts/dev.sh frontend

# 查看状态 / 停止全部（本地进程 + 容器）
scripts/dev.sh status
scripts/dev.sh down
```

## 默认访问地址

### GitLab（代码仓库）

使用 GitLab 社区版（`gitlab/gitlab-ce`，14.x 经典界面）。

- 地址：http://localhost:18929
- 管理员：`admin` / `admin123`（首次启动后执行 `scripts/dev.sh gitlab-admin` 创建/重置，幂等）
- 内置 `root` 账号保留为兜底，密码见 `.env` 中 `GITLAB_ROOT_PASSWORD`
- 首次启动需等待数分钟：`docker logs trace-ship-dev-gitlab -f`

### PostgreSQL

- 地址：`localhost:5432`
- 数据库：`release_manager`
- 用户：`release_manager` / `.env` 中 `POSTGRES_PASSWORD`

### Redis

- 地址：`localhost:6379`
- 密码：`.env` 中 `REDIS_PASSWORD`

### OpenLDAP（test profile）

- 地址：`ldap://localhost:389`
- Base DN：`dc=example,dc=com`
- 管理员：`cn=admin,dc=example,dc=com` / `.env` 中 `LDAP_ADMIN_PASSWORD`
- phpLDAPadmin：http://localhost:18090

### SVN（test profile，打包产物模拟目标）

- svn 协议：`svn://localhost:3690/trace-ship`
- http 协议：`http://localhost:3691/svn/trace-ship`
- 三角色账号：`admin` / `developer` / `viewer`（密码见 `svn/create-repos.sh`）

## 测试账号（LDAP）

| 账号 | 密码 | 角色 |
|-----|------|-----|
| jiangxin | password123 | 开发人员 |
| zhangsan | password123 | 项目管理员 |
| lisi | password123 | 测试人员 |
| wangwu | password123 | 审核人 |

## 生产环境部署

生产环境拆分为**两个独立 compose 项目**，通过共享网络 `trace-ship-net` 通信：

| 文件 | 项目名 | 内容 | 变更频率 |
|------|--------|------|---------|
| `docker-compose.deps.yml` | `trace-ship-deps` | 数据层：PostgreSQL / Redis / GitLab | 极低（部署后基本不动） |
| `docker-compose.prod.yml` | `trace-ship` | 应用层：Backend / Frontend / Celery Worker / Celery Beat | 高（每次发版重建） |

拆分原因：应用每次发版都要重建，而数据层几乎不变；独立编排后应用更新/误操作（如 `down -v`）不会触碰数据库与 GitLab 数据，重量级 GitLab 也不会被应用更新波及。日常运维只需操作 `docker-compose.prod.yml`。

OpenLDAP / SVN 等模拟服务不纳入生产编排，如需 LDAP 或 SVN 产物仓库，请接入外部服务并在 `.env.prod` 中配置。

### 与开发环境的区别

| 项 | 开发 (docker-compose.yml) | 生产 (deps + prod 双文件) |
|----|---------------------------|--------------------------------|
| 后端代码 | 挂载源码卷 `../backend:/app` | 镜像内打包（`COPY . .`） |
| 第三方依赖 | PostgreSQL/Redis/GitLab（+ test profile 模拟服务） | PostgreSQL/Redis/GitLab（独立 compose 项目 trace-ship-deps） |
| 端口暴露 | 各服务端口均映射到宿主机，便于调试 | 仅前端 80 与 GitLab 对外，DB/Redis 内部网络 |
| 配置文件 | `.env`（弱密码可接受） | `.env.prod`（强制强密钥） |
| Django settings | `config.settings.dev`（本地开发） | `config.settings.prod` |

### 生产部署步骤

1. 复制生产配置模板并填写真实值：

   ```bash
   cd docker
   cp .env.prod.example .env.prod
   vi .env.prod
   ```

   **必须修改的项**（`prod.py` 启动时会校验，未修改将拒绝启动）：

   - `DJANGO_SECRET_KEY`：随机 50+ 字符
   - `CREDENTIAL_SECRET_KEY`：32 字节随机串
   - `POSTGRES_PASSWORD` / `REDIS_PASSWORD` / `GITLAB_ROOT_PASSWORD`：强密码
   - `ALLOWED_HOSTS`：替换 `YOUR_SERVER_IP` 为真实服务器 IP
   - `CORS_ALLOWED_ORIGINS`：`http://真实服务器IP`（端口非 80 时带端口）
   - `GITLAB_EXTERNAL_URL`：`http://真实服务器IP:18929`

2. 一键启动（自动按「先数据层、等健康、再应用层」顺序启动）：

   ```bash
   ./start-prod.sh
   ```

   手动分步执行（一般不需要）：

   ```bash
   # 先启动数据层并等待 PostgreSQL / Redis 健康
   docker compose --env-file .env.prod -f docker-compose.deps.yml up -d
   docker compose --env-file .env.prod -f docker-compose.deps.yml up -d --wait postgres redis
   # 再启动应用层
   docker compose --env-file .env.prod -f docker-compose.prod.yml up -d
   ```

3. 访问：
   - 前端：`http://服务器IP`（默认 80）
   - GitLab：`http://服务器IP:18929`（首次启动需等待数分钟）

### 数据持久化（生产）

生产环境数据全部使用命名卷（见上文「数据卷命名」），唯二的 bind mount 是 DooD 打包的硬性要求：

| 挂载 | 类型 | 用途 |
|------|------|------|
| `/var/run/docker.sock` | bind mount | 容器内调用宿主机 dockerd 执行打包（等价宿主机 root，仅限受控环境） |
| `${PACKAGE_WORKSPACE_ROOT}` | bind mount | 打包工作区（宿主机与容器同路径，DooD 挂载需要） |

完全重置（⚠️ 以下命令会删除命名卷数据，不会删除打包工作区；两个文件需分别操作）：

```bash
# 重置应用层（无状态，安全）
docker compose --env-file .env.prod -f docker-compose.prod.yml down -v
# 重置数据层（⚠️ 会删除 PostgreSQL / Redis / GitLab 全部数据，谨慎执行）
docker compose --env-file .env.prod -f docker-compose.deps.yml down -v
```

### 离线部署（内网无网络）

使用根目录 `scripts/` 下的构建/部署脚本。发布包按内容分四种：`--deps`（第三方依赖：postgres + redis + gitlab）、`--backend`、`--frontend`、`--app`（前后端）；每个包都自带双 compose 编排、`.env.prod.example` 和一键部署脚本 `deploy.sh`。

```bash
# 外网机器：构建首次部署所需的两个包（GitLab 镜像约 2.5GB+，注意磁盘与带宽）
scripts/build.sh --deps
scripts/build.sh --app
# 产出 dist/trace-ship-release-<模式>-<时间戳>.tar.gz

# 内网机器：两个包解压到同一目录（部署材料相同、镜像互补），一键第一次部署
tar -xzf trace-ship-release-deps-*.tar.gz
tar -xzf trace-ship-release-app-*.tar.gz -C trace-ship-release
cd trace-ship-release
./deploy.sh --full     # 自动加载镜像、生成随机密钥的 .env.prod、先起依赖组再起应用并健康检查
```

增量更新（复用已有 `.env.prod`）：外网侧 `scripts/build.sh --backend` / `--frontend` / `--app`，内网侧解压后 `./deploy.sh` 选对应模式（`--backend` / `--frontend` / `--app`）。

## 常见问题

### 1. 无法拉取 Docker 镜像 / Docker Hub 访问超时

**方式一：配置镜像加速器** —— 执行 `./setup-docker-mirror.sh` 或手动编辑 `/etc/docker/daemon.json` 后 `sudo systemctl restart docker`。

**方式二：私有镜像仓库前缀** —— 在 `.env` 中设置 `IMAGE_PREFIX=registry.cn-hangzhou.aliyuncs.com/your-namespace/`（需提前推送镜像）。

**方式三：离线镜像包** —— 见上文「离线部署」。

### 2. 端口冲突

修改 `.env` 中对应端口后重启。GitLab HTTP 端口修改时需同步调整 `GITLAB_EXTERNAL_URL`。

### 3. GitLab 启动慢或内存不足

GitLab 首次初始化需数分钟且要求 4GB+ 可用内存。资源紧张时可在 compose 中进一步收敛（如 `puma['worker_processes'] = 0`、关闭 `sidekiq` 监控项），或改用外部 GitLab 服务（从编排中移除 gitlab 服务，在 Trace Ship 中配置外部 GitLab 仓库地址即可）。

### 4. 数据重置

```bash
scripts/dev.sh down
docker volume rm trace-ship-postgres-data trace-ship-redis-data \
  trace-ship-gitlab-config trace-ship-gitlab-logs trace-ship-gitlab-data \
  trace-ship-ldap-data trace-ship-svn-data
scripts/dev.sh deps --test
```

## 安全注意事项

- 本目录 `.env` 仅用于开发/测试，**不要直接用于生产**；生产必须使用 `.env.prod` 并修改全部默认密码。
- `.env.prod` 含敏感密钥，已被 `.gitignore` 忽略，切勿提交。
- 生产环境 backend / postgres / redis 仅在内部网络通信，不对外暴露端口；所有外部请求经前端 nginx 反代 `/api/` 访问后端。
- `prod.py` 强制 `DEBUG=False`、`CORS_ALLOW_ALL_ORIGINS=False`，建议生产部署在 HTTPS 反向代理之后。
