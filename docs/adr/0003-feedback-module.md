# 0003 - 使用反馈模块

**Status:** accepted
**Date:** 2026-07-29
**Spec:** 用户需求：收集用户意见并能看到其他人提出的意见
**Deciders:** project maintainers

## Context

平台上线了「使用说明」页面后，需要一个配套的轻量反馈渠道，让用户可以提交功能建议、问题反馈与体验优化意见，并且所有用户都能看到彼此的意见，形成公开透明的产品改进池。

该能力不属于任何既有业务域（发布、打包、工作流等均无归属），也不涉及审批流转或权限隔离。

## Decision

新增独立应用 `apps.feedback`，遵循仓库既有 app 约定（UUID 主键、`StandardModelViewSet`、统一响应、中文注释）：

- `Feedback` 模型：标题、内容、分类（`suggestion` / `bug` / `experience` / `other`）、提交人、点赞用户 M2M。
- API 前缀 `/api/feedback/`：列表全员可见（登录即可），支持分类筛选、标题/内容搜索、按时间或点赞数排序。
- 点赞为切换式接口（`POST /feedback/{id}/like/`），不做防刷限制。
- 反馈不可编辑，删除仅限提交人本人或超管。
- 菜单项 `modules` 为空，所有登录用户可见，不纳入角色权限模块体系。

反馈不做状态流转（无"已采纳/已处理"等生命周期），仅作为意见收集与展示渠道；后续如需处理闭环，可在本模型上扩展状态字段而非新建模块。

## Consequences

- 新表 `feedback` 及点赞 M2M 中间表，需执行迁移。
- 侧边栏「概览」分组新增「使用反馈」入口；后端 `/api/account/menus/` 同步添加。
- 列表查询通过 `select_related` + `prefetch_related` + `Count` 聚合避免 N+1。
