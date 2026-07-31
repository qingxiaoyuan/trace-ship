# Trace Ship 后端服务

Trace Ship 后端基于 Django + Django REST Framework 构建，提供用户认证（LDAP/本地）、RBAC 权限、项目管理、仓库与提交审查、发布申请与审批工作流、系统内置打包（Docker 镜像 + SVN 推送）、凭证管理、站内通知、使用反馈、系统参数与操作日志等能力，为版本发布流程提供底座支撑。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | Python 3.11 |
| Web 框架 | Django 5.0 |
| API 框架 | Django REST Framework 3.15 |
| 认证 | JWT（djangorestframework-simplejwt）、LDAP/AD（django-auth-ldap） |
| 数据库 | PostgreSQL 16 |
| 缓存/队列 | Redis 7 + Celery 5 |
| 加密 | cryptography（Fernet AES） |
| API 文档 | drf-spectacular（Swagger / Redoc） |
| 测试 | pytest-django + pytest-cov |
| 生产服务器 | gunicorn |

---

## 目录结构

```
backend/
├── apps/
│   ├── account/          # 用户、角色、权限、登录认证（含 LDAP 动态配置 ldap_config.py）
│   ├── credential/       # 凭证管理（Fernet 加密存储、脱敏展示）
│   ├── project/          # 项目管理、项目成员
│   ├── repository/       # 仓库管理、分支/Tag、提交记录与提交规范审查
│   ├── release/          # 发布记录、版本号计算、发布说明、推 tag、看板统计
│   ├── workflow/         # 审批流程定义、流程实例、审批任务
│   ├── package/          # 系统内置打包：打包镜像、打包配置、打包任务、SVN 推送
│   ├── notification/     # 站内通知
│   ├── feedback/         # 使用反馈（提交/点赞/处理）
│   ├── jenkins/          # 已下线：仅保留迁移 tombstone，无模型/API/业务逻辑
│   └── system/           # 系统参数（含 LDAP/Nexus 配置）、操作日志、LDAP 连接测试
├── config/
│   ├── settings/
│   │   ├── base.py       # 基础配置
│   │   ├── dev.py        # 开发环境
│   │   ├── prod.py       # 生产环境
│   │   └── test.py       # 测试环境（内存 SQLite + eager Celery）
│   ├── urls.py           # 总路由
│   ├── wsgi.py           # WSGI 入口
│   └── celery.py         # Celery 配置
├── utils/
│   ├── crypto.py         # 凭证加密/解密/脱敏
│   ├── exceptions.py     # 统一异常处理
│   ├── response.py       # 统一响应封装
│   ├── pagination.py     # 标准分页
│   ├── permissions.py    # 自定义权限类（项目成员/管理员/超管等）
│   ├── middleware.py     # 操作日志/异常处理中间件
│   ├── viewsets.py       # 标准 ModelViewSet 基类
│   ├── commit_parser.py  # 提交信息解析（A/F 类变更提取）
│   ├── commit_reviewer.py# 提交规范审查规则
│   └── provider/         # GitLab / SVN provider 与凭证解析
├── requirements.txt      # Python 依赖
├── Dockerfile            # 后端镜像
├── entrypoint.sh         # 容器启动脚本
├── pytest.ini            # pytest 配置
└── manage.py             # Django 管理入口
```

---

## 环境要求

- Docker >= 24.0
- Docker Compose >= 2.20
- Python 3.11（本地开发可选）

---

## 快速开始（推荐 Docker）

后端依赖 PostgreSQL、Redis、GitLab 等基础设施，统一通过 `docker/docker-compose.yml` 一键启动；日常开发更推荐使用根目录的 `scripts/dev.sh` 统一管理。

```bash
# 进入项目根目录
cd /media/sangfor/vdb/front-workspace/trace-ship

# 方式一：使用开发环境脚本（推荐）
scripts/dev.sh all          # 启动依赖容器 + 本地后端 + 前端
scripts/dev.sh deps --test  # 测试环境追加 OpenLDAP / SVN 模拟服务

# 方式二：仅启动基础设施容器
docker compose -f docker/docker-compose.yml up -d --build

# 方式三：连同后端 / 前端 / Celery 一起以容器启动
docker compose -f docker/docker-compose.yml --profile app up -d --build

# 查看后端日志
docker compose -f docker/docker-compose.yml logs backend -f
```

