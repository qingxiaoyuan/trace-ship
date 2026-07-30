# 0004 - LDAP 集成与动态配置

**Status:** accepted
**Date:** 2026-07-30
**Spec:** 用户需求：内网接入 LDAP 登录（含 ldaps/自签名证书），系统配置页可视化维护
**Deciders:** project maintainers

## Context

平台需要接入内网 LDAP（OpenLDAP/AD）登录。最初仅支持环境变量配置（`LDAP_SERVER_URI` 等，见 `config/settings/base.py`），存在三个问题：

- 环境变量方式改配置需重建容器，内网对接调试成本高；
- 内网 LDAP 多为自签名证书，原实现无 TLS 校验策略与 CA 证书配置入口，ldaps 无法接入；
- django-auth-ldap 建用户时用 `username__iexact` 查找并统一小写落库，业务侧若再按原始输入 `get_or_create` 会因大小写差异产生重复用户。

## Decision

### 动态配置（`apps.account.ldap_config`）

- LDAP 配置存 `sys_config` 表 `ldap_*` 键（enabled/server_uri/bind_dn/bind_password/user_search_base/user_filter/tls_reqcert/ca_cert），**页面配置优先、环境变量兜底**；页面显式 `ldap_enabled=false` 时环境变量也不生效。
- 登录时由 `authenticate_ldap()` 动态读取配置、覆盖 `settings.AUTH_LDAP_*` 后调用 `LDAPBackend`，保存即生效无需重启。python-ldap 惰性导入，未安装环境自动回退本地登录。
- 「系统配置」页提供 LDAP 集成卡片与 `POST /api/system/configs/ldap-test/` 连通性测试（服务可达 → 服务账号绑定 → 基准 DN 的 BASE 范围搜索，避免 SUBTREE 触发服务端 size limit）。

### ldaps 与自签名证书

- `tls_reqcert` 支持 demand/allow/never；CA 证书页面存 PEM 内容，登录时写入 `.runtime/ldap-ca.pem`（0600）后设置 `OPT_X_TLS_CACERTFILE`；环境变量路径为 `LDAP_TLS_REQCERT` / `LDAP_CA_CERT_PATH`。

### 用户同步

- 登录成功后直接使用 django-auth-ldap 落库的用户对象同步 `source`/`nickname`/`department`/`last_login`，**禁止再按原始输入 get_or_create**。
- 显示名支持 `<部门>姓名` 前缀解析（`parse_ldap_display_name`），部门与姓名分字段入库。
- LDAP 用户无任何角色时自动赋予 `developer` 角色（幂等）。
- 项目创建接口的权限由硬编码 `is_superuser` 改为 RBAC 权限码 `project.create`（`HasPermission`，超管默认放行），LDAP 用户在「角色管理」绑定含该权限码的角色后即可创建项目；权限拒绝时返回中文提示"没有执行该操作的权限，请联系管理员分配对应角色"，前端创建失败时直接展示后端 message。
- 菜单：`/system/package-images` 对 `system` 与 `package` 模块均可见（打包镜像列表接口本身仅需登录）；「系统管理」父级菜单改为按子项权限过滤。
- `deploy.sh --clear-ldap-users` 提供 LDAP 用户一键清理（含 Token 黑名单、角色关联，操作日志置空保留）。

## Consequences

- LDAP 对接信息由信息办提供后直接在「系统配置」页录入，无需改环境变量重启。
- 开发角色（package 模块）用户侧边栏可见「系统管理 → 打包镜像」。
- 登录过滤器默认 `(uid=%(user)s)`，AD 需在页面改为 `(sAMAccountName=%(user)s)`。
