# 0005 - Tag 格式规范与扫描入库

**Status:** accepted
**Date:** 2026-07-30
**Spec:** 用户需求：tag 扫描规则改为 前缀.主版本.次版本.修订版本_日期，同步分支时扫 tag 入库
**Deciders:** project maintainers

## Context

原 tag 格式为 `{prefix}.{major}.{minor}.{patch}(-{suffix})`，无日期段，且仓库分支同步只落库分支，tag 仅在版本计算时实时从远端拉取，缺少本地可查的 tag 台账；GitLab 分支/tag 列表接口单页 100 条的截断也会导致同步与计算遗漏。

## Decision

### Tag 格式（全链路切换）

- 新格式：`{prefix}.{major}.{minor}.{patch}(-{suffix})?_{YYYYMMDD}`，如 `VB.1.1.1_20251014`、`VA.1.1.2-rc_20260816`。
- 前缀仅在 `version_rule.prefix` 配置时出现且强制匹配；后缀限定为规则配置的 rc/beta 值；日期段为强制组成部分且必须是合法年月日。
- `VersionCalculator` 仅按新格式匹配历史 tag 递增修订号，生成的 tag 自动拼当天日期；`ReleaseValidator.strip_suffix` 剥掉日期段与后缀反推纯版本号，`ensure_tag_date` 为手动输入的 tag 补齐日期段；旧无前缀/无日期格式不再参与版本计算。
- 发布创建与草稿编辑手动传 version/tag_name 时统一补后缀与日期段，查重按最终 tag 名。

### Tag 扫描入库

- 新增 `RepositoryTag` 表（`repo_tag`）：name、commit_hash、正则解析出的 major/minor/patch/suffix/tag_date、远端创建时间，按 `(repository, name)` 唯一。
- `sync_branches` 末尾复用同一 provider 调 `sync_tags`：仅扫描正则匹配且日期合法的 tag 入库，远端删除或不再匹配的本地 tag 同步清除；返回 `tag_synced_count` / `tag_total`。
- GitLab `list_branches` / `list_tags` 均按 `X-Next-Page` 翻页，去掉单页 100 条截断。

### 分支同步 stale 过滤

- GitLab UI 的 stale 口径（最近 3 个月无提交）在 REST API 无对应过滤参数，由后端按同口径（`STALE_BRANCH_DAYS = 90`）在同步时过滤，默认分支豁免。

## Consequences

- 历史无日期段 tag 不再参与版本计算；如存在旧 tag，下次计算的版本号可能与人工预期不一致，需要以新格式推一次 tag 对齐。
- 分支同步接口耗时增加一次 tag 列表拉取；返回值新增 tag 统计字段，前端无感知。
- `RepositoryTag` 目前仅供同步落库与后续查询展示，版本计算仍以远端实时列表为准。
