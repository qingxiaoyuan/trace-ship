# 0022 - 前端可发现性：命令面板、聚合搜索与详情深链

**Status:** accepted
**Date:** 2026-09-18
**Spec:** `docs/design/frontend-ux-discoverability.md`
**Deciders:** 产品/研发团队

## Context

用户反馈功能入口难找、实体只能逐层翻列表、详情页之间缺少回链。顶栏搜索框曾是纯装饰；菜单名 / 侧边栏 / 页面标题三套口径并存；仓库详情 tab 与审批单详情不可 URL 寻址。设计文档已确认方向：命令面板 + 深链回链 + 导航治理 + 工作台枢纽化。

## Decision

1. **⌘K 命令面板**：Ant Design Modal 自绘，不引入 cmdk。内容为静态功能入口 / 快捷操作 + `GET /api/search/?q=` 实体搜索（每组最多 5 条）。按当前用户可见菜单过滤，避免「搜得到、进不去」。搜索失败静默降级为仅静态入口。移动端不写弹窗 `top` 定位，沿用 ADR-0014 全局贴底；入口放在 `MobileNavDrawer`。
2. **聚合搜索与待办计数**：`GET /api/search/` 登录即可用，可见范围与列表页一致；审批单额外包含「本人是审批人」的实例。`GET /api/workflow/todo-count/` 驱动侧边栏「审批中心」徽标，口径与「我的待办」相同（超管也不放开全量）。
3. **详情深链**：仓库详情 `/repositories/:id/:tab`（旧 `/repositories/:id` 绝对重定向到 `commits`）；审批单 `/workflows/:id`（兼容旧通知任务 ID）。通知 `related_type=workflow_instance` 直达实例。
4. **命名统一**：后端菜单名、侧边栏、页面标题采用侧边栏口径（打包看板 / 审批中心 / 项目/产品 等）。
5. **工作台**：不增加快捷入口/最近访问区；详情页仍记录访问供命令面板仓库深链使用。功能入口走侧边栏与 ⌘K。

## Consequences

- 命令面板与搜索是产品级入口，权限过滤必须与菜单/数据可见范围保持一致。
- 指定审批人即使不是项目成员，也必须能 retrieve 流程实例并打开深链。
- 仓库旧路径重定向必须使用绝对路径 `/repositories/:id/commits`，避免相对 `Navigate` 解析歧义。

## Alternatives Considered

- 引入 cmdk / 第三方命令面板：增加依赖，放弃。
- 通知继续只带任务 ID：旧通知兼容保留，新通知改为实例 ID 以便 URL 稳定；同时放宽实例可见范围覆盖审批人。
