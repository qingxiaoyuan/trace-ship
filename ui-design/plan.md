# TraceShip 前端实现规划

## 一、背景与目标

TraceShip 是「软件版本发布管理与提交规范审查系统」，属于企业级后台管理应用（B2B/内部工具），包含工作台、项目管理、仓库管理、凭证管理、提交规范审查、Tag 生成与发布、Jenkins 构建、工作流审批、发布看板、系统管理等模块。

本规划目标：
- 基于 `ui-design/design.md`、`ui-design/trace-ship-ui.html` 还原设计稿。
- 基于 `docs/api-spec.md` 对接后端接口。
- 输出可执行的页面结构、组件拆分、API 对接方案。

## 二、技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 框架 | React 18 + TypeScript | 类型安全、生态成熟 |
| 构建工具 | Vite 5 | 启动快、HMR 好 |
| UI 库 | Ant Design 5.x | 企业级后台组件库，表格/表单/弹窗/步骤条生态完善 |
| 路由 | React Router 6 | 嵌套路由、路由守卫 |
| 状态管理 | Zustand + React Query (TanStack Query) | Zustand 存全局 UI/用户，React Query 管服务端状态 |
| HTTP 库 | Axios | 拦截器、取消请求、类型友好 |
| 图表 | Ant Design Charts / ECharts | 发布统计报表 |
| 流程图 | @logicflow/core + extensions | 工作流设计器 |
| 代码规范 | ESLint + Prettier | 统一代码风格 |

不采用 Ant Design Pro 全套脚手架，避免 Umi 锁定；用 Vite + React + AntD 轻量搭建，保留最大可控性。

## 三、全局设计 Token（来自设计稿）

```typescript
// src/styles/theme.ts
export const tokens = {
  colors: {
    primary: '#2563EB',
    primaryLight: '#3B82F6',
    primaryDark: '#1D4ED8',
    success: '#10B981',
    warning: '#F59E0B',
    danger: '#EF4444',
    info: '#3B82F6',
    ai: '#8B5CF6',
    bg: '#F8FAFC',
    surface: '#FFFFFF',
    border: '#E2E8F0',
    textPrimary: '#0F172A',
    textBody: '#334155',
    textSecondary: '#64748B',
    textMuted: '#94A3B8',
    logBg: '#0F172A',
    logText: '#34D399',
  },
  layout: {
    sidebarWidth: 240,
    headerHeight: 64,
    pagePadding: 24,
    cardRadius: 16,
    buttonRadius: 12,
    inputRadius: 12,
  },
};
```

Ant Design 主题通过 `ConfigProvider` 的 `theme.token` 注入主色、圆角等，再用 Tailwind CSS / 原生 CSS 覆盖细节（卡片阴影、表格表头样式等）。

## 四、页面结构与路由设计

```
/                          → 工作台 Dashboard（默认首页）
/login                     → 登录页（独立布局）

/projects                  → 项目管理列表
/projects/:id              → 项目详情（Tab 子路由）
  /projects/:id/overview   → 基本信息
  /projects/:id/repos      → 仓库
  /projects/:id/members    → 成员
  /projects/:id/workflows  → 审批流
  /projects/:id/releases   → 发布记录
  /projects/:id/rules      → 规则配置
  /projects/:id/integrations → 外站绑定

/repositories              → 仓库管理
credentials                → 凭证管理
  /credentials/:id/usage   → 凭证使用记录

/commits                   → 提交规范审查
/commits/:id               → Commit 详情
/commits/:id/ai-review     → AI 审查详情
/commits/alerts            → 非法提交预警详情

/tags                      → Tag 生成与发布（三步向导）

/jenkins                   → Jenkins 构建
/jenkins/builds/:id/log    → 构建日志抽屉（路由可选，也可抽屉内嵌）

/workflows                 → 工作流审批（Tab 子路由）
  /workflows/todo          → 我的待办
  /workflows/done          → 我的已办
  /workflows/definitions   → 流程定义
/workflows/tasks/:id       → 审批详情

/releases                  → 发布看板
/releases/:id              → 发布记录详情（Tab 子路由）
  /releases/:id/doc        → 发布说明
  /releases/:id/commits    → 关联提交
  /releases/:id/artifacts  → 构建产物
  /releases/:id/audits     → 审批记录
  /releases/:id/logs       → 操作日志

/system                    → 系统管理（左侧二级导航布局）
  /system/users            → 用户管理
  /system/roles            → 角色权限
  /system/configs          → 系统配置
  /system/logs             → 操作日志

/profile                   → 个人中心
```

