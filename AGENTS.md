# AGENTS.md

本文件用于指导 Codex / AI Agent 在本仓库内工作。所有分析、说明、任务拆解、代码注释和文档输出均使用中文；命令、日志、错误栈可保留原始语言，但解释必须用中文。

## 项目概览

Trace Ship 是一个软件版本发布管理系统，围绕“项目”组织仓库、提交审查、发布申请、审批工作流、Jenkins 构建记录、凭证与通知等能力。

仓库主要目录：

- `backend/`：Django 5.0 + Django REST Framework 后端，包含账号、项目、仓库、提交、发布、工作流、Jenkins、凭证、通知、系统管理等模块。
- `frontend/`：React + Vite + TypeScript 前端，已接入路由、布局、Ant Design、Zustand、Axios、React Query 及主要业务页面。
- `docker/`：Docker Compose 编排 PostgreSQL、Redis、Gitea、Jenkins、OpenLDAP、phpLDAPadmin、SVN；`app` profile 可同时启动后端、前端、Celery。
- `docs/`：接口、业务流程、设计文档与 Postman Collection。
- `feat/`、`ui-design/`：需求和 UI 设计相关资料。

## 常用命令

### 启动第三方依赖

开发模式默认本地启动前端、后端、Celery，第三方依赖通过 Docker 启动。

```bash
cd /media/sangfor/vdb/front-workspace/trace-ship

# 一键启动 PostgreSQL / Redis / Gitea / Jenkins / OpenLDAP / SVN 等依赖
bash docker/start.sh

# 或手动启动基础设施服务
docker compose -f docker/docker-compose.yml up -d --build

# 查看日志
docker compose -f docker/docker-compose.yml logs postgres -f
docker compose -f docker/docker-compose.yml logs redis -f
docker compose -f docker/docker-compose.yml logs jenkins -f
```

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
- `apps.jenkins`：Jenkins 任务配置、构建记录、构建状态刷新与日志读取。
- `apps.credential`：凭证加密存储、脱敏展示、凭证解析。
- `apps.notification`：站内通知，覆盖审批、构建、发布和系统消息。
- `apps.system`：系统参数、操作日志等系统管理能力。

### 路由入口

统一在 `backend/config/urls.py` 注册：

- `/api/auth/`
- `/api/account/`
- `/api/projects/`
- `/api/repositories/`
- `/api/commits/`
- `/api/releases/`
- `/api/jenkins/`
- `/api/credentials/`
- `/api/system/`
- `/api/workflow/`
- `/api/notifications/`
- `/api/schema/`、`/swagger/`、`/redoc/`
- `/health/`

新增 API 应按业务归属放入对应 app 的 `urls.py`，再由根路由 include。视图层保持薄封装，复杂业务逻辑优先放入 `services.py`。

### 核心数据模型

项目是主要聚合根：

- `Project`：项目主体，包含 `version_rule`、`release_rule`、负责人和启停状态。
- `ProjectMember`：项目成员角色，角色值为 `developer` / `tester` / `manager` / `auditor` / `viewer`。
- `Repository`：项目下代码仓库，支持 `git` / `svn`，平台包含 GitLab、Gitea、GitHub、Gitee、SVN。
- `CommitRecord`：提交记录与提交规范审查结果。
- `ReleaseRecord`：发布申请，当前状态为 `draft` / `pending` / `released` / `rejected`。
- `ReleaseCommit`、`ReleaseMergeRequest`：发布关联的提交与 MR。
- `WorkflowDefinition`、`WorkflowInstance`、`WorkflowTask`：工作流定义、实例和审批任务。
- `JenkinsJob`、`JenkinsBuild`：Jenkins 任务配置与构建记录。
- `Credential`：凭证密文与凭证元数据。
- `Notification`：站内通知。

### 发布主流程

当前代码中的发布流程以“审批通过后推 tag”为主，Jenkins 构建能力仍保留但不再是新 Tag 流程的必经步骤。

1. 创建发布：`ReleaseService.create_release` 校验项目状态、分支规则与 tag 后缀；如未传版本号，会基于仓库 tag 和 `Project.version_rule` 自动计算。
2. 预览变更：`ReleaseService.preview_changes` 拉取上个 tag 到目标分支之间的 commits / MRs，并解析 A/F 类更新内容。
3. 生成发布说明：`ReleaseService.generate_doc` 保存 Markdown 发布说明。
4. 提交审批：`ReleaseService.submit_audit` 要求发布处于 `draft` 且发布说明非空；按发布类型查找启用的 `WorkflowDefinition`，创建 `WorkflowInstance`，状态改为 `pending`。
5. 审批流转：`WorkflowEngine` 根据 `node_config` 生成任务，支持通过、驳回、转交、回退、撤销。
6. 审批完成：`ReleaseService.handle_workflow_completed` 调用 `push_tag`；推 tag 成功后发布状态变为 `released`，失败则变为 `rejected` 并写入 `rejected_reason`。
7. 审批驳回：`ReleaseService.handle_workflow_rejected` 将发布状态改为 `rejected`；回退到初始节点时可恢复为 `draft` 并解除流程实例关联。

