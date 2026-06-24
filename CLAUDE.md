# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trace Ship 是一个软件版本发布管理系统。仓库分为三个主要部分：

- `backend/` — Django 5.0 + Django REST Framework 后端服务。
- `frontend/` — React + Vite + TypeScript 前端工程（已初始化，待完整接入业务）。
- `docker/` — Docker Compose 编排，包含 PostgreSQL、Redis、Gitea、Jenkins、OpenLDAP、SVN、Celery Worker/Beat。

## Language

所有输出、思考过程、任务说明、代码注释和文档均使用中文。与仓库交互时的命令、日志、错误信息可保留原始语言，但解释和总结必须用中文。

## Common Commands

### 一键启动全栈（Docker）

```bash
cd /media/sangfor/vdb/front-workspace/trace-ship

# 构建并启动所有服务
docker compose -f docker/docker-compose.yml up -d --build

# 查看后端日志
docker compose -f docker/docker-compose.yml logs backend -f

# 查看 Celery Worker 日志
docker compose -f docker/docker-compose.yml logs celery-worker -f
```

### 后端本地开发

```bash
cd backend

# 默认 manage.py 使用 config.settings.dev
export DJANGO_SETTINGS_MODULE=config.settings.dev

# 安装依赖
pip install -r requirements.txt

# 数据库迁移
python manage.py migrate

# 初始化基础数据（超管、角色、权限）
python manage.py init_base_data

# 启动开发服务器
python manage.py runserver 0.0.0.0:8000

# 项目检查
python manage.py check

# 导出 OpenAPI Schema
python manage.py spectacular --file schema.yml
```

### 后端测试

```bash
cd backend

# 运行全部测试（pytest.ini 已配置 config.settings.test）
pytest

# 运行单个测试
pytest apps/release/tests/test_views.py::TestReleaseViews::test_create_release -v

# 指定应用测试
pytest apps/jenkins/tests
```

测试使用 SQLite 内存数据库，`CELERY_TASK_ALWAYS_EAGER=True`，不会连接真实 Redis/PostgreSQL。

### Celery 本地启动

```bash
cd backend
export DJANGO_SETTINGS_MODULE=config.settings.dev

# Worker
celery -A config worker -l info

# Beat（如有定时任务）
celery -A config beat -l info
```

### 前端本地开发

```bash
cd frontend

npm install
npm run dev       # 默认端口 5173，/api 代理到 localhost:8000
npm run build
npm run lint
```

前端目前未配置独立的格式化命令；`npm run lint` 使用 ESLint。

## Architecture

### 项目为中心的资源模型

所有业务资源都围绕 `Project` 组织：

- `apps.project.Project`：项目主体，包含 `version_rule` 和 `release_rule` JSON 规则。
- `apps.project.ProjectMember`：用户与项目的关联，角色为 `developer` / `tester` / `manager` / `auditor` / `viewer`。
- `apps.project.ProjectIntegration`：外部系统绑定（Git 仓库 / SVN / Jenkins），含凭证模式配置。
- `apps.repository.Repository` 与 `CommitRecord`：代码仓库与提交记录。
- `apps.release.ReleaseRecord` 与 `ReleaseCommit`：发布记录与关联提交。
- `apps.jenkins.JenkinsJob` 与 `JenkinsBuild`：Jenkins 任务配置与构建记录。

### 认证与权限

- 认证：JWT（`rest_framework_simplejwt`）为主；LDAP/AD（`django-auth-ldap`）可选，未配置时回退到 Django 本地认证。
- 权限类在 `utils.permissions`：
  - `IsProjectMember`：对象级，检查用户是否属于 `obj.project`。
  - `IsProjectManager` / `IsProjectDeveloper` 等：检查 `ProjectMember.role`。
  - 超管始终放行。

### 统一响应与异常

- 视图使用 `utils.response.success_response` 和 `error_response`，返回格式为 `{code, message, data}`。
- `utils.exceptions.custom_exception_handler` 统一包装 DRF/Django 异常为同样格式。
- 默认分页器为 `utils.pagination.StandardPagination`。