## 五、组件拆分

### 5.1 布局组件

| 组件 | 路径 | 职责 |
|------|------|------|
| `AuthLayout` | `src/layouts/AuthLayout.tsx` | 登录页外层，渐变背景 + 居中卡片 |
| `MainLayout` | `src/layouts/MainLayout.tsx` | 侧边栏 + Header + 内容区 |
| `Sidebar` | `src/layouts/components/Sidebar.tsx` | 240px 导航，Logo + 菜单 |
| `TopHeader` | `src/layouts/components/TopHeader.tsx` | 面包屑、项目选择、通知、用户菜单 |
| `SystemSubLayout` | `src/layouts/SystemSubLayout.tsx` | 系统管理左侧二级导航 |

### 5.2 公共业务组件

| 组件 | 路径 | 用途 |
|------|------|------|
| `TsCard` | `src/components/TsCard.tsx` | 统一卡片（白底、圆角、阴影、hover） |
| `TsTable` | `src/components/TsTable.tsx` | 封装 AntD Table，统一表头/行样式 |
| `StatusTag` | `src/components/StatusTag.tsx` | 状态标签（成功/警告/危险/信息/中性） |
| `KpiCard` | `src/components/KpiCard.tsx` | 工作台统计卡片（图标 + 数值 + 辅助） |
| `ProjectSelect` | `src/components/ProjectSelect.tsx` | 顶部项目切换下拉框 |
| `UserDropdown` | `src/components/UserDropdown.tsx` | 用户头像下拉菜单 |
| `BreadcrumbNav` | `src/components/BreadcrumbNav.tsx` | 面包屑导航 |
| `TsModal` | `src/components/TsModal.tsx` | 统一弹窗（项目/仓库/凭证/Jenkins 等新增编辑） |
| `TsDrawer` | `src/components/TsDrawer.tsx` | 统一抽屉（Commit 详情、审批详情、权限配置、构建日志） |
| `StepsHeader` | `src/components/StepsHeader.tsx` | Tag 生成三步步骤条 |
| `SearchFilterBar` | `src/components/SearchFilterBar.tsx` | 通用筛选栏（搜索 + 下拉 + 按钮） |
| `DetailHeader` | `src/components/DetailHeader.tsx` | 详情页头部（标题 + 返回 + 操作按钮） |
| `LogConsole` | `src/components/LogConsole.tsx` | Jenkins 构建日志深色终端 |

### 5.3 页面组件

```
src/pages/
  Login/
    index.tsx
  Dashboard/
    index.tsx
    KpiSection.tsx
    RecentReleaseTable.tsx
    TodoList.tsx
    IllegalCommitAlert.tsx
  Project/
    List.tsx
    Detail.tsx
    tabs/
      OverviewTab.tsx
      RepoTab.tsx
      MemberTab.tsx
      WorkflowTab.tsx
      ReleaseTab.tsx
      RuleTab.tsx
      IntegrationTab.tsx
    modals/
      ProjectModal.tsx
      MemberModal.tsx
      IntegrationModal.tsx
  Repository/
    List.tsx
    modals/RepositoryModal.tsx
  Credential/
    List.tsx
    Usage.tsx
    modals/CredentialModal.tsx
  Commit/
    List.tsx
    Detail.tsx
    AiReview.tsx
    AlertDetail.tsx
  TagGenerator/
    index.tsx
    Step1Branch.tsx
    Step2Diff.tsx
    Step3Doc.tsx
  Jenkins/
    index.tsx
    modals/JobModal.tsx
  Workflow/
    index.tsx
    tabs/TodoTab.tsx
    tabs/DoneTab.tsx
    tabs/DefinitionTab.tsx
    DefinitionCanvas.tsx
    PropertyPanel.tsx
    TaskDetail.tsx
  Release/
    Board.tsx
    Detail.tsx
    tabs/
      DocTab.tsx
      CommitTab.tsx
      ArtifactTab.tsx
      AuditTab.tsx
      LogTab.tsx
    Report.tsx
  System/
    UserList.tsx
    RoleList.tsx
    Config.tsx
    LogList.tsx
    drawers/PermissionDrawer.tsx
  Profile/
    index.tsx
```