服务启动后访问：

| 服务 | 地址 |
|------|------|
| Swagger UI | http://localhost:8000/swagger/ |
| Redoc | http://localhost:8000/redoc/ |
| API Schema | http://localhost:8000/api/schema/ |
| 健康检查 | http://localhost:8000/health/ |

默认管理员账号：

```
用户名：admin
密码：admin@123
```

---

## 本地开发（不使用 Docker）

> 仅推荐在已有 PostgreSQL / Redis 服务时使用。

```bash
cd backend

# 创建虚拟环境
python3.11 -m venv .venv
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 设置环境变量
export DJANGO_SETTINGS_MODULE=config.settings.dev
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=release_manager
export DB_USER=release_manager
export DB_PASSWORD=ReleaseManager@2024
export REDIS_HOST=localhost
export REDIS_PORT=6379
export REDIS_PASSWORD=ReleaseManager@2024
export SECRET_KEY=django-insecure-change-me-in-production
export CREDENTIAL_SECRET_KEY=change-me-in-production-32bytes!

# 执行迁移
python manage.py migrate

# 初始化基础数据
python manage.py init_base_data

# 启动开发服务器
python manage.py runserver 0.0.0.0:8000
```

Celery（可选，打包任务等异步流程依赖）：

```bash
celery -A config worker -l info
celery -A config beat -l info
```

管理员密码丢失恢复：

```bash
# 默认恢复为 admin@123，支持 --username / --password 参数
python manage.py reset_admin_password
```

---

## 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `DJANGO_SETTINGS_MODULE` | Django 配置模块 | `config.settings.prod` |
| `SECRET_KEY` | Django 安全密钥 | `django-insecure-change-me-in-production` |
| `DEBUG` | 调试模式 | `False` |
| `ALLOWED_HOSTS` | 允许访问的域名 | `*` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | PostgreSQL 连接 | - |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis 连接 | - |
| `REDIS_DB_CACHE` / `REDIS_DB_CELERY` / `REDIS_DB_BLACKLIST` | Redis 数据库编号 | 1 / 0 / 2 |
| `LDAP_SERVER_URI` | LDAP 服务地址 | 空（禁用 LDAP） |
| `LDAP_BIND_DN` | LDAP 绑定 DN | - |
| `LDAP_BIND_PASSWORD` | LDAP 绑定密码 | - |
| `LDAP_USER_SEARCH_BASE` | LDAP 用户搜索 Base DN | - |
| `LDAP_USER_FILTER` | LDAP 登录过滤器 | `(uid=%(user)s)` |
| `LDAP_TLS_REQCERT` | ldaps 证书校验策略（demand/allow/never/try） | `demand` |
| `LDAP_CA_CERT_PATH` | ldaps CA 证书文件路径 | - |
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` | Access Token 有效期 | 60 |
| `JWT_REFRESH_TOKEN_LIFETIME_DAYS` | Refresh Token 有效期 | 7 |
| `CREDENTIAL_SECRET_KEY` | 凭证加密密钥 | 必须修改 |
| `CORS_ALLOW_ALL_ORIGINS` | 允许所有跨域来源 | `True`（base），prod 默认 `False` |
| `CORS_ALLOWED_ORIGINS` | 允许跨域来源列表（逗号分隔） | 空 |
| `PACKAGE_WORKSPACE_ROOT` | 打包工作区根目录 | `backend/package_workspaces` |
| `NEXUS_BASE_URL` / `NEXUS_USERNAME` / `NEXUS_PASSWORD` / `NEXUS_TIMEOUT` / `NEXUS_REGISTRY_HOST` | Nexus 仓库连接配置（打包镜像选择） | 空 |

> LDAP 与 Nexus 连接参数也可在「系统管理 → 系统配置」页面维护（`ldap_*` / `nexus_*` 键），页面配置优先于环境变量，无需重启服务。

### 安全提醒

- **生产环境必须修改 `SECRET_KEY` 和 `CREDENTIAL_SECRET_KEY`**，切勿使用默认值。
- `CREDENTIAL_SECRET_KEY` 丢失后将无法解密所有凭证，请务必妥善保管。
- Fernet 密钥需要 32 字节 base64 编码，可通过 `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` 生成。

---

## 数据库迁移

```bash
# 生成迁移文件
python manage.py makemigrations

