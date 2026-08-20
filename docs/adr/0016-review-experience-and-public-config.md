# 0016 - 审查体验优化与系统配置公开读取通道

**状态:** accepted
**日期:** 2026-08-20
**决策者:** 产品/研发团队
**关联规格:** 用户需求：回溯列表默认正式版、待整改列表可见、审查员查看变更文档关键字高亮（纯前端）、正式版徽标去黑色（由 code review 门禁补录本 ADR）

## 背景

提交审查页的「已发布回溯」板块在使用中暴露几个体验问题：默认混示全部类型版本、有待整改意见的版本在列表不可见需逐个点进详情、审查员阅读变更文档时缺少关注点聚焦手段。同时 `sys_config.is_public` 字段自建表以来从未真正启用，缺少一条安全的公开配置读取通道。

## 决策

### 系统配置公开读取通道

1. 新增 `GET /api/system/configs/public/`，仅需登录（不要求 `system.config` 权限），返回 `{key: value}` 字典。
2. 仅返回 `is_public=True` 的配置；**敏感键（key 含 password/passwd/token/secret/api_key/credential，与前端 `isSensitiveKey` 口径一致）服务端强制排除**，即使被管理员误标为公开也不会泄露。
3. 首个使用该通道的配置：`review_doc_highlight_keywords`（审查关键字，换行/逗号分隔），由系统配置页「审查关键字高亮」卡片维护，保存时强制 `is_public=True`。

### 已发布回溯列表

1. 类型过滤默认值：已发布回溯为「正式」，审批中审查保持「全部」。
2. 发布列表 queryset 注解 `open_review_count`（open 状态整改意见计数，`Count + filter` 聚合，无 N+1），列表行/移动端卡片显示「待整改 n」徽标。
3. 已知取舍：板块 Tab 计数徽标仍统计全部已发布（不过滤类型），与列表默认过滤存在轻微不一致，暂接受。

### 变更文档关键字高亮

- 纯前端实现：`release.can_review`（`release.audit` 权限，呼应 ADR-0012 审查员口径）为真时才拉取公开配置，`DocRow` 各行用 `<mark>` 标黄命中关键字；React 节点渲染 + 正则转义，无 `dangerouslySetInnerHTML`，不改文档存储内容，非审查员无感知。

### 徽标配色

- `StatusTag` 新增 `indigo` 类型；发布版本列表正式版徽标由 `primary`（近黑）改为 indigo，与移动端配色一致。

## 影响与兼容性

- 公开配置接口为新增端点，不改变既有 `system.config` 权限模型的任何行为；敏感键排除为服务端强制，前端展示层脱敏逻辑不受影响。
- `ReleaseListSerializer` 新增只读字段 `open_review_count`，旧客户端忽略即可。
- 前端全部为增量改动；高亮失败（配置缺失/接口异常）静默退化为不高亮。
