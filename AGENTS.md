# AGENTS.md

本文件用于指导 Codex / AI Agent 在本仓库内工作。所有分析、说明、任务拆解、代码注释和文档输出均使用中文；命令、日志、错误栈可保留原始语言，但解释必须用中文。

## 项目概览

Trace Ship 是一个软件版本发布管理系统，围绕“项目”组织仓库、提交审查、发布申请、审批工作流、打包推送（Docker 镜像 / 本地脚本 / SVN）、凭证与通知等能力。

仓库主要目录：

- `backend/`：Django 5.0 + Django REST Framework 后端，包含账号、项目、仓库、提交、发布、工作流、打包、凭证、通知、反馈、系统管理等模块（Jenkins 模块已下线，仅保留迁移 tombstone）。
- `frontend/`：React + Vite + TypeScript 前端，已接入路由、布局、Ant Design、Zustand、Axios、React Query 及主要业务页面（含使用指南、使用反馈、浏览器升级引导）。
- `docker/`：Docker Compose 编排 PostgreSQL、Redis、GitLab；`test` profile 追加 OpenLDAP、phpLDAPadmin、SVN 模拟服务；`app` profile 可同时启动后端、前端、Celery。生产编排拆分为 `docker-compose.deps.yml`（数据层，独立项目 `trace-ship-deps`）与 `docker-compose.prod.yml`（应用层，项目 `trace-ship`），经共享网络 `trace-ship-net` 通信。
- `vscode-commit/`：VS Code 规范提交助手插件子项目，通过 AI 自动生成规范 commit 信息；默认本地 DeepSeek 接口，`commit.apiProtocol` 配置（auto / openai / anthropic）兼容更多 AI 服务。
- `scripts/`：开发环境管理（`dev.sh`）、发布包构建（`build.sh`）与内网部署（`deploy.sh`）脚本。
- `docs/`：接口、业务流程、设计文档与 Postman Collection。
- `feat/`、`ui-design/`：需求和 UI 设计相关资料。

## 常用命令

### 开发环境脚本（scripts/dev.sh）

开发模式默认本地启动前端、后端，第三方依赖通过 Docker 启动。统一入口为 `scripts/dev.sh`（后台进程 PID/日志在 `scripts/.run/`）：

```bash
cd /media/sangfor/vdb/front-workspace/trace-ship

# 启动第三方开发容器（PostgreSQL / Redis / GitLab）
scripts/dev.sh deps

# 测试环境追加 OpenLDAP / SVN 模拟服务
scripts/dev.sh deps --test

# 本地启动后端（自动迁移）/ 前端（Vite）
scripts/dev.sh backend
scripts/dev.sh frontend

# 一键启动依赖 + 后端 + 前端
scripts/dev.sh all [--test]

# 查看状态 / 日志 / 关闭所有
scripts/dev.sh status
scripts/dev.sh logs backend
scripts/dev.sh down

# 其他：无参数进入交互菜单；scripts/dev.sh gitlab-admin 获取 GitLab 管理员信息

# 或手动操作依赖编排
docker compose -f docker/docker-compose.yml up -d --build
docker compose -f docker/docker-compose.yml logs postgres -f
docker compose -f docker/docker-compose.yml logs gitlab -f
```

### 打包与部署（scripts/build.sh + scripts/deploy.sh）

`scripts/deploy.sh` 是部署脚本源文件，`build.sh` 打包时会将其拷入发布包，内网侧解压后直接执行。

```bash
scripts/build.sh --deps       # 第三方依赖包（postgres + redis + gitlab，首次部署用）
scripts/build.sh --backend    # 后端更新包
scripts/build.sh --frontend   # 前端更新包
scripts/build.sh --app        # 前后端更新包

# 内网侧解压后使用包内 deploy.sh
./deploy.sh --full            # 第一次部署（生成 .env.prod，先起依赖组再起应用）
./deploy.sh --backend | --frontend | --app   # 增量部署
```