## 六、API 对接方案

### 6.1 Axios 封装

```
src/api/
  request.ts          → axios 实例、拦截器、错误处理
  types.ts            → 通用响应类型 ApiResponse<T>
  auth.ts             → 认证接口
  user.ts             → 用户/角色/权限
  project.ts          → 项目管理
  repository.ts       → 仓库管理
  credential.ts       → 凭证管理
  commit.ts           → 提交审查
  release.ts          → 发布管理/Tag
  jenkins.ts          → Jenkins
  workflow.ts         → 工作流
  dashboard.ts        → 看板/统计
  system.ts           → 系统管理
```

### 6.2 请求拦截器

- 读取 `localStorage.accessToken`，注入 `Authorization: Bearer {token}`。
- 401 时跳转 `/login`。
- 50001（外部系统失败）时 message.error 展示具体错误。

### 6.3 响应统一处理

```typescript
interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

// request.ts
request.interceptors.response.use(
  (res) => res.data.data,
  (err) => {
    const data = err.response?.data;
    message.error(data?.message || '请求失败');
    return Promise.reject(data);
  }
);
```

### 6.4 React Query 封装

为高频列表/详情提供 hooks：

```typescript
// src/hooks/useProjects.ts
export const useProjects = (params: ProjectListParams) =>
  useQuery(['projects', params], () => projectApi.getProjects(params));

// src/hooks/useProjectDetail.ts
export const useProjectDetail = (id: string) =>
  useQuery(['project', id], () => projectApi.getProject(id), { enabled: !!id });
```

类似提供 `useRepositories`、`useCredentials`、`useCommits`、`useReleases`、`useWorkflowTasks` 等。

### 6.5 接口与页面对照

| 页面 | 主要接口 |
|------|----------|
| 登录页 | `POST /api/auth/login/`，`GET /api/auth/user-info/`，`GET /api/auth/menus/` |
| 工作台 | `GET /api/dashboard/overview/`，`GET /api/releases/`（最近 10 条），`GET /api/workflow/tasks/todo/`，`GET /api/commits/?review_status=illegal` |
| 项目列表 | `GET /api/projects/`，`POST/PUT/DELETE /api/projects/` |
| 项目详情-仓库 | `GET /api/projects/:id/repos`（或 `/api/repositories/?project_id=`），`POST /api/repositories/`，`POST /api/repositories/:id/test/` |
| 项目详情-成员 | `GET /api/projects/:id/members/`，`POST/DELETE /api/projects/:id/members/` |
| 项目详情-审批流 | `GET /api/workflow/definitions/?project_id=`，CRUD 流程定义 |
| 项目详情-规则 | `PUT /api/projects/:id/` 更新规则字段 |
| 项目详情-外站绑定 | `GET/POST/PUT/DELETE /api/projects/:id/integrations/`，`POST .../test/` |
| 仓库管理 | `GET /api/repositories/`，CRUD，连通性测试 |
| 凭证管理 | `GET /api/credentials/`，CRUD，`GET /api/credentials/:id/usage/`，`GET /api/credentials/types/` |
| 提交审查 | `GET /api/commits/`，`POST /api/commits/:id/review/`，`GET /api/commits/:id/ai-review/` |
| Tag 生成 | `GET /api/repositories/:id/branches/`，`POST /api/releases/`，`POST /api/releases/:id/generate-doc/`，`POST /api/releases/:id/submit-audit/` |
| Jenkins | `GET /api/jenkins/jobs/`，CRUD，`POST /api/jenkins/jobs/:id/trigger/`，`GET /api/jenkins/builds/:id/log/` |
| 工作流审批 | `GET /api/workflow/tasks/todo/`，`GET /api/workflow/tasks/done/`，`POST .../approve/reject/transfer/revoke/` |
| 流程定义 | `GET/POST /api/workflow/definitions/`，graph_data 保存/读取 |
| 发布看板 | `GET /api/releases/`（筛选），`GET /api/releases/:id/`，`POST /api/releases/:id/push-tag/` |
| 系统管理 | `GET /api/account/users/`，`GET /api/account/roles/`，`GET /api/account/permissions/`，`GET/PUT /api/system/configs/`，`GET /api/system/logs/` |

## 七、状态管理

### Zustand Store

