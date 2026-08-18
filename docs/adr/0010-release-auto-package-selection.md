# 0010 - 发布创建时可勾选「发布后自动打包」配置

**状态:** proposed
**日期:** 2026-08-18
**决策者:** 产品/研发团队
**关联规格:** 无（需求来自发布时按需选择自动打包配置的使用场景）

## 背景

ADR-0002 确立「发布推 tag 成功后自动触发同仓库全部启用了『发布后自动打包』的打包配置」。
实际操作中，不同发布场景需要打包的产物组合不同（例如仅出部分平台产物、或本次发布不打包），
全量触发无法满足，需要让发布人创建发布时按需勾选。

## 决策

1. `ReleaseRecord` 新增 `package_config_ids`（JSON 字段，`default=None, blank=True, null=True`）：
   - `None`：未显式选择（历史数据 / 旧客户端），发布通过后触发该仓库全部启用的自动打包配置（兼容原行为）；
   - `[]`：用户明确不打包，发布通过后不触发任何打包任务；
   - `[id,...]`：仅触发这些配置（创建时快照固定）。
2. 创建发布接口（`POST /api/releases/`）接收 `package_config_ids`，序列化层用
   `ListField(child=UUIDField)` 校验；`ReleaseService.create_release` 宽容过滤：仅保留
   「属于该仓库且 `auto_package_on_release=True`」的 id，非法/不存在/停用的 id 忽略，不阻断创建。
3. 触发方 `PackageService.trigger_auto_packages_for_release` 读取 `release.package_config_ids`：
   为 `None` 时走全量逻辑；否则对勾选 id 再做 `repository` 匹配 + `is_active=True` +
   `auto_package_on_release=True` 过滤后逐个创建任务，被停用/删除的配置自动跳过、不报错。
4. 前端创建发布页：选择仓库后列出该仓库启用了自动打包的配置，逐条勾选（默认全选，
   可一键全选/全不选），未勾选任何配置时明确提示本次发布通过后不自动打包。
5. 勾选结果按创建时快照固定：之后新增/启用的自动打包配置不会自动加入本次发布，行为可预期、
   便于追溯；发布通过后实际产生的任务仍通过既有 `package_tasks` 关联展示。

## 影响与兼容性

- 历史已创建发布（`package_config_ids` 为 `NULL`）保持原「全部自动打包」行为，无感知迁移。
- 仅创建发布时选择一次，草稿阶段不可再改；快照固定避免发布进行中配置变更导致意外打包。
- 新增字段不涉及既有数据迁移，新增 `release.0009` 迁移仅为加列。