首次部署需将 `--deps` 与 `--app` 两个包解压到同一目录后执行 `./deploy.sh --full`。

如需容器内启动完整应用服务：

```bash
docker compose -f docker/docker-compose.yml --profile app up -d --build
docker compose -f docker/docker-compose.yml logs backend -f
docker compose -f docker/docker-compose.yml logs celery-worker -f
```

### 后端本地开发

```bash
cd backend
source .venv/bin/activate
export DJANGO_SETTINGS_MODULE=config.settings.dev

pip install -r requirements.txt
python manage.py migrate
python manage.py init_base_data
python manage.py runserver 0.0.0.0:8000
```

管理员密码丢失恢复：`python manage.py reset_admin_password`（默认恢复为 `admin@123`，支持 `--username` / `--password` 参数）；`init_base_data --reset-admin` 也可强制重置。

常用检查：

```bash
python manage.py check
python manage.py spectacular --file schema.yml
pytest
pytest apps/release/tests -v
```

`pytest.ini` 使用 `config.settings.test`，测试环境为内存 SQLite，Celery eager 执行，不依赖真实 PostgreSQL / Redis。

### Celery 本地开发

```bash
cd backend
source .venv/bin/activate
export DJANGO_SETTINGS_MODULE=config.settings.dev

celery -A config worker -l info
celery -A config beat -l info
```

### 前端本地开发

```bash
cd frontend

npm install
npm run dev       # Vite 默认 5173，/api 代理到后端
npm run build     # tsc -b && vite build
npm run lint      # ESLint
npm run preview
```

前端没有独立 format 命令；修改时保持现有 TypeScript、组件和样式风格。

## 后端架构

### 应用模块

- `apps.account`：用户、角色、权限、登录认证、菜单。
- `apps.project`：项目、项目成员；项目创建时会补齐内置发布审批流程。
- `apps.repository`：代码仓库、提交记录、提交同步与提交规范审查。
- `apps.release`：发布申请、版本号计算、发布说明、发布关联提交 / MR、推 tag。
- `apps.workflow`：审批流程定义、流程实例、审批任务，支持串行审批、或签、会签、转交、回退、撤销。
- `apps.package`：打包镜像、项目级打包配置、打包任务；支持 Docker 镜像打包、本地脚本打包、产物 SVN 推送、发布后自动触发。
- `apps.jenkins`：已下线，仅保留迁移 tombstone（空 models + 历史迁移），无 API 与业务逻辑。
- `apps.credential`：凭证加密存储、脱敏展示、凭证解析。
- `apps.notification`：站内通知，覆盖审批、构建、发布和系统消息。
- `apps.feedback`：使用反馈，全员可提交/点赞/查看，删除仅限本人或超管；超管可将反馈标记为已处理（记录处理人与处理时间）。
- `apps.system`：系统参数、操作日志等系统管理能力；LDAP 连接参数也可在「系统配置」页面维护（页面配置优先，环境变量兜底），并提供 LDAP 连接测试接口。

### 路由入口

统一在 `backend/config/urls.py` 注册：

- `/api/auth/`
- `/api/account/`
- `/api/projects/`
- `/api/repositories/`
- `/api/commits/`
- `/api/releases/`
- `/api/packages/`
- `/api/credentials/`
- `/api/system/`
- `/api/workflow/`
- `/api/notifications/`
- `/api/feedback/`
- `/api/schema/`、`/swagger/`、`/redoc/`
- `/health/`

注意：`apps.jenkins` 已整体下线（模型、服务、API、`python-jenkins` 依赖均已移除），仅在 `INSTALLED_APPS` 中保留迁移 tombstone（`release.0001` 历史迁移依赖），打包统一走 `apps.package`。新增 API 应按业务归属放入对应 app 的 `urls.py`，再由根路由 include。视图层保持薄封装，复杂业务逻辑优先放入 `services.py`。

### 核心数据模型

项目是主要聚合根：