# 执行迁移
python manage.py migrate
```

---

## 初始化基础数据

```bash
python manage.py init_base_data
```

该命令会创建：
- 超管账号 `admin / admin@123`（`--reset-admin` 可强制重置密码）
- 基础角色：超级管理员（super_admin）、开发人员（developer）、测试人员（tester）、审核人（auditor）、只读人员（viewer）
- 基础权限数据（project/repository/credential/release/package/commit/workflow/system 各模块权限）

---

## 运行测试

```bash
# 进入 backend 目录
cd backend

# 运行全部测试并生成覆盖率报告
pytest

# 仅运行指定应用测试
pytest apps/account/tests
pytest apps/credential/tests

# 本地未配置容器时
export DJANGO_SETTINGS_MODULE=config.settings.test
pytest
```

测试覆盖率门槛为 50%（`pytest.ini` 中 `--cov-fail-under=50`）。

---

## API 文档

项目集成 drf-spectacular，自动生成 OpenAPI 3 规范文档。

```bash
# 导出 schema 文件
python manage.py spectacular --file schema.yml
```

页面访问：
- Swagger UI：`/swagger/`
- Redoc：`/redoc/`
- Schema JSON：`/api/schema/?format=json`

---

## 部署说明

### Docker 生产部署

1. 修改 `docker/.env` 中的密码和密钥。
2. 关闭 `DEBUG`、配置 `ALLOWED_HOSTS`、关闭 `CORS_ALLOW_ALL_ORIGINS`。
3. 配置 HTTPS 反向代理（Nginx / Traefik）。
4. 执行：

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

### 生产配置要点

- `config/settings/prod.py` 中 `DEBUG=False`、`SESSION_COOKIE_SECURE=True`、`CSRF_COOKIE_SECURE=True`。
- 生产日志写入 `/var/log/trace-ship/django.log`，目录不存在时自动创建。
- 使用 gunicorn 4 个 worker，超时 120 秒。

---

## 核心模块说明

### 用户认证（apps/account）

- 支持 LDAP/AD 登录 + 本地应急账号登录。
- 登录流程：先尝试 LDAP，失败后尝试本地认证；LDAP 连接参数支持「系统配置」页面（`ldap_*` 键）优先、环境变量兜底，登录时动态生效无需重启。
- LDAP 首次登录自动建用户并默认赋予「开发人员」角色；显示名形如 `<部门>姓名` 时自动拆分部门与昵称。
- JWT Token 认证，支持刷新（轮换 + 黑名单）、登出拉黑。
- RBAC：用户 - 角色 - 权限 多对多模型；人员查询全员可查（普通用户返回精简字段），用户增删仅超管。
- 管理命令：`reset_admin_password` 重置 admin 密码；`init_base_data --reset-admin` 强制重置。

### 项目管理（apps/project）

- 项目 CRUD、状态控制；创建时自动生成项目编码、创建者设为项目管理员，并预置 formal/rc/beta 三类发布审批流程定义。
- 项目成员角色：`manager` / `developer` / `tester` / `auditor` / `viewer`。
- 仓库直接归属项目并各自绑定凭证（无独立的“外站绑定”模型）。
- 数据隔离：普通用户仅能看到自己所在的项目。

### 凭证管理（apps/credential）

- 凭证类型：`gitlab_token`、`svn_password`、`ldap_password`、`ai_api_key`；认证模式 `token` / `password`，类型与模式强一致校验。
- 统一为个人凭证（仅归属人与超管可见可用）；SVN 凭证（`svn_password`）全系统共享。
- Fernet 对称加密存储，接口返回脱敏数据；删除前校验是否被仓库等引用。

### 仓库与提交审查（apps/repository）

- 代码仓库仅支持 Git（GitLab）；SVN 仅作为打包产物推送目标（见 apps/package）。
- 分支/Tag 同步落库，支持连通性测试、分支列表、Tag 列表、下一版本号计算、变更预览。
- 提交记录自动解析（A/F 类变更）与规范审查，状态：`unreviewed` / `pass` / `warning` / `illegal`；支持人工复核与按仓库聚合的合规统计。

### 发布管理（apps/release）

- 发布状态机：`draft`（草稿）→ `pending`（待审批）→ `released`（已发布）/ `rejected`（已驳回）。
- 发布类型：`formal` / `rc` / `beta`；版本号按项目 `version_rule` 与仓库 Tag 自动计算。
- 提审批时按发布类型匹配项目内置审批流程，创建 `WorkflowInstance`；审批通过自动推 tag，推 tag 成功置 `released`，失败置 `rejected`；驳回可回退恢复为 `draft`。
- 发布说明为 Markdown 两列表格，可生成、手改，支持导出 Markdown / PDF / Word。
- 提供看板统计接口（总览 / 趋势 / 项目维度）与版本目录（catalog）。
- Celery beat 每整点清理过期草稿发布。

### 审批工作流（apps/workflow）

- 流程定义按项目内置（formal/rc/beta 各一条），不支持手动新增/删除，仅可编辑 `node_config` 审批链。
- 支持串行审批、或签（any）/ 会签（all）、通过、驳回、转交、回退、撤销。

### 系统内置打包（apps/package）

- `PackageImage`：打包镜像（来源本地 Docker / Nexus），按镜像坐标唯一，选择时自动创建。
- `PackageConfig`：项目级打包配置，含镜像、构建目录/产物目录、自定义脚本、环境变量、发布后自动打包开关与 SVN 推送配置。
- `PackageTask`：打包任务，状态 `queued` / `running` / `success` / `failure` / `canceled`，记录工作区、日志、产物与 SVN 推送结果。
- 容器约定：挂载 `/workspace/source|artifacts|tmp`，以 `--entrypoint /bin/sh` 启动；配置了 `custom_script` 则直接执行，否则执行镜像内置 `script_entry`（默认 `/workspace/scripts/pack.sh`）。
- Nexus 连接在「系统配置」页面维护（`nexus_*` 键），支持浏览 Nexus 仓库/镜像与上传 tar 导入本地 Docker。

### 站内通知（apps/notification）

- 覆盖审批、构建、发布与系统消息；支持未读数、标记已读、全部已读、清除。

### 使用反馈（apps/feedback）

- 全员可提交/查看/点赞；删除仅限本人或超管；超管可标记已处理（记录处理人与时间），状态 `open` / `processed`。

### 系统参数与日志（apps/system）

- 系统参数 key-value 配置（含 `ldap_*`、`nexus_*` 等连接参数）。
- LDAP 连接测试接口（`/api/system/configs/ldap-test/`）。
- 操作日志中间件自动记录关键请求，仅超管可查。

### Jenkins 模块（已下线）

- `apps.jenkins` 已整体下线，仅保留迁移 tombstone（历史迁移链依赖），无模型、API 与业务逻辑；打包统一走 `apps.package`，请勿恢复 Jenkins 相关代码。

---

## 开发规范

- 遵循 PEP 8，使用 4 空格缩进。
- 模型字段添加 `verbose_name`。
- 视图统一返回 `{code, message, data}` 格式。
- 异常统一由 `utils.exceptions.custom_exception_handler` 处理。
- 新增接口需补充对应单元测试。

---

## 常见问题

### Swagger 加载失败

检查后端日志，常见问题：
- 自定义权限类不可调用：权限类应传入类本身而非实例。
- `get_queryset` 在 schema 生成时访问 `request.user`：需添加 `swagger_fake_view` 防护。

### 凭证无法解密

- 确认 `CREDENTIAL_SECRET_KEY` 与创建时一致。
- 确认密钥为 32 字节 base64 编码。

### LDAP 登录失败

- 优先在「系统管理 → 系统配置」页面检查 `ldap_*` 配置（页面配置优先于环境变量），可用 `POST /api/system/configs/ldap-test/` 验证连通性。
- 环境变量方式则检查 `LDAP_SERVER_URI`、`LDAP_BIND_DN`、`LDAP_BIND_PASSWORD`、`LDAP_USER_SEARCH_BASE`。
- 未配置 LDAP 时仅支持本地账号登录。