`ReleaseRecord.status` 不包含旧文档里的 `building` / `auditing` 状态。不要在新代码中依赖这些旧状态。

### Jenkins 能力边界

`JenkinsService` 可以触发构建、轮询队列号 / 构建号、刷新构建状态、读取日志、保存产物信息。`JenkinsBuild.status` 为 `queue` / `running` / `success` / `failure` / `aborted`。

发布服务中仍保留 `trigger_build_for_release` 和 `handle_build_completed` 兼容方法，但当前新 Tag 发布流程不主动触发 Jenkins 构建。涉及 Jenkins 的需求应先确认是“独立打包任务管理”还是要重新纳入发布状态机。

### Provider 与凭证

- 凭证通过 `apps.credential` 加密存储，接口返回时应脱敏。
- 使用 `utils.provider.credential_resolver.resolve_credential(source, request_user)` 解析凭证。
- 使用 `utils.provider.factory.get_provider(vendor, server_url, credential_data)` 创建 Git / SVN / Jenkins provider。
- Git 类 provider 统一提供分支、提交、tag、MR、compare、create tag 等能力；Jenkins provider 基于 `python-jenkins`。

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

### 主要目录

- `src/api/`：按业务模块拆分接口封装。
- `src/router/`：路由配置、鉴权守卫、懒加载页面。
- `src/layouts/`：登录布局、主布局、系统子布局、侧边栏和顶部栏。
- `src/pages/`：工作台、项目、仓库、提交审查、凭证、Jenkins、工作流、发布、通知、个人中心、系统管理等页面。
- `src/components/`：项目内通用组件，例如卡片、列表、弹窗、状态标签、搜索筛选栏、审批流预览。
- `src/stores/`：Zustand store。
- `src/types/`：全局类型。
- `src/mock/`：页面开发用 mock 数据；接真实接口时注意逐步清理或隔离。

### 已有路由页面

当前前端已覆盖：

- `/dashboard`
- `/projects`、`/projects/:id`、`/projects/:id/:tab`
- `/repositories`、`/repositories/:id`
- `/credentials`、`/credentials/:id`
- `/commits`、`/commits/alerts`、`/commits/:id`
- `/jenkins`、`/jenkins/logs/:buildId`
- `/workflows`
- `/releases`、`/releases/create`、`/releases/:id`
- `/notifications`
- `/system/users`、`/system/roles`、`/system/configs`、`/system/logs`
- `/profile`

新增页面时优先沿用 `MainLayout`、`PageLoader`、现有 API 层与类型定义。

## 代码约定

### 后端

- 后端代码使用中文注释和 type hints，与现有风格一致。
- 模型字段应设置 `verbose_name`；系统类表通常以 `sys_` 开头，业务表按 app 语义命名。
- 新业务逻辑优先放在 `services.py`，视图只做参数、权限、序列化和响应封装。
- 修改模型后必须考虑迁移文件、测试数据和序列化器。
- 涉及发布、工作流、凭证、权限的改动要补充或更新测试。
- 不要恢复旧的 `ProjectIntegration` 设计；当前仓库和 Jenkins 任务直接归属项目并各自绑定凭证。

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
- Docker 默认值以 `docker/docker-compose.yml` 和 `docker/.env` 为准；常见端口包括后端 `8000`、前端容器 `8002`、Vite `5173`、Gitea、Jenkins、phpLDAPadmin、SVN 等。

## 重要注意事项

- 根目录 README 和部分文档可能滞后于代码，例如前端不再是“待实现”，发布流程也已从旧的构建状态链调整为审批后推 tag。实现前优先以代码为准。
- `docs/business-process-analysis.md` 是阶段规划，不等同于当前实现。处理需求时要区分“已实现能力”和“规划能力”。
- 工作区可能已有用户改动。不要回滚未由自己产生的改动；如遇冲突，先读懂现状再最小化修改。
- 不要使用破坏性 git 命令。提交、部署、重置等操作必须在用户明确要求后进行。
- 网络受限；安装依赖、访问外部服务或远程仓库前需要确认是否真的必要。