- `Project`：项目主体，包含 `version_rule`、`release_rule`、负责人和启停状态。
- `ProjectMember`：项目成员角色，角色值为 `developer` / `tester` / `manager` / `auditor` / `viewer`。
- `Repository`：项目下代码仓库，仅支持 Git（GitLab）；SVN 仅作为打包产物推送目标（见 `PackageConfig` 的 SVN 推送配置）。
- `CommitRecord`：提交记录与提交规范审查结果。
- `ReleaseRecord`：发布申请，当前状态为 `draft` / `pending` / `released` / `rejected`。
- `ReleaseCommit`、`ReleaseMergeRequest`：发布关联的提交与 MR。
- `WorkflowDefinition`、`WorkflowInstance`、`WorkflowTask`：工作流定义、实例和审批任务。
- `PackageImage`：打包镜像记录（来源为本地 Docker 或 Nexus），按镜像坐标唯一，由选择时自动创建。
- `PackageConfig`：项目级打包配置，包含镜像引用、可选自定义脚本、环境变量、发布后自动打包开关、SVN 推送配置。
- `PackageTask`：打包任务记录，状态为 `queued` / `running` / `success` / `failure` / `canceled`，记录工作区、日志、产物与 SVN 推送结果。
- `Credential`：凭证密文与凭证元数据。
- `Notification`：站内通知。
- `Feedback`：使用反馈，包含分类、点赞用户集合、处理状态（`open` / `processed`）、处理人与处理时间。

### 发布主流程

当前代码中的发布流程以“审批通过后推 tag”为主，打包统一由 `apps.package` 承担。

1. 创建发布：`ReleaseService.create_release` 校验项目状态、分支规则与 tag 后缀；如未传版本号，会基于仓库 tag 和 `Project.version_rule` 自动计算。
2. 预览变更：`ReleaseService.preview_changes` 拉取上个 tag 到目标分支之间的 commits / MRs，并解析 A/F 类更新内容。
3. 生成发布说明：`ReleaseService.generate_doc` 保存 Markdown 发布说明。
4. 提交审批：`ReleaseService.submit_audit` 要求发布处于 `draft` 且发布说明非空；按发布类型查找启用的 `WorkflowDefinition`，创建 `WorkflowInstance`，状态改为 `pending`。
5. 审批流转：`WorkflowEngine` 根据 `node_config` 生成任务，支持通过、驳回、转交、回退、撤销。
6. 审批完成：`ReleaseService.handle_workflow_completed` 调用 `push_tag`；推 tag 成功后发布状态变为 `released`，失败则变为 `rejected` 并写入 `rejected_reason`。
7. 自动打包：推 tag 成功后 `ReleaseService` 调用 `PackageService.trigger_auto_packages_for_release`，为开启 `auto_package_on_release` 的 `PackageConfig` 创建 `PackageTask`；触发异常仅记录操作日志，不影响发布状态。
8. 审批驳回：`ReleaseService.handle_workflow_rejected` 将发布状态改为 `rejected`；回退到初始节点时可恢复为 `draft` 并解除流程实例关联。

`ReleaseRecord.status` 不包含旧文档里的 `building` / `auditing` 状态。不要在新代码中依赖这些旧状态。

### 打包流程

打包统一由 `apps.package` 执行，镜像可来自本地 Docker 或 Nexus（Nexus 连接在「系统配置」页面维护，存 `sys_config` 的 `nexus_*` 键）：

