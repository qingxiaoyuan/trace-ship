# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Trace Ship 是一个软件版本发布管理系统。仓库主要部分：

- `backend/` — Django 5.0 + Django REST Framework 后端服务。
- `frontend/` — React + Vite + TypeScript + Ant Design 6 前端工程，已完整接入业务页面（含使用指南、使用反馈、浏览器升级引导）。
- `docker/` — Docker Compose 编排，包含 PostgreSQL、Redis、GitLab 第三方依赖（`test` profile 可追加 OpenLDAP、SVN 模拟服务；backend / frontend / Celery 默认在本地启动）。生产编排拆分为 `docker-compose.deps.yml`（数据层，独立项目 `trace-ship-deps`）与 `docker-compose.prod.yml`（应用层，项目 `trace-ship`），经共享网络 `trace-ship-net` 通信。
- `scripts/` — 开发环境管理（`dev.sh`）、发布包构建（`build.sh`）与内网部署（`deploy.sh`）脚本。
- `vscode-commit/` — VS Code 规范提交助手插件子项目，AI 自动生成规范 commit 信息；默认本地 DeepSeek 接口，`commit.apiProtocol`（auto / openai / anthropic）兼容更多 AI 服务。

## Language

所有输出、思考过程、任务说明、代码注释和文档均使用中文。与仓库交互时的命令、日志、错误信息可保留原始语言，但解释和总结必须用中文。

## Common Commands

### 开发环境脚本（scripts/dev.sh）

Trace Ship 的开发环境统一通过 `scripts/dev.sh` 管理：第三方依赖走 Docker，前端、后端在本地后台启动以便调试（PID/日志在 `scripts/.run/`）。

```bash
cd /media/sangfor/vdb/front-workspace/trace-ship

# 启动第三方开发容器（PostgreSQL / Redis / GitLab）
scripts/dev.sh deps

# 测试环境追加 OpenLDAP / SVN 模拟服务
scripts/dev.sh deps --test

# 本地启动后端（自动迁移 + runserver，后台运行）
scripts/dev.sh backend

# 本地启动前端（Vite dev server，后台运行）
scripts/dev.sh frontend

# 查看状态 / 跟踪日志
scripts/dev.sh status
scripts/dev.sh logs backend        # 或 frontend / postgres / gitlab 等

# 关闭所有（本地进程 + 全部第三方容器）
scripts/dev.sh down

# 如需容器内一键启动完整应用服务（含 backend / frontend / celery）
docker compose -f docker/docker-compose.yml --profile app up -d --build
```

### 打包与部署脚本（scripts/build.sh + 包内 deploy.sh）

```bash
# 外网机构建发布包（产出 dist/trace-ship-release-<模式>-<时间戳>.tar.gz）
scripts/build.sh --deps       # 第三方依赖包（postgres + redis + gitlab）
scripts/build.sh --backend    # 后端更新包
scripts/build.sh --frontend   # 前端更新包
scripts/build.sh --app        # 前后端更新包

# 内网侧解压后使用包内 deploy.sh 一键部署
./deploy.sh --full            # 第一次部署：自动生成 .env.prod，先起依赖组再起应用
./deploy.sh --backend         # 部署后端
./deploy.sh --frontend        # 部署前端
./deploy.sh --app             # 部署前后端
```

首次部署需将 `--deps` 与 `--app` 两个包解压到同一目录后执行 `./deploy.sh --full`。

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

# 重置管理员密码（密码丢失恢复，默认恢复为 admin@123）
python manage.py reset_admin_password

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
pytest apps/release/tests
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
- `apps.project.ProjectMember`：用户与项目的关联，角色为 `developer` / `tester` / `manager` / `auditor` / `viewer` / `software_admin`（软件管理员，在 `utils.permissions.ProjectRolePermission._check` 中统一放行）。
- `apps.repository.Repository` 与 `CommitRecord`：代码仓库（仅 Git/GitLab，直接归属项目并各自绑定凭证；SVN 仅作为打包产物推送目标）与提交记录。
- `apps.release.ReleaseRecord` 与 `ReleaseCommit`：发布记录与关联提交。
- `apps.workflow.WorkflowDefinition` / `WorkflowInstance` / `WorkflowTask`：审批工作流定义、实例与任务。
- `apps.package.PackageImage` / `PackageConfig` / `PackageTask`：打包镜像记录（来源为本地 Docker 或 Nexus）、项目级打包配置、打包任务记录。
- `apps.feedback.Feedback`：使用反馈，全员可提交/点赞/查看，删除仅限本人或超管；超管可将反馈标记为已处理（`open` / `processed` 状态流转，记录处理人与处理时间）。

注意：旧的 `ProjectIntegration` 模型已废弃，不要在新代码中恢复；`apps.jenkins` 模块已整体下线（Jenkins 能力移除），仅保留迁移 tombstone（空 models + 历史迁移），仓库直接归属项目并绑定凭证。

