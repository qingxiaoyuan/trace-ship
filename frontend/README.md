# TraceShip 前端

TraceShip - 软件版本发布管理与提交规范审查系统前端。

## 技术栈

- React 18 + TypeScript
- Vite 5
- Ant Design 5
- React Router 6
- Zustand（全局状态）
- TanStack Query（服务端状态）
- Axios（HTTP 请求）
- @logicflow/core + extension（流程设计器）
- @ant-design/charts（统计图表）

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 目录结构

```
src/
  api/          # 接口封装
  assets/       # 静态资源
  components/   # 通用组件
  hooks/        # React Query hooks
  layouts/      # 布局组件
  mock/         # Mock 数据
  pages/        # 页面组件
  router/       # 路由配置
  stores/       # Zustand 状态
  styles/       # 主题与全局样式
  types/        # TypeScript 类型
  utils/        # 工具函数
```

## 后端接口

对接 `docs/api-spec.md` 中的接口规范，开发环境通过 Vite 代理转发到 `http://localhost:8000`。