1. 「打包镜像」页面实时聚合本地与 Nexus 镜像列表，支持上传 tar 包导入本地（`docker load`）。
2. 项目管理员在「打包配置」中直接选择镜像（按坐标 get_or_create 镜像记录）、构建目录、产物目录，可选填写自定义脚本。
3. 打包任务执行流程：
   - 准备 `workspace/{source,artifacts,tmp}`；
   - `git clone` 源码到 `workspace/source`；
   - 只挂载 `source` / `artifacts` / `tmp` 到容器 `/workspace` 对应目录，`scripts` / `deploy` 使用镜像自身内容；
   - 容器内工作目录为 `/workspace/source`，通过环境变量传入 `DEPLOY_DIR`、`SCRIPTS_DIR` 等；
   - 统一以 `--entrypoint /bin/sh` 启动，镜像自身 ENTRYPOINT 不生效；
   - 若配置 `custom_script`，则以 `sh -c` 直接执行该脚本；
   - 否则执行镜像内置 `script_entry`（默认 `/workspace/scripts/pack.sh`）；
   - 打包产物写入 `/workspace/artifacts`；
   - 扫描 `workspace/artifacts`，可选推 SVN。
4. 镜像必须满足目录、环境变量、入口脚本约定（详见「镜像接入规范」或 `docker/package/web/README.md`）。

### 镜像接入规范

所有打包镜像必须满足：

- 平台挂载目录：`/workspace/source`、`/workspace/artifacts`、`/workspace/tmp`；
- 镜像内提供：`/workspace/scripts/pack.sh`（内置打包入口）、可选 `/workspace/deploy`（预制依赖）、容器内存在 `/bin/sh`；
- 入口脚本负责读取环境变量、执行打包、输出产物、不主动联网安装依赖。

### Jenkins 模块状态

Jenkins 模块已整体下线：模型通过迁移删除（`jenkins.0006_delete_models`），服务、任务、API、`python-jenkins` 依赖与 `utils/provider/jenkins.py` 均已移除；`apps.jenkins` 仅保留空壳（apps.py + 空 models.py + 历史迁移）以维持迁移链。不要在新代码中恢复 Jenkins 相关逻辑；打包需求一律走 `apps.package`。

### Provider 与凭证

- 凭证通过 `apps.credential` 加密存储，接口返回时应脱敏。
- 使用 `utils.provider.credential_resolver.resolve_credential(source, request_user)` 解析凭证。
- 使用 `utils.provider.factory.get_provider(vendor, server_url, credential_data)` 创建 GitLab / SVN provider。
- Git 类 provider 统一提供分支、提交、tag、MR、compare、create tag 等能力；SVN provider 用于打包产物推送。

### 统一响应、异常与权限

- API 响应使用 `utils.response.success_response` / `error_response`，格式为 `{code, message, data}`。
- 异常由 `utils.exceptions.custom_exception_handler` 统一包装。
- 默认分页器为 `utils.pagination.StandardPagination`。
- 权限类在 `utils.permissions`，项目资源通常使用项目成员权限；超管默认放行。

## 前端架构

### 技术栈

- React 19 + Vite + TypeScript。
- Ant Design 6 作为主要组件库，`@ant-design/icons` 与 `lucide-react` 均可用。
- React Router 7 使用 `createBrowserRouter`。
- Zustand 管理认证和全局状态。
- Axios 封装在 `src/api/request.ts`，统一处理 `{code, message, data}` 响应、JWT Header、401 刷新 token。
- React Query 已引入，按页面需要使用。
- Tailwind CSS 4 已接入，主题变量位于 `src/styles/theme.ts` 和样式文件中。
- 图表使用 chart.js（Dashboard）；日期处理使用 dayjs。

### 主要目录

- `src/api/`：按业务模块拆分接口封装。
- `src/router/`：路由配置、鉴权守卫、懒加载页面。
- `src/layouts/`：登录布局、主布局、系统子布局、侧边栏和顶部栏。
- `src/pages/`：工作台、项目、仓库、提交审查、凭证、打包、打包镜像、工作流、发布、通知、使用指南、使用反馈、个人中心、系统管理等页面。
- `src/components/`：项目内通用组件，例如卡片、列表、弹窗、状态标签、搜索筛选栏、审批流预览。
- `src/stores/`：Zustand store。
- `src/types/`：全局类型。

注意：`src/pages/TagGenerator/` 是未注册到路由的历史遗留页面（`/tags` 已重定向到 `/releases/create`），不要在其基础上继续开发；mock 目录已彻底清理，页面一律对接真实接口。

