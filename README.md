# Trace Ship

Trace Ship 是一款软件版本发布管理系统，目标是通过统一的平台管理代码仓库、构建流水线、发布流程和运行环境，实现从代码提交到上线交付的全链路可追溯、可审计、可回滚。

---

## 项目简介

Trace Ship 围绕“项目”维度组织资源，支持多项目并行管理。系统提供：

- 统一用户认证：LDAP/AD 域账号 + 本地应急账号
- RBAC 权限模型：角色、权限、项目成员角色
- 项目全生命周期管理：代码仓库、外站绑定、成员、凭证、发布流程
- 凭证安全托管：AES 加密存储、脱敏展示、使用审计
- 操作日志：关键行为全程留痕
- 标准化 API：RESTful API + Swagger/Redoc 文档 + Postman Collection

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (frontend)                        │
│                     Vue 3 / React（待实现）                    │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTP / REST
┌───────────────────────────▼─────────────────────────────────┐
│                      后端 (backend)                           │
│              Django 5.0 + Django REST Framework               │
│  用户认证 · 权限管理 · 项目管理 · 凭证管理 · 系统参数 · 操作日志  │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   PostgreSQL           Redis             Celery Worker
   关系型数据          缓存/会话/队列        异步任务
        ▼                   ▼                   ▼
   OpenLDAP            Gitea             Jenkins
   域账号服务          Git 仓库           构建流水线
        ▼                   ▼                   ▼
      SVN                                         
   代码仓库                                        
└─────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
trace-ship/
├── backend/                # Django 后端服务
│   ├── apps/               # 业务应用
│   ├── config/             # Django 配置
│   ├── utils/              # 公共工具
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── pytest.ini
│   └── manage.py
├── docker/                 # Docker Compose 基础设施编排
│   ├── docker-compose.yml
│   ├── .env
│   ├── postgres/
│   ├── jenkins/
│   ├── openldap/
│   └── svn/
├── docs/                   # 项目文档
│   ├── api-spec.md
│   ├── business-process-analysis.md
│   └── postman/
├── frontend/               # 前端工程（待实现）
├── feat/                   # 需求文档
├── ui-design/              # UI 设计稿
└── README.md
```

---

## 快速开始

### 环境要求

- Docker >= 24.0
- Docker Compose >= 2.20

### 一键启动

```bash
cd /media/sangfor/vdb/front-workspace/trace-ship

# 启动全部服务
docker compose -f docker/docker-compose.yml up -d --build

# 查看后端日志
docker compose -f docker/docker-compose.yml logs backend -f
```

### 默认访问地址

| 服务 | 地址 | 默认账号 |
|------|------|---------|
| Trace Ship 后端 | http://localhost:8000/ | admin / admin@123 |
| Swagger UI | http://localhost:8000/swagger/ | - |
| Redoc | http://localhost:8000/redoc/ | - |
| 健康检查 | http://localhost:8000/health/ | - |
| Gitea | http://localhost:13000/ | admin / admin |
| Jenkins | http://localhost:18080/ | admin / admin |
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

当前已完成 **Milestone 1：基础底座**，核心能力包括：

- Django + DRF + PostgreSQL + Redis + Celery 工程骨架
- LDAP/AD + 本地账号 + JWT 认证
- RBAC 权限模型
- 项目管理、成员管理、外站绑定
- 凭证管理（AES 加密、脱敏展示）
- 系统参数、操作日志
- Docker 一键部署
- Swagger / Redoc / Postman Collection

后续里程碑规划可参考 `docs/business-process-analysis.md`。

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

### 后端开发

详见 [backend/README.md](backend/README.md)。

常用命令：

```bash
cd backend

# 迁移
python manage.py migrate

# 初始化基础数据
python manage.py init_base_data

# 测试
pytest

# 导出 API Schema
python manage.py spectacular --file schema.yml
```

### 前端开发

前端工程位于 `frontend/`，待接入实现。

---

## 安全提醒

- 生产环境必须修改 `docker/.env` 中的所有默认密码和密钥。
- `CREDENTIAL_SECRET_KEY` 用于凭证加密，丢失后无法解密凭证。
- `SECRET_KEY` 用于 Django 会话、JWT 签名等安全场景。
- 生产部署建议启用 HTTPS、关闭 `CORS_ALLOW_ALL_ORIGINS`、配置 `ALLOWED_HOSTS`。

---

## 贡献与反馈

如有问题或建议，请在项目中提交 Issue 或联系维护者。