### 认证与权限

- 认证：JWT（`rest_framework_simplejwt`）为主；LDAP/AD（`django-auth-ldap`）可选，未配置时回退到 Django 本地认证。
- LDAP 连接参数可在「系统配置」页面维护（`apps.account.ldap_config`，页面配置优先、环境变量 `LDAP_*` 兜底），`apps.system` 提供 LDAP 连接测试接口；LDAP 首次登录会自动创建用户并赋予默认角色。
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
- `utils.provider.factory.get_provider(vendor, server_url, credential_data)` 创建 GitLab / SVN 适配器。
- Git 类 Provider 统一继承 `utils.provider.base.GitProvider`，实现 `list_branches`、`list_commits`、`list_tags`、`create_tag`、`compare_commits`。

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

- `PackageImage`：打包镜像记录，来源为本地 Docker 或 Nexus（Nexus 连接在「系统配置」页面维护，存 `sys_config` 的 `nexus_*` 键），按镜像坐标唯一，由选择时自动创建，定义镜像、`script_entry` 入口、默认构建/产物目录。
- `PackageConfig`：项目级打包配置，包含镜像引用、可选 `custom_script` 自定义脚本、环境变量、构建/产物目录、发布后自动打包开关、SVN 推送配置（svn_url / svn_credential / svn_path_template）。
- `PackageTask`：打包任务记录，状态 `queued` / `running` / `success` / `failure` / `canceled`，保存配置快照、工作区路径、日志路径、产物信息、SVN 推送结果。
- 执行流程：`PackageService.create_task_for_release` 创建任务 → `dispatch_task` 提交 Celery `run_package_task` → 准备 `workspace/{source,artifacts,tmp}` → `git clone` 源码 → 以 `--entrypoint /bin/sh` 启动容器（只挂载 source / artifacts / tmp，容器内工作目录 `/workspace/source`）→ 有 `custom_script` 则以 `sh -ec`（遇错即停）执行，否则执行镜像内置 `script_entry`（默认 `/workspace/scripts/pack.sh`，同样以 `sh -e` 遇错即停执行）→ 扫描 `workspace/artifacts` 产物 → 可选推送 SVN → 更新状态与耗时。
- 手动能力：`PackageConfigViewSet.trigger` 手动触发某个已发布版本的打包；`PackageTaskViewSet.cancel` 取消任务、`push_svn` 手动推送产物、`logs` 读取日志、`download_artifact` 下载产物。
- Jenkins 模块已整体下线（模型、服务、API、`python-jenkins` 依赖均已移除），打包统一走 `apps.package`；不要在新代码中恢复 Jenkins 相关逻辑。

### Celery

- 应用入口：`config/celery.py`，使用 `app.autodiscover_tasks()` 自动发现各 app 的 `tasks.py`。
- 当前主要任务：
  - `apps.package.tasks.run_package_task`：执行打包任务（Docker 镜像构建 / 本地脚本 / SVN 推送）。
  - `apps.repository.tasks`：提交同步相关任务。
  - `apps.release.tasks`：发布相关异步任务。

## Code Conventions

- 后端代码要求 **中文注释 + type hints**，与现有代码保持一致。
- 模型字段应加 `verbose_name`；系统类模型表名常以 `sys_` 开头，业务类模型表名常按 app 命名（如 `release_record`、`package_task`）。
- 新增 API 应通过 `config/urls.py` 注册，统一以 `/api/<resource>/` 开头。
- 新增业务逻辑优先放到 `services.py`，视图层保持薄封装。

## Environment & Defaults

- 后端 settings 模块：
  - `config.settings.dev`：`manage.py` 默认，本地开发。
  - `config.settings.test`：`pytest.ini` 指定，内存 SQLite + Eager Celery。
  - `config.settings.prod`：Docker 部署使用。
- 关键环境变量：`SECRET_KEY`、`CREDENTIAL_SECRET_KEY`、`DB_*`、`REDIS_*`、`LDAP_*`、`ALLOWED_HOSTS`、`CORS_ALLOW_ALL_ORIGINS`。
- 默认管理员账号：`admin / admin@123`。
- Docker 默认端口：后端 `8000`、前端 `8002`、GitLab `18929`、phpLDAPadmin `18090`（test）、SVN `3690`（test）。
- 数据卷统一显式命名 `trace-ship-*`（如 `trace-ship-postgres-data`），不随 compose 项目名变化。

## Important Notes

- 后端目前没有配置 lint / format 工具链；如需引入，应保持与现有代码风格一致。
- `docs/business-process-analysis.md` 是阶段规划文档，与当前实现存在差异（例如发布状态机、Jenkins 在流程中的位置、前端完成度），实现需求时以代码为准。
- 根目录 `AGENTS.md` 与本文件保持同步，优先参考 `AGENTS.md` 的"重要注意事项"一节。