### 凭证与 Provider 抽象

- 凭证存储在 `apps.credential`，AES 加密；接口返回脱敏数据。
- `utils.provider.credential_resolver.resolve_credential(source, request_user)` 根据 `credential_mode`（`fixed` / `global` / `current_user` / `specified_user`）解析出解密后的凭证 dict。
- `utils.provider.factory.get_provider(vendor, server_url, credential_data)` 创建 GitLab / Gitea / SVN / Jenkins 适配器。
- Git 类 Provider 统一继承 `utils.provider.base.GitProvider`，实现 `list_branches`、`list_commits`、`list_tags`、`create_tag`、`compare_commits`。
- Jenkins Provider 基于 `python-jenkins`，封装在 `utils.provider.jenkins`。

### 发布主流程（第三阶段）

`ReleaseRecord` 生命周期：

```
draft → pending → building → auditing → released
   ↓        ↓          ↓
rejected rejected   rejected
```

1. 创建发布（`ReleaseService.create_release`）时自动计算版本号：基于 `Project.version_rule` 和 `GitProvider.list_tags`，默认递增最后一个数字段；测试版自动加 `test_prefix`。
2. 生成发布说明（`ReleaseService.generate_doc`）：拉取上一个 tag 到 `source_branch` 的 commits，通过 `utils.commit_parser.CommitParser` 聚合，过滤 `review_status=illegal` 的提交。
3. 提交审批（`ReleaseService.submit_audit`）：当前为简化实现，仅校验状态与非法提交，状态变为 `pending`。完整工作流引擎为第四阶段内容。
4. 触发 Jenkins 构建（`JenkinsService.trigger_build`）：渲染 `params_template` 后调用 `JenkinsProvider.trigger_build`，创建 `JenkinsBuild` 并启动 Celery 轮询任务 `poll_jenkins_build`。
5. Celery 每 10 秒轮询构建状态；构建成功则将关联 `ReleaseRecord` 从 `building` 更新为 `auditing`，失败/中止则更新为 `rejected`。
6. 推 tag（`ReleaseService.push_tag`）：仅 `auditing` 状态允许，调用 `GitProvider.create_tag`；成功则状态变为 `released`。

### Celery

- 应用入口：`config/celery.py`，使用 `app.autodiscover_tasks()` 自动发现各 app 的 `tasks.py`。
- 当前主要任务：`apps.jenkins.tasks.poll_jenkins_build`。

## Code Conventions

- 后端代码要求 **中文注释 + type hints**，与现有代码保持一致。
- 模型字段应加 `verbose_name`；系统类模型表名常以 `sys_` 开头，业务类模型表名常按 app 命名（如 `release_record`、`jenkins_job`）。
- 新增 API 应通过 `config/urls.py` 注册，统一以 `/api/<resource>/` 开头。
- 新增业务逻辑优先放到 `services.py`，视图层保持薄封装。

## Environment & Defaults

- 后端 settings 模块：
  - `config.settings.dev`：`manage.py` 默认，本地开发。
  - `config.settings.test`：`pytest.ini` 指定，内存 SQLite + Eager Celery。
  - `config.settings.prod`：Docker 部署使用。
- 关键环境变量：`SECRET_KEY`、`CREDENTIAL_SECRET_KEY`、`DB_*`、`REDIS_*`、`LDAP_*`、`ALLOWED_HOSTS`、`CORS_ALLOW_ALL_ORIGINS`。
- 默认管理员账号：`admin / admin@123`。
- Docker 默认端口：后端 `8000`、前端 `8002`、Gitea `13000`、Jenkins `18080`、phpLDAPadmin `18090`、SVN `3690`。

## Important Notes

- 后端目前没有配置 lint / format 工具链；如需引入，应保持与现有代码风格一致。
- `docs/business-process-analysis.md` 将系统实现分为多个阶段。第三阶段（发布主流程）已实现，但 `submit-audit` 是工作流占位实现；第四阶段才会引入完整审批流、AI 生成、发布看板等功能，未明确要求时不必提前实现。
