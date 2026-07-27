# Trace Ship

Trace Ship 是一款软件版本发布管理系统，目标是通过统一的平台管理代码仓库、构建流水线、发布流程和运行环境，实现从代码提交到上线交付的全链路可追溯、可审计、可回滚。

---

## 项目简介

Trace Ship 围绕“项目”维度组织资源，支持多项目并行管理。系统提供：

- 统一用户认证：LDAP/AD 域账号 + 本地应急账号
- RBAC 权限模型：角色、权限、项目成员角色
- 项目全生命周期管理：代码仓库、成员、凭证、发布流程
- 代码仓库接入：GitLab，提交同步与提交规范审查
- 发布管理：版本号自动计算、发布说明、审批工作流（串行 / 或签 / 会签 / 转交 / 回退 / 撤销）、审批通过后推 tag
- 打包能力：Docker 镜像打包与本地脚本打包、打包任务执行与日志、产物 SVN 推送、发布后自动触发
- 凭证安全托管：AES 加密存储、脱敏展示、使用审计
- 站内通知：审批、构建、发布和系统消息
- 操作日志：关键行为全程留痕
- 标准化 API：RESTful API + Swagger/Redoc 文档 + Postman Collection

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (frontend)                          │
│           React 19 + Vite + TypeScript + Ant Design 6         │
│      工作台 / 项目 / 仓库 / 提交 / 发布 / 工作流 / 打包 / 系统  │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP / REST
┌───────────────────────────▼─────────────────────────────────┐
│                     后端 (backend)                            │
│              Django 5.0 + Django REST Framework               │
│  认证 · 权限 · 项目 · 仓库 · 发布 · 工作流 · 打包 · 凭证 · 通知  │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   PostgreSQL           Redis             Celery Worker
   关系型数据          缓存/会话/队列        异步任务
        ▼                   ▼                   ▼
   GitLab              OpenLDAP                SVN
   代码仓库            域账号服务（测试模拟）   打包产物推送
        ▼
   打包工作区 (Docker 镜像 / 本地脚本)
└─────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
trace-ship/
├── backend/                # Django 后端服务
│   ├── apps/               # 业务应用
│   │   ├── account/        # 用户、角色、权限、认证
│   │   ├── project/        # 项目与项目成员
│   │   ├── repository/     # 仓库、提交记录与审查
│   │   ├── release/        # 发布申请与发布流程
│   │   ├── workflow/       # 审批工作流引擎
│   │   ├── package/        # 打包镜像、打包配置、打包任务
│   │   ├── jenkins/        # （已下线）仅保留迁移 tombstone，无业务逻辑
│   │   ├── credential/     # 凭证加密托管
│   │   ├── notification/   # 站内通知
│   │   └── system/         # 系统参数与操作日志
│   ├── config/             # Django 配置
│   ├── utils/              # 公共工具
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── pytest.ini
│   └── manage.py
├── frontend/               # React + Vite + TypeScript 前端
│   └── src/
│       ├── api/            # 接口封装（按业务模块拆分）
│       ├── router/         # 路由与鉴权守卫
│       ├── layouts/        # 主布局与子布局
│       ├── pages/          # 工作台/项目/仓库/发布/打包/系统等页面
│       ├── components/     # 通用组件
│       ├── stores/         # Zustand 状态
│       └── styles/         # 主题与样式
├── docker/                 # Docker Compose 基础设施编排
│   ├── docker-compose.yml        # 开发/测试第三方依赖（PostgreSQL/Redis/GitLab，test profile 含 LDAP/SVN）
│   ├── docker-compose.deps.yml   # 生产数据层编排（PostgreSQL/Redis/GitLab，独立项目）
│   ├── docker-compose.prod.yml   # 生产应用层编排（Backend/Frontend/Celery）
│   ├── .env
│   ├── openldap/
│   ├── package/
│   └── svn/
├── docs/                   # 项目文档
│   ├── api-spec.md
│   ├── business-process-analysis.md
│   └── postman/
├── feat/                   # 需求文档
├── ui-design/              # UI 设计稿
└── README.md
```

---

## 快速开始

### 环境要求

- Docker >= 24.0
- Docker Compose >= 2.20
- Python >= 3.11（后端本地开发）
- Node.js >= 18（前端本地开发）

### 1. 启动第三方依赖（Docker）

Trace Ship 的第三方依赖统一使用 Docker 部署，包括 PostgreSQL、Redis、GitLab；测试环境可通过 `--test` 追加 OpenLDAP、SVN 模拟服务。开发环境统一使用 `scripts/dev.sh` 管理：

```bash
cd /media/sangfor/vdb/front-workspace/trace-ship

# 启动第三方开发容器
scripts/dev.sh deps

# 或追加测试模拟服务（LDAP / SVN）
scripts/dev.sh deps --test
```

### 2. 本地启动后端

```bash
# 自动执行数据库迁移并后台启动 runserver（http://localhost:8000）
scripts/dev.sh backend
```

也可以手动启动（便于断点调试）：

```bash
cd backend

# 激活虚拟环境
source .venv/bin/activate