```typescript
// src/stores/authStore.ts
interface AuthState {
  user: UserInfo | null;
  menus: MenuItem[];
  token: string | null;
  login: (values) => Promise<void>;
  logout: () => void;
}

// src/stores/globalStore.ts
interface GlobalState {
  currentProjectId: string | null;
  setCurrentProjectId: (id: string) => void;
  collapsed: boolean;
}
```

### React Query

- 所有服务端列表、详情、统计走 React Query。
- 提交类操作（新增、编辑、审批）用 `useMutation` + 成功后 `invalidateQueries`。

## 八、项目目录结构

```
trace-ship/frontend/
├── public/
│   └── logo.svg
├── src/
│   ├── api/                 # 接口封装
│   ├── assets/              # 图片、图标
│   ├── components/          # 通用组件
│   ├── hooks/               # React Query hooks
│   ├── layouts/             # 布局
│   ├── pages/               # 页面
│   ├── router/              # React Router 配置
│   ├── stores/              # Zustand
│   ├── styles/              # 全局样式、主题 Token
│   ├── types/               # TS 类型定义
│   ├── utils/               # 工具函数
│   └── main.tsx
├── .env.development
├── .env.production
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 九、实施阶段

### 第一阶段：基础骨架（1-2 天）

1. 初始化 Vite + React + TypeScript 项目。
2. 安装依赖：antd、@ant-design/charts、react-router-dom、zustand、@tanstack/react-query、axios、@logicflow/core、@logicflow/extension、dayjs。
3. 配置 Ant Design `ConfigProvider` 主题。
4. 搭建 `AuthLayout`、`MainLayout`、`Sidebar`、`TopHeader`。
5. 实现路由配置与基础路由守卫（未登录跳转）。
6. 封装 `request.ts`、登录接口、AuthStore。

### 第二阶段：公共组件与通用能力（2-3 天）

1. 实现 `TsCard`、`TsTable`、`StatusTag`、`KpiCard`、`TsModal`、`TsDrawer`。
2. 实现 `SearchFilterBar`、`DetailHeader`、`StepsHeader`、`LogConsole`。
3. 实现 `ProjectSelect`、`UserDropdown`、`BreadcrumbNav`。
4. 建立全局类型定义、工具函数（日期格式化、脱敏展示等）。

### 第三阶段：核心 P0 页面（5-7 天）

按优先级实现：
1. 登录页
2. 工作台
3. 项目管理（列表 + 详情 Tab）
4. 仓库管理
5. 凭证管理（含使用记录）
6. 提交规范审查（列表、详情、AI 审查、预警）
7. Tag 生成与发布（三步向导）
8. Jenkins 构建
9. 工作流审批（待办/已办/流程定义）

### 第四阶段：P1 页面与完善（3-4 天）

1. 发布看板（列表 + 详情 + 统计报表）
2. 系统管理（用户、角色、配置、日志）
3. 个人中心
4. 细节打磨：加载态、空状态、错误提示、表单校验、响应式。
5. 联调：Mock 数据 → 真实后端接口切换。

## 十、Mock 与联调策略

- 开发阶段使用 MSW（Mock Service Worker）或本地 mock 文件。
- 每个 API 模块同步提供 mock handler。
- 环境变量 `VITE_API_BASE_URL` 控制请求地址。
- 后端就绪后关闭 mock，切换真实接口。

## 十一、验证清单

- [ ] 登录页可正常登录、登出、Token 刷新。
- [ ] 侧边导航与路由对应，菜单高亮正确。
- [ ] 工作台 4 张 KPI 卡片、最近发布表格、我的待办、非法提交预警正常展示。
- [ ] 项目列表支持搜索、筛选、新增、编辑、删除。
- [ ] 项目详情 7 个 Tab 可切换，数据加载正常。
- [ ] 仓库/凭证列表支持筛选、新增、编辑、测试连通性。
- [ ] Commit 列表支持筛选、AI 审查、详情查看。
- [ ] Tag 生成三步向导可完整走完，提交审批成功。
- [ ] Jenkins 构建列表、触发构建、日志查看正常。
- [ ] 工作流待办/已办/审批操作/流程设计器正常。
- [ ] 发布看板筛选、详情、导出、推 Tag 正常。
- [ ] 系统管理用户/角色/配置/日志正常。
- [ ] 所有页面样式与 `trace-ship-ui.html` 高保真原型一致。
