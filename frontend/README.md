# TraceShip 前端

TraceShip - 软件版本发布管理与提交规范审查系统前端。

## 技术栈

- React 19 + TypeScript
- Vite 8（`@vitejs/plugin-react`）
- Ant Design 6 + `@ant-design/icons` + `lucide-react`
- React Router 7（`createBrowserRouter`）
- Zustand（全局状态，认证与全局 Store）
- TanStack React Query 5（服务端状态）
- Axios（HTTP 请求，统一封装于 `src/api/request.ts`）
- Tailwind CSS 4（PostCSS 接入）
- chart.js 4（Dashboard 图表）
- dayjs（日期处理）

## 开发

```bash
npm install
npm run dev      # Vite 默认 5173，/api 代理到 http://localhost:8000
```

## 构建与检查

```bash
npm run build    # tsc -b && vite build
npm run lint     # ESLint
npm run preview  # 预览构建产物
```

## 目录结构

```
src/
  api/          # 接口封装（按业务模块拆分，request.ts 统一处理响应与 401 刷新）
  assets/       # 静态资源
  components/   # 通用组件（卡片、列表、弹窗、状态标签、审批流预览等）
  hooks/        # 通用 hooks（如 useAppMessage）
  layouts/      # 布局组件（AuthLayout / MainLayout / SystemSubLayout）
  pages/        # 页面组件
  router/       # 路由配置（index.tsx 路由表、components.tsx 鉴权守卫、pages.ts 懒加载）
  stores/       # Zustand 状态（authStore / globalStore）
  styles/       # 主题与全局样式（theme.ts、tailwind.css）
  types/        # TypeScript 类型
  utils/        # 工具函数
```

## 页面与路由

- `/login`：登录页（AuthLayout）
- `/browser-upgrade`：浏览器升级提示页
- `/`、`/dashboard`：工作台
- `/projects`、`/projects/:id`、`/projects/:id/:tab`：项目管理与详情
- `/repositories`、`/repositories/:id`：仓库管理与详情
- `/credentials`、`/credentials/:id`：凭证管理与详情
- `/commits`、`/commits/alerts`、`/commits/:id`：提交规范审查与非法提交预警
- `/packages`、`/packages/:id`：打包看板
- `/workflows`：工作流审批
- `/releases`、`/releases/create`、`/releases/:id`：发布看板、新建发布、发布详情
- `/tags`：历史路径，重定向到 `/releases/create`
- `/notifications`：通知中心
- `/guide`：使用说明
- `/feedback`：使用反馈
- `/system/users`、`/system/roles`、`/system/configs`、`/system/package-images`、`/system/logs`：系统管理
- `/profile`：个人中心

除 `/login` 与 `/browser-upgrade` 外，所有页面均在 `AuthGuard` 鉴权守卫之下，未登录自动跳转登录页。

## 后端接口

开发环境通过 Vite 代理将 `/api` 转发到 `http://localhost:8000`。接口规范见 `docs/api-spec.md` 与后端 Swagger（`/swagger/`）。

## 注意事项

- Axios 统一封装在 `src/api/request.ts`，处理 `{code, message, data}` 响应格式、JWT Header 注入与 401 自动刷新 token，新接口请放入 `src/api/<module>.ts` 并通过 `get/post/put/patch/del` 包装函数访问。
- 认证状态使用 `useAuthStore`，不要绕过 token 刷新机制直接创建新的 Axios 实例。
- `src/mock/` 已彻底清理，页面一律对接真实接口。
- `src/pages/TagGenerator/` 为未注册到路由的历史遗留页面，不要在路由或新代码中引用。
- 页面内状态和表单尽量局部化；跨页面状态再放入 Zustand。
- UI 偏管理后台风格：信息密度适中、可扫描、少装饰。
