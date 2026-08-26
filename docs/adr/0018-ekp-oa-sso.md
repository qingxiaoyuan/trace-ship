# 0018 - EKP OA 单点登录（token 验票）

**Status:** accepted
**Date:** 2026-08-25
**Spec:** 用户需求：接入内网 EKP OA 门户，实现免登录跳转进入并与 LDAP 账号体系统一
**Deciders:** project maintainers

## Context

内网各系统（如费控系统）通过 EKP OA 提供的中间件实现单点登录：OA 门户点击目标系统 → 中间件签发一次性 token → OA 重定向浏览器到目标系统（URL 带 token）→ 目标系统回中间件验票换取用户身份 → 完成登录。

Trace Ship 已有 LDAP 登录（见 0004），域账号体系一致，缺的是 SSO 入口。验票接口契约为 OA 中间件提供：

- 请求：`POST <verify_url>`，Body `{"token": "sso_xxx"}`；
- 成功：`code=0`、`data.result=100`、`data.userDetail={userId,userName,email,department}`（userId 即域账号/工号，与 LDAP uid 一致）；
- 失败：`code=-1`，`data.result=101`（token 不存在或已使用）/ `102`（token 已过期）；
- verify_url 按系统注册入口分配（如费控为 `/api/v1/sso/fecontrol/verify-token`），各系统不同。

风险点：SSO 链路没有密码校验环节，若按用户名直接接管已有账号会引入账号接管风险；OA 返回的 email/department 常为空，需要补齐用户资料。

## Decision

### 后端（`apps.account.sso` + `AuthViewSet.sso_login`）

- 新增 `POST /api/auth/sso/login`（AllowAny）：收 token → 回 OA 验票 → 按域账号自动开通/更新用户 → 颁发 JWT，响应格式与普通登录完全一致。
- 验票配置存 `sys_config` 表 `sso_*` 键（enabled/verify_url），**页面配置优先、环境变量 `SSO_VERIFY_URL` 兜底**（与 0004 LDAP 配置同一模式，保存即生效）。
- 验票请求 `timeout=5` 且 `allow_redirects=False`（验票地址误配成 302 时避免一次性 token 泄露给重定向目标）；101/102 的 OA 错误信息透传给前端展示。
- 用户开通语义与 0004 LDAP 登录一致：`username__iexact` 查重、小写落库、无任何角色时默认赋 `developer` 角色、`source="ldap"`。
- **本地账号保护**：iexact 命中的用户 `source="local"` 时拒绝 SSO（返回"该账号为本地账号，请使用账号密码登录"）并写 `sso_login_rejected` 操作日志，避免无密码环节下的账号接管；停用账号校验前置到写库之前。
- **LDAP 资料回填**：新增 `ldap_config.search_ldap_user`（服务账号绑定 + `user_filter` 搜索 cn/mail，过滤器输入经 `ldap.filter.escape_filter_chars` 转义），资料优先级：LDAP 回填 > OA 验票返回 > username 兜底；LDAP 未配置/查询失败时降级，不阻断 SSO。

### 前端

- 新增公开路由 `/sso?token=xxx`（AuthGuard 之外）：取出一次性 token 调 `ssoLogin`（authStore 新增 action，与 `login` 同流程），成功跳 `/dashboard`，失败展示 OA 透传原因并引导去登录页；ref 防 StrictMode 重复验票（token 一次性）。
- `request.ts` 的 `isAuthRequest` 纳入 `/auth/sso/`，避免验票 401 误触发 token 刷新流程。
- 「系统配置」页新增「OA 单点登录（EKP）」卡片维护 `sso_*` 键，并展示给 OA 管理员的门户跳转入口 URL（`{origin}{BASE_URL}sso?token={token}`）。

### 对接边界

- Trace Ship 只消费 OA 一个接口（verify-token）；token 签发与门户跳转由 OA 侧完成。OA 管理员需为本系统注册入口提供专属 verify_url，并配置门户跳转地址。

## Consequences

- 内网用户从 OA 门户点击即可免登录进入，首次进入自动建号（域账号小写落库、developer 角色），与 LDAP 登录产出同一用户，权限/项目成员关系完全复用。
- 本地账号与 SSO 域账号同名时不会被静默接管，需管理员显式处理（改用户名或换绑定方式）。
- token 出现在 URL query（浏览器历史/网关日志），凭一次性 + 短时效控制风险；验票地址生产环境建议 https。
- 开发环境未装 python-ldap 时 SSO 正常可用，仅资料回填降级为 OA 返回值。