### 已有路由页面

当前前端已覆盖：

- `/dashboard`
- `/projects`、`/projects/:id`、`/projects/:id/:tab`
- `/repositories`、`/repositories/:id`
- `/credentials`、`/credentials/:id`
- `/commits`、`/commits/alerts`、`/commits/:id`
- `/packages`、`/packages/:id`（打包看板）
- `/workflows`
- `/releases`、`/releases/create`、`/releases/:id`
- `/notifications`
- `/guide`（使用说明）
- `/feedback`（使用反馈）
- `/system/users`、`/system/roles`、`/system/configs`、`/system/package-images`、`/system/logs`
- `/profile`
- `/browser-upgrade`（浏览器升级引导页，无需登录）

新增页面时优先沿用 `MainLayout`、`PageLoader`、现有 API 层与类型定义。

## 代码约定

### 后端

- 后端代码使用中文注释和 type hints，与现有风格一致。
- 模型字段应设置 `verbose_name`；系统类表通常以 `sys_` 开头，业务表按 app 语义命名。
- 新业务逻辑优先放在 `services.py`，视图只做参数、权限、序列化和响应封装。
- 修改模型后必须考虑迁移文件、测试数据和序列化器。
- 涉及发布、工作流、凭证、权限的改动要补充或更新测试。
- 不要恢复旧的 `ProjectIntegration` 设计；当前仓库直接归属项目并各自绑定凭证。

### 前端

- 保持现有 React + TypeScript + Ant Design 风格。
- 新接口放入 `src/api/<module>.ts`，通过 `get/post/put/patch/del` 包装函数访问。
- 认证状态优先使用 `useAuthStore`，不要绕过 token 刷新机制直接创建新的 Axios 实例。
- 页面内状态和表单尽量局部化；跨页面状态再放入 Zustand。
- UI 要偏管理后台：信息密度适中、可扫描、少装饰，避免营销页式 hero 和大面积装饰渐变。

## 环境与默认值

- Django settings：
  - `config.settings.dev`：本地开发。
  - `config.settings.test`：pytest 使用，内存 SQLite + eager Celery。
  - `config.settings.prod`：Docker / 生产配置。
- 关键环境变量：`SECRET_KEY`、`CREDENTIAL_SECRET_KEY`、`DB_*`、`REDIS_*`、`LDAP_*`、`ALLOWED_HOSTS`、`CORS_ALLOW_ALL_ORIGINS`。
- 默认后端账号：`admin / admin@123`。
- Docker 默认值以 `docker/docker-compose.yml` 和 `docker/.env` 为准；常见端口包括后端 `8000`、前端容器 `8002`、Vite `5173`、GitLab `18929`、phpLDAPadmin `18090`（test）、SVN `3690`（test）等。
- `docker/` 下另有 `start-prod.sh`（本地生产模式一键部署）与 `setup-docker-mirror.sh`（镜像加速器配置）辅助脚本。
- 数据卷统一显式命名 `trace-ship-*`（如 `trace-ship-postgres-data`），不随 compose 项目名变化。

## 重要注意事项

- 根目录 README 和部分文档可能滞后于代码，例如前端不再是“待实现”，发布流程也已从旧的构建状态链调整为审批后推 tag。实现前优先以代码为准。
- `docs/business-process-analysis.md` 是阶段规划，不等同于当前实现。处理需求时要区分“已实现能力”和“规划能力”。
- 工作区可能已有用户改动。不要回滚未由自己产生的改动；如遇冲突，先读懂现状再最小化修改。
- 前端 `src/mock/` 已彻底清理，页面一律对接真实接口；`src/pages/TagGenerator/` 为未注册的历史遗留页面，不要在路由或新代码中引用。
- 不要使用破坏性 git 命令。提交、部署、重置等操作必须在用户明确要求后进行。
- 网络受限；安装依赖、访问外部服务或远程仓库前需要确认是否真的必要。
