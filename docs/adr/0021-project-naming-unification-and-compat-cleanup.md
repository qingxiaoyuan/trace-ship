# 0021 - 结束兼容期：代码统一 project 口径，删除兼容字段

**Status:** accepted
**Date:** 2026-09-17
**Supersedes:** ADR-0020 中的兼容期安排（其「现有 Project 即产品」「版本属于仓库」等核心决策不变）
**Deciders:** 产品/研发团队

## Context

ADR-0020 完成产品-仓库组合改造后，系统进入兼容期：`Repository.project` 保留为历史登记字段，`PackageConfig` 保留 `project`/`repository` 冗余字段，可见性查询走「组件关联 + 旧字段」双路径，代码中 product/project 两种口径混用（233 处 vs 1745 处）。

兼容期长期存在带来真实成本：双路径查询复杂且语义含糊（旧路径不看组件启停状态）、冗余字段迫使序列化器写一致性校验、命名混用持续误导新代码。生产环境已稳定运行组合架构，具备结束兼容期的条件。

曾评估「全量改名为 product」：涉及约 2100 处改动、表 rename、权限编码数据迁移与迁移历史改写，风险与收益不成比例，放弃。

## Decision

1. **代码层统一使用 project 命名**（类名、字段、参数、API、前端类型），`ProductComponent` 改名 `ProjectComponent`（表名 `project_component` 不变，标准 `RenameModel` 迁移）。UI 主入口（菜单/路由/页面标题）显示「项目/产品」，正文统一「项目」。
2. **删除 `Repository.project` 历史登记字段**，仓库归属与可见性查询只走 `ProjectComponent` 单路径。语义收紧：停用组件立即切断该项目成员对仓库的可见性（创建者除外）——经确认为预期行为，「停用即不再使用」。
3. **删除 `PackageConfig.project` / `PackageConfig.repository` 冗余字段**，归属以 `project_component` 为唯一事实源；迁移前用 RunPython 逐条比对旧字段与组件归属，不一致即中止迁移。API 响应字段 `project_id/project_name/repository_id/repository_name` 保持不变（由组件推导）。`PackageTask.project`/`repository` 保留（任务历史快照，config 为 SET_NULL）。
4. **API 硬切换**：内部接口字段/参数改名不保留旧别名（前后端同版部署）；对外开放接口 `/api/open/compare/` 保留旧参数 `product_id` 兼容。
5. **提交归属为空的权限回退**：`CommitRecord.project` 可空（同步时仓库无启用组件），权限解析（`utils/permissions._resolve_project`）回退到「仓库当前启用组件 → 项目」，与同步归属口径一致，避免窗口期内提交无人能复核。

## Consequences

- 仓库登记的项目上下文改为 API 序列化器 write-only 字段（创建时补组件关联并复制版本规则），`Repository.save` 不再承担旧字段同步逻辑。
- `version_scope` 的存量枚举值 `"product_component"` 保留不改（避免数据迁移），仅展示文案变化。
- 管理命令名 `check_product_repository_consistency` / `merge_duplicate_repositories` 保留原名，保持运维文档与脚本可用。
- 历史迁移 `project/0005` 增加防御性列存在性检查（对已部署库零行为变化，仅为测试直调兼容）。
- 前端类型与后端契约逐字段对齐：PackageConfig 响应不再有裸 `project`/`repository` 字段，仅有 `*_id`/`*_name`。

## Alternatives Considered

- 全量改名 product（含表名、权限编码、app label）：改动约 7 倍且需迁移历史手术，风险收益不成比例，放弃。
- 保留双路径查询 indefinitely：语义含糊且持续产生一致性校验负担，放弃。
- `loans/available` 等内部接口保留旧参数别名：前后端同版部署无必要，选择硬切换保持代码干净。
