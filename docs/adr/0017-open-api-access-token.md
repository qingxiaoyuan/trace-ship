# 0017 - 对外开放接口与 Access Token 鉴权机制

**状态:** accepted
**日期:** 2026-08-25
**决策者:** 产品/研发团队
**关联规格:** 用户需求：向外部系统开放只读查询接口（按 tag 查发布变更文档、两个 tag 间的 commits 与 MRs），调用前需鉴权（由 code review 门禁补录本 ADR）

## 背景

外部系统需要接入 Trace Ship 的数据（发布变更文档、tag 区间提交与 MR），属于服务端到服务端的机器调用。既有认证体系只有面向前端用户的 JWT（simplejwt，access 60 分钟），没有面向机器调用的认证方式；若直接开放接口不做鉴权，等于把内部研发数据暴露给任何能访问到该端口的人。

## 决策

### 鉴权机制：类 GitLab Access Token（单 token + scope）

1. 新增 `sys_access_token` 表（`apps/system/models.py` 的 `AccessToken`）：token 为 `tsat_` + 128 位随机串，**只存 SHA-256 哈希与前 8 位前缀，明文仅创建时返回一次**；支持启停（吊销）、过期时间、最近使用时间/IP 审计字段。
2. 认证类 `utils.authentication.AccessTokenAuthentication`：读 `Authorization: Bearer <token>`，**不挂全局认证链**，只显式用于开放接口视图，与 JWT 体系完全隔离；实现 `authenticate_header` 保证认证失败返回 401（DRF 默认会降级为 403）。
3. 授权类 `utils.permissions.HasAccessTokenScope`：视图声明 `open_scope`，校验 token 身份 + 只读方法 + scope 匹配，缺 `open_scope` 时默认拒绝（fail-closed）。scope 编码集中在 `OPEN_API_SCOPES` 常量登记，新增开放接口先登记 scope。
4. 令牌由超管在「系统 · 访问令牌」页面签发/禁用/删除，管理接口 `/api/system/access-tokens/` 仅超管；签发/更新/删除均写操作日志审计。

### 开放接口通道

- 统一挂 `/api/open/` 前缀（`config/urls_open.py`），与内部 `/api/` 区分；均为只读 GET。
- 首批接口：`GET /api/open/release-doc/`（scope `release.doc`，仅暴露 `status=released` 的发布）、`GET /api/open/compare/`（scope `repo.compare`，commits 走 GitLab compare，MRs 按合并时间区间过滤，tag 列表复用 `list_tags_cached` 短缓存）。

### 否决的备选方案

- **复用 JWT 专用账号**：调用方需实现登录 + token 刷新，且权限挂在用户体系上、无法按接入方独立吊销。
- **AppKey + AppSecret 双值（含 HMAC 签名）**：对当前只读、内网场景属过度设计；scope 模型保留升级空间，未来需要防重放/防篡改时可在认证类内扩展签名验证，token 体系不变。
- **sys_config 单 token**：无法按接入方区分、吊销和授权到具体接口。

## 影响与兼容性

- 全部为增量改动：`DEFAULT_AUTHENTICATION_CLASSES` 不变，既有接口行为不变。
- token 泄露时禁用对应记录即即时吊销，不影响其他接入方；传输层安全依赖 HTTPS/内网，可在 nginx 对 `/api/open/` 叠加来源 IP 白名单。
- 已知取舍：compare 接口的 MR 区间过滤以 tag 指向 commit 的提交时间近似 tag 时间点（GitLab 不提供 tag 创建时间），tag 打在历史 commit 上时区间偏宽，已在 `docs/api/open-api-access.md` 注明。
