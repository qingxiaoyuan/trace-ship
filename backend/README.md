# Trace Ship 后端服务

Trace Ship 后端基于 Django + Django REST Framework 构建，提供用户认证、RBAC 权限、项目管理、凭证管理、系统参数、操作日志等基础能力，为版本发布流程提供底座支撑。

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
│   ├── account/          # 用户、角色、权限、登录认证
│   ├── credential/       # 凭证管理（AES 加密存储）
│   ├── project/          # 项目管理、项目成员、外站绑定
│   └── system/           # 系统参数、操作日志
├── config/
│   ├── settings/
│   │   ├── base.py       # 基础配置
│   │   ├── dev.py        # 开发环境
│   │   ├── prod.py       # 生产环境
│   │   └── test.py       # 测试环境
│   ├── urls.py           # 总路由
│   ├── wsgi.py           # WSGI 入口
│   └── celery.py         # Celery 配置
├── utils/
│   ├── crypto.py         # 凭证加密/解密/脱敏
│   ├── exceptions.py     # 统一异常处理
│   ├── response.py       # 统一响应封装
│   ├── pagination.py     # 标准分页
│   ├── permissions.py    # 自定义权限类
│   └── middleware.py     # 操作日志中间件
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

后端依赖 PostgreSQL、Redis、OpenLDAP 等基础设施，统一通过 `docker/docker-compose.yml` 一键启动。

```bash
# 进入项目根目录
cd /media/sangfor/vdb/front-workspace/trace-ship

# 启动所有服务（包含后端、数据库、缓存、LDAP、Gitea、Jenkins、SVN）
docker compose -f docker/docker-compose.yml up -d --build

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
| `JWT_ACCESS_TOKEN_LIFETIME_MINUTES` | Access Token 有效期 | 60 |
| `JWT_REFRESH_TOKEN_LIFETIME_DAYS` | Refresh Token 有效期 | 7 |
| `CREDENTIAL_SECRET_KEY` | 凭证加密密钥 | 必须修改 |
| `CORS_ALLOW_ALL_ORIGINS` | 允许所有跨域来源 | `False`（prod） |

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
- 超管账号 `admin / admin@123`
- 基础角色（系统管理员、项目经理、开发人员、测试人员、审计人员、访客）
- 基础权限数据

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

测试覆盖率门槛为 50%，当前整体覆盖率约 78%。

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
- 登录流程：先尝试 LDAP，失败后尝试本地认证。
- JWT Token 认证，支持刷新、黑名单登出。
- RBAC：用户 - 角色 - 权限 多对多模型。

### 项目管理（apps/project）

- 项目 CRUD、状态控制。
- 项目成员角色：`manager` / `developer` / `tester` / `auditor` / `viewer`。
- 外站绑定：Git 仓库、SVN、Jenkins 等。
- 数据隔离：普通用户仅能看到自己所在的项目。

### 凭证管理（apps/credential）

- 支持 `token`、`password` 两种认证模式。
- 支持 `personal` / `project` / `global` 三种作用范围。
- AES 对称加密存储，接口返回脱敏数据。
- 删除前校验是否被外站绑定引用。

### 系统参数与日志（apps/system）

- 系统参数 key-value 配置。
- 操作日志中间件自动记录关键请求。

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

- 检查 `LDAP_SERVER_URI`、`LDAP_BIND_DN`、`LDAP_BIND_PASSWORD`、`LDAP_USER_SEARCH_BASE` 配置。
- 未配置 LDAP 时仅支持本地账号登录。
