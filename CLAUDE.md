# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trace Ship 是一个软件版本发布管理系统。仓库分为三个主要部分：

- `backend/` — Django 5.0 + Django REST Framework 后端服务。
- `frontend/` — React + Vite + TypeScript + Ant Design 6 前端工程，已完整接入业务页面。
- `docker/` — Docker Compose 编排，包含 PostgreSQL、Redis、Gitea、Jenkins、OpenLDAP、SVN 等第三方依赖（backend / frontend / Celery 默认在本地启动）。

## Language

所有输出、思考过程、任务说明、代码注释和文档均使用中文。与仓库交互时的命令、日志、错误信息可保留原始语言，但解释和总结必须用中文。

## Common Commands

### 启动第三方依赖（Docker）

Trace Ship 的第三方依赖统一使用 Docker 部署；前端、后端、Celery 在本地启动以便调试。

```bash
cd /media/sangfor/vdb/front-workspace/trace-ship

# 一键启动第三方依赖（PostgreSQL / Redis / Gitea / Jenkins / OpenLDAP / SVN）
bash docker/start.sh

# 或手动启动（默认不启动带 app profile 的应用服务）
docker compose -f docker/docker-compose.yml up -d --build

# 查看 PostgreSQL 日志
docker compose -f docker/docker-compose.yml logs postgres -f

# 查看 Redis 日志
docker compose -f docker/docker-compose.yml logs redis -f

# 如需一键启动完整应用服务（含 backend / frontend / celery-worker / celery-beat）
docker compose -f docker/docker-compose.yml --profile app up -d --build

# 查看后端日志（仅在启用 app profile 时可用）
docker compose -f docker/docker-compose.yml logs backend -f

# 查看 Celery Worker 日志（仅在启用 app profile 时可用）
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
- `apps.repository.Repository` 与 `CommitRecord`：代码仓库（Git / SVN，直接归属项目并各自绑定凭证）与提交记录。
- `apps.release.ReleaseRecord` 与 `ReleaseCommit`：发布记录与关联提交。
- `apps.workflow.WorkflowDefinition` / `WorkflowInstance` / `WorkflowTask`：审批工作流定义、实例与任务。
- `apps.package.PackageImage` / `PackageConfig` / `PackageTask`：系统级打包镜像、项目级打包配置、打包任务记录。
- `apps.jenkins.JenkinsJob` 与 `JenkinsBuild`：Jenkins 任务配置与构建记录。

注意：旧的 `ProjectIntegration` 模型已废弃，不要在新代码中恢复；仓库和 Jenkins 任务直接归属项目。

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

### 发布主流程

当前发布流程以“审批通过后推 tag”为主，`ReleaseRecord.status` 仅有 `draft` / `pending` / `released` / `rejected` 四个状态，不包含旧文档中的 `building` / `auditing`。

1. 创建发布（`ReleaseService.create_release`）：校验项目状态、分支规则与 tag 后缀；未传版本号时基于仓库 tag 和 `Project.version_rule` 自动计算。
2. 预览变更（`ReleaseService.preview_changes`）：拉取上个 tag 到目标分支之间的 commits / MRs，解析 A/F 类更新内容。
3. 生成发布说明（`ReleaseService.generate_doc`）：保存 Markdown 发布说明。
4. 提交审批（`ReleaseService.submit_audit`）：要求 `draft` 状态且发布说明非空；按发布类型查找启用的 `WorkflowDefinition` 创建 `WorkflowInstance`，状态改为 `pending`。
5. 审批流转（`WorkflowEngine`）：支持通过、驳回、转交、回退、撤销。
6. 审批完成（`ReleaseService.handle_workflow_completed`）：调用 `push_tag`，成功后状态为 `released`；推 tag 失败则状态为 `rejected` 并写入 `rejected_reason`。
7. 自动打包：推 tag 成功后调用 `PackageService.trigger_auto_packages_for_release`，为开启 `auto_package_on_release` 的 `PackageConfig` 创建 `PackageTask`；触发异常仅记录操作日志，不影响发布状态。
8. 审批驳回（`ReleaseService.handle_workflow_rejected`）：状态改为 `rejected`；回退到初始节点时可恢复为 `draft`。

### 打包能力（apps.package）

- `PackageImage`：系统级 Docker 打包镜像（Web / Qt），由超管维护，定义镜像、脚本入口、默认构建/产物目录。
- `PackageConfig`：项目级打包配置，模式为 `simple`（Docker 镜像打包）或 `local`（本地脚本打包），支持环境变量、构建/产物目录覆盖、发布后自动打包开关、SVN 推送配置（svn_url / svn_credential / svn_path_template）。
- `PackageTask`：打包任务记录，状态 `queued` / `running` / `success` / `failure` / `canceled`，保存配置快照、工作区路径、日志路径、产物信息、SVN 推送结果。
- 执行流程：`PackageService.create_task_for_release` 创建任务 → `dispatch_task` 提交 Celery `run_package_task` → 拉取源码 → 按模式执行 Docker 镜像构建或本地脚本 → 扫描产物 → 可选推送 SVN → 更新状态与耗时。
- 手动能力：`PackageConfigViewSet.trigger` 手动触发某个已发布版本的打包；`PackageTaskViewSet.cancel` 取消任务、`push_svn` 手动推送产物、`logs` 读取日志、`download_artifact` 下载产物。
- Jenkins 构建能力仍保留（`JenkinsService` 可触发构建、轮询状态、读取日志），但不再是新 Tag 发布流程的必经步骤；`trigger_build_for_release` / `handle_build_completed` 仅为历史兼容方法。

### Celery

- 应用入口：`config/celery.py`，使用 `app.autodiscover_tasks()` 自动发现各 app 的 `tasks.py`。
- 当前主要任务：
  - `apps.jenkins.tasks.poll_jenkins_build`：轮询 Jenkins 构建状态。
  - `apps.package.tasks.run_package_task`：执行打包任务（Docker 镜像构建 / 本地脚本 / SVN 推送）。
  - `apps.repository.tasks`：提交同步相关任务。
  - `apps.release.tasks`：发布相关异步任务。

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
- `docs/business-process-analysis.md` 是阶段规划文档，与当前实现存在差异（例如发布状态机、Jenkins 在流程中的位置、前端完成度），实现需求时以代码为准。
- 根目录 `AGENTS.md` 与本文件保持同步，优先参考 `AGENTS.md` 的"重要注意事项"一节。
