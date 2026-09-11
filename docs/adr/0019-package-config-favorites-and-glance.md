# 0019 - 打包配置收藏与打包速览统计口径

**Status:** accepted
**Date:** 2026-08-28
**Spec:** 打包配置/任务增多后查找成本高；需「常用配置」收藏机制与工作台准确的打包统计口径；UI 设计稿 `docs/ui/desktop/package-favorites-design.html`（已经用户评审确认）
**Deciders:** 产品/研发团队

## Context

打包配置与任务数量增长后，用户在打包看板（/packages）的任务/配置列表里找到自己关心的内容耗时变长；工作台（/dashboard）的打包成功率等指标此前只按最近 20 条任务在前端统计，口径脆弱且与看板不一致。

既有约束：

- 不新增筛选增强方案（经用户决策，核心手段为收藏/常用配置）；
- 触发打包交互（选择发布版本/分支）已存在于看板，不能重复造；
- 移动端遵循 ADR-0014（仅追加前缀类适配，不动桌面样式）。

## Decision

1. **收藏模型**：新增 `PackageConfigFavorite`（`user` + `config` 唯一约束，级联删除），表名 `package_config_favorite`。收藏即个人入口授权：收藏列表不再按项目可见性二次过滤，配置删除则收藏级联消失。
2. **接口**：
   - `POST /api/packages/configs/{id}/favorite/` 切换收藏（toggle），返回 `{is_favorite}`；非项目成员因 queryset 过滤得到 404。
   - `GET /api/packages/configs/favorites/` 返回当前用户收藏配置（收藏时间倒序、不分页），每条附 `last_task` 最近任务摘要（Subquery 取最近一次任务，无 N+1）；`PackageConfigSerializer` 输出 `is_favorite`（列表经 `Exists` 注解）。
   - `GET /api/packages/tasks/stats/?days=30`：打包统计聚合，口径固定为「我发起的（triggered_by=本人）、近 N 天（默认 30，1-365）、仅终态（success/failure/canceled）」，超管也不放开；返回 total/各状态计数/success_rate/avg_duration_seconds。
   - `PackageTaskViewSet.search_fields` 追加 `config__name`、`triggered_by__nickname`。
3. **看板呈现**：不新增独立区块；接口默认按收藏优先排序（`ordering = ["-annotated_is_favorite", "-created_at"]`，显式 `?ordering=` 时用户排序优先），收藏开关为行尾操作区星标（乐观更新）。看板按物理仓库 ID 分组，避免同名仓库合并；分组后含收藏配置的仓库优先，组内收藏配置优先，其余顺序沿用接口返回顺序。曾实现过右侧「常用配置」侧栏，经用户试用评审后放弃（占位且割裂），改为列表内排序。
4. **工作台**：新增「打包速览」面板（命名规避「我的打包」）：chart.js doughnut 成功率环 + 状态计数（数据来自 stats 聚合，近 30 天口径）、我发起的最近 3 条任务、常用配置二级卡片（含项目/软件信息，按最近任务状态分派触发/重新打包/查看进度）。KPI「打包成功率」与原成功率图表同步切换到 stats 口径。
5. **触发交互复用**：看板内的触发打包逻辑（选发布/分支 + 弹窗）提升为共享组件 `PackageTriggerModal`，看板列表、常用侧栏、工作台速览三处共用。

## Consequences

- 新增迁移 `package.0023`（PackageConfigFavorite）。
- 工作台打包指标口径由「最近 20 条」变为「近 30 天我发起的终态任务」，与看板数据可对照；历史页面不受影响。
- 收藏为纯增量能力，无收藏用户界面不出现任何新元素（侧栏/网格不渲染）。
- 「常用」目前按用户收藏驱动，不做全局推荐；若未来需要管理员推荐位，可在 favorites 接口外层扩展，不改模型。