# 执行迁移并启动开发服务器
python manage.py migrate
python manage.py init_base_data
python manage.py runserver 0.0.0.0:8000
```

### 3. 本地启动前端

```bash
# 后台启动 Vite 开发服务器（http://localhost:5173，/api 代理到 8000）
scripts/dev.sh frontend
```

### 4. 查看状态与关闭

```bash
scripts/dev.sh status        # 查看本地进程与容器状态
scripts/dev.sh logs backend  # 跟踪后端日志（也可跟 frontend / postgres 等）
scripts/dev.sh down          # 关闭所有（本地进程 + 第三方容器）
```

### 默认访问地址

| 服务 | 地址 | 默认账号 |
|------|------|---------|
| Trace Ship 后端 | http://localhost:8000/ | admin / admin@123 |
| 前端开发服务器 | http://localhost:5173/ | - |
| Swagger UI | http://localhost:8000/swagger/ | - |
| Redoc | http://localhost:8000/redoc/ | - |
| 健康检查 | http://localhost:8000/health/ | - |
| GitLab | http://localhost:18929/ | admin / admin123（`scripts/dev.sh gitlab-admin` 创建） |
| phpLDAPadmin | http://localhost:18090/ | cn=admin,dc=example,dc=com / admin |
| SVN | svn://localhost:3690/ | - |

### 登录测试

```bash
curl -X POST http://localhost:8000/api/auth/login/ \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin@123"}'
```

---

## 里程碑

当前已完成的核心能力包括：

- **基础底座**：Django + DRF + PostgreSQL + Redis + Celery 工程骨架、LDAP/AD + 本地账号 + JWT 认证、RBAC 权限模型、凭证加密托管、系统参数与操作日志、Docker 一键部署。
- **项目与仓库**：项目全生命周期管理、项目成员角色、Git/SVN 仓库接入、提交同步与提交规范审查。
- **发布与工作流**：发布申请、版本号自动计算、发布说明生成、审批工作流（串行/或签/会签/转交/回退/撤销）、审批通过后推 tag。
- **打包能力**：系统级打包镜像（Web / Qt）、项目级打包配置（Docker 镜像 / 本地脚本）、打包任务执行与日志、产物 SVN 推送、发布后自动触发打包。
- **前端管理后台**：React + Ant Design 6 完整管理界面，覆盖工作台、项目、仓库、提交、发布、工作流、打包看板、系统管理等页面。

后续里程碑规划可参考 `docs/business-process-analysis.md`（注意该文档为阶段规划，与当前实现可能存在差异，以代码为准）。

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [backend/README.md](backend/README.md) | 后端详细说明 |
| [docs/api-spec.md](docs/api-spec.md) | 接口文档 |
| [docs/business-process-analysis.md](docs/business-process-analysis.md) | 业务流程分析与阶段规划 |
| [docs/postman/trace-ship-v1.postman_collection.json](docs/postman/trace-ship-v1.postman_collection.json) | Postman 接口集合 |
| [feat/后台需求.md](feat/后台需求.md) | 后台需求文档 |
| [docs/后台设计.md](docs/后台设计.md) | 后台设计文档 |

---

## 开发说明

Trace Ship 采用「本地运行应用服务 + Docker 运行第三方依赖」的开发模式：

- **前端**和**后端**在本地启动（`scripts/dev.sh backend` / `scripts/dev.sh frontend`，后台运行，日志在 `scripts/.run/`），便于热重载、断点调试和快速迭代。
- **第三方依赖**（PostgreSQL、Redis、GitLab）统一通过 `scripts/dev.sh deps` 启动，保持环境一致性；测试模拟服务（OpenLDAP、SVN）使用 `scripts/dev.sh deps --test` 启动。
- 如需一键启动完整应用服务（含 backend、frontend、celery），可使用 `docker compose -f docker/docker-compose.yml --profile app up -d --build`。
- 离线发布包构建与内网部署见 `scripts/build.sh` 与发布包内的 `deploy.sh`（详见 [docker/README.md](docker/README.md)）。

### 后端开发

详见 [backend/README.md](backend/README.md)。

常用命令：

```bash
cd backend

# 激活虚拟环境
source .venv/bin/activate
export DJANGO_SETTINGS_MODULE=config.settings.dev

# 迁移
python manage.py migrate

# 初始化基础数据
python manage.py init_base_data

# 启动开发服务器
python manage.py runserver 0.0.0.0:8000

# 测试
pytest

# 导出 API Schema
python manage.py spectacular --file schema.yml
```

### 前端开发

前端工程位于 `frontend/`，技术栈为 React 19 + Vite + TypeScript + Ant Design 6，状态管理使用 Zustand，数据请求使用 Axios（统一封装 `{code, message, data}` 响应与 JWT 刷新）与 React Query，样式使用 Tailwind CSS 4。

```bash
cd frontend

npm install
npm run dev       # 默认端口 5173，/api 代理到 localhost:8000
npm run build     # tsc -b && vite build
npm run lint      # ESLint
```

---

## 安全提醒

- 生产环境必须修改 `docker/.env` 中的所有默认密码和密钥。
- `CREDENTIAL_SECRET_KEY` 用于凭证加密，丢失后无法解密凭证。
- `SECRET_KEY` 用于 Django 会话、JWT 签名等安全场景。
- 生产部署建议启用 HTTPS、关闭 `CORS_ALLOW_ALL_ORIGINS`、配置 `ALLOWED_HOSTS`。

---

## 贡献与反馈

如有问题或建议，请在项目中提交 Issue 或联系维护者。
