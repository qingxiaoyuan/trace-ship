# 后端接口文档（V1.0）

> 本文档以后端当前代码（`backend/config/urls.py` 及各 app 的 `urls.py` / `views.py` / `serializers.py`）为准整理，供前端联调使用。接口在线文档以后端部署后的 `/swagger/` 为准。

---

## 一、通用约定

### 1.1 基础信息

| 项 | 说明 |
|---|---|
| 协议 | HTTPS（开发环境可 HTTP） |
| Base URL | 开发环境 `http://localhost:8000` |
| 内容类型 | `application/json`（镜像导入为大文件上传 `multipart/form-data`） |
| 认证方式 | JWT Bearer Token |
| 时区 | Asia/Shanghai（返回 ISO 8601 格式） |

### 1.2 统一响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

### 1.3 通用状态码

| code | 含义 |
|------|------|
| 0 | 成功 |
| 40000 | 请求错误（通用） |
| 40001 | 参数错误 |
| 40002 | 业务校验失败 |
| 40003 | 业务规则禁止（如内置流程不可新增/删除、tag 已存在） |
| 40100 | 未登录、登录失败或 Token 失效 |
| 40300 | 无权限 |
| 40301 | 无权限（细粒度，如非本人操作） |
| 40400 | 资源不存在 |
| 40401 | 关联资源不存在（如流程定义、目标用户） |
| 40900 | 资源冲突（如凭证被引用不可删除） |
| 50000 | 服务器内部错误 |
| 50001 | 外部系统调用失败 |
| 50200 | 外部服务（GitLab / SVN / Nexus）网关错误 |

### 1.4 通用分页参数

列表接口默认支持：

| 参数 | 类型 | 说明 |
|------|------|------|
| page | int | 页码，默认 1 |
| page_size | int | 每页条数，默认 20，最大 100 |
| ordering | string | 排序字段，如 `-created_at`（各接口支持的字段不同） |

分页响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 100,
    "page": 1,
    "page_size": 20,
    "results": []
  }
}
```

### 1.5 根路由一览

| 前缀 | 模块 |
|------|------|
| `/api/auth/` | 登录认证（apps/account） |
| `/api/account/` | 用户/角色/权限管理（apps/account） |
| `/api/projects/` | 项目与项目成员（apps/project） |
| `/api/repositories/` | 仓库（apps/repository） |
| `/api/commits/` | 提交记录审查（apps/repository） |
| `/api/releases/` | 发布与看板（apps/release） |
| `/api/packages/` | 打包镜像/配置/任务（apps/package） |
| `/api/credentials/` | 凭证（apps/credential） |
| `/api/system/` | 系统参数与操作日志（apps/system） |
| `/api/workflow/` | 审批工作流（apps/workflow） |
| `/api/notifications/` | 站内通知（apps/notification） |
| `/api/feedback/` | 使用反馈（apps/feedback） |
| `/health/` | 健康检查（无需认证，检查 DB 与 Redis） |
| `/api/schema/`、`/swagger/`、`/redoc/` | OpenAPI 文档 |

> Jenkins 相关接口（原 `/api/jenkins/*`）已整体下线，无替代路由；打包统一走 `/api/packages/`。

---

## 二、认证接口

### 2.1 登录

- **POST** `/api/auth/login/`
- 无需认证。先尝试 LDAP 认证（「系统配置」页面 `ldap_*` 键优先，环境变量兜底），失败后再尝试本地账号；LDAP 首次登录自动建用户并默认赋予「开发人员」角色。

**请求体：**

```json
{
  "username": "zhangsan",
  "password": "******"
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "user_id": "uuid",
    "username": "zhangsan",
    "nickname": "张三",
    "access_token": "eyJhbGciOiJIUzI1NiIs...",
    "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
    "expires_in": 3600
  }
}
```

登录失败返回 `code=40100`（用户名或密码错误 / 账号已停用）。

### 2.2 刷新 Token

- **POST** `/api/auth/token/refresh/`
- 无需认证。Refresh Token 采用轮换策略（`ROTATE_REFRESH_TOKENS`），刷新成功后旧 Refresh Token 进入黑名单。

**请求体：**

```json
{
  "refresh": "eyJhbGciOiJIUzI1NiIs..."
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "access": "eyJhbGciOiJIUzI1NiIs...",
    "refresh": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

### 2.3 登出

- **POST** `/api/auth/logout/`

**请求头：** `Authorization: Bearer {access_token}`

**请求体（可选）：**

```json
{
  "refresh": "eyJhbGciOiJIUzI1NiIs..."
}
```

将传入的 Refresh Token 加入黑名单，统一返回成功。

### 2.4 当前用户信息

- **GET** `/api/auth/user-info/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "uuid",
    "username": "zhangsan",
    "nickname": "张三",
    "email": "zhangsan@example.com",
    "department": "研发部",
    "source": "ldap",
    "roles": ["developer"],
    "is_superuser": false
  }
}
```

`source` 取值：`local` / `ldap`；`roles` 为角色编码列表。

### 2.5 当前用户菜单

- **GET** `/api/auth/menus/`

按用户角色拥有的权限模块动态过滤；超管返回全部菜单。

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": "projects",
      "name": "项目管理",
      "path": "/projects",
      "icon": "FolderOutlined",
      "children": []
    }
  ]
}
```

---

## 三、用户与角色接口

### 3.1 用户列表

- **GET** `/api/account/users/`

人员查询全员可用：超管返回完整字段；普通用户返回精简字段（`id` / `username` / `nickname` / `department` / `is_active`）。

**响应（超管视角）：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 10,
    "page": 1,
    "page_size": 20,
    "results": [
      {
        "id": "uuid",
        "username": "zhangsan",
        "nickname": "张三",
        "email": "zhangsan@example.com",
        "phone": "13800138000",
        "source": "ldap",
        "ldap_dn": "",
        "department": "研发部",
        "is_active": true,
        "is_superuser": false,
        "roles": [{"id": "uuid", "name": "开发人员", "code": "developer"}],
        "last_login": "2026-06-22T10:00:00+08:00",
        "created_at": "2026-06-01T10:00:00+08:00",
        "updated_at": "2026-06-01T10:00:00+08:00"
      }
    ]
  }
}
```

### 3.2 创建用户（本地应急账号）

- **POST** `/api/account/users/`
- 仅超管。

**请求体：**

```json
{
  "username": "admin_local",
  "password": "******",
  "nickname": "本地管理员",
  "email": "admin@example.com",
  "phone": "13800138000",
  "department": "运维部",
  "role_ids": ["uuid"],
  "is_active": true,
  "is_superuser": false
}
```

`password` 创建时必填；`role_ids` 可选。

### 3.3 更新用户

- **PUT / PATCH** `/api/account/users/{id}/`
- 超管可更新任意用户；普通用户仅可修改自己（且静默忽略 `is_superuser` / `is_active` / `role_ids` / `source` / `username`）。
- 更新时 `password` 可选（传入则重置密码）；LDAP 账号的 `username` / `password` 会被静默忽略。

### 3.4 删除用户

- **DELETE** `/api/account/users/{id}/`
- 仅超管。

### 3.5 角色列表与维护

- **GET / POST** `/api/account/roles/`
- **GET / PUT / PATCH / DELETE** `/api/account/roles/{id}/`
- 仅超管。

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 5,
    "page": 1,
    "page_size": 20,
    "results": [
      {
        "id": "uuid",
        "name": "开发人员",
        "code": "developer",
        "description": "",
        "permissions": [{"id": "uuid", "name": "查看项目", "code": "project.view", "module": "project"}],
        "created_at": "2026-06-01T10:00:00+08:00"
      }
    ]
  }
}
```

写入时通过 `permission_ids`（UUID 列表）重新绑定权限。内置角色：`super_admin` / `developer` / `tester` / `auditor` / `viewer`。

### 3.6 权限列表

- **GET** `/api/account/permissions/`
- 仅超管，只读。

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 17,
    "page": 1,
    "page_size": 20,
    "results": [
      {
        "id": "uuid",
        "name": "查看项目",
        "code": "project.view",
        "module": "project",
        "description": "",
        "created_at": "2026-06-01T10:00:00+08:00"
      }
    ]
  }
}
```

> 管理员密码重置不提供 HTTP 接口，使用管理命令 `python manage.py reset_admin_password`（默认恢复为 `admin@123`）。

---

## 四、项目管理接口

### 4.1 项目列表

- **GET** `/api/projects/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| search | string | 编码/名称模糊搜索 |
| status | int | 1 启用 / 0 停用 |

**响应：** 分页列表，含 `repo_count` / `member_count`；`my_role` 为当前用户在项目中的有效角色（超管与项目负责人为 `manager`，软件管理员成员为 `software_admin`，非成员为 `null`），供前端按角色过滤项目下拉（如打包配置归属项目）。

### 4.2 创建项目

- **POST** `/api/projects/`
- 需 `project.create` 权限（超管默认放行）。创建后自动：生成项目编码（未传时）、创建者设为项目管理员、预置 formal/rc/beta 三条发布审批流程定义。

**请求体：**

```json
{
  "code": "TRACE_SHIP",
  "name": "版本发布管理系统",
  "leader_id": "uuid",
  "description": "项目描述",
  "version_rule": {
    "format": "VA.{major}.{minor}.{patch}",
    "initial": "VA.1.0.0"
  },
  "release_rule": {
    "test_prefix": "test",
    "release_cycle_days": 3
  },
  "status": 1
}
```

`status` 支持数字 `1/0` 或字符串 `"active"/"inactive"`。

### 4.3 项目详情

- **GET** `/api/projects/{id}/`

详情附带 `repo_count` / `member_count` / `package_count` / `release_count`。

### 4.4 更新项目

- **PUT / PATCH** `/api/projects/{id}/`
- 仅项目管理员；`code` 创建后不可修改（更新时自动忽略）。

### 4.5 删除项目

- **DELETE** `/api/projects/{id}/`
- 仅项目管理员。

### 4.6 项目统计

- **GET** `/api/projects/stats/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 10,
    "active_count": 8,
    "repo_total": 20,
    "member_total": 35
  }
}
```

### 4.7 项目成员列表

- **GET** `/api/projects/{id}/members/`
- 仅项目管理员。

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 5,
    "page": 1,
    "page_size": 20,
    "results": [
      {
        "id": "uuid",
        "user": {
          "id": "uuid",
          "username": "zhangsan",
          "nickname": "张三"
        },
        "role": "developer",
        "created_at": "2026-06-01T10:00:00+08:00"
      }
    ]
  }
}
```

### 4.8 添加项目成员

- **POST** `/api/projects/{id}/members/`
- 仅项目管理员。

**请求体：**

```json
{
  "user_id": "uuid",
  "role": "developer"
}
```

角色可选：`developer`/`tester`/`manager`/`auditor`/`viewer`。

### 4.9 更新 / 移除项目成员

- **PUT / PATCH / DELETE** `/api/projects/{id}/members/{mid}/`
- 仅项目管理员；PUT/PATCH 用于调整成员角色。

> 说明：旧版「项目外站绑定」（`/api/projects/{id}/integrations/`）已废弃。当前仓库直接归属项目并各自绑定凭证，见第六章。

---

## 五、凭证管理接口

凭证可见性：统一为个人凭证（仅归属人与超管可见可用）；SVN 凭证（`svn_password`）全系统共享，所有登录用户可见可用。

### 5.1 凭证列表

- **GET** `/api/credentials/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| search | string | 名称/用户名模糊搜索 |
| cred_type | string | gitlab_token/svn_password/ldap_password/ai_api_key |
| is_active | bool | 是否启用 |

**响应：** 分页列表，凭证内容脱敏

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 10,
    "page": 1,
    "page_size": 20,
    "results": [
      {
        "id": "uuid",
        "name": "XX项目GitLab管理员",
        "cred_type": "gitlab_token",
        "auth_mode": "token",
        "username": "gitlab-admin",
        "masked_data": "glpa****abcd",
        "expires_at": "2027-06-01T10:00:00+08:00",
        "owner": "uuid",
        "owner_name": "张三",
        "is_system_shared": false,
        "is_active": true,
        "last_used_at": "2026-06-22T10:00:00+08:00",
        "created_at": "2026-06-01T10:00:00+08:00"
      }
    ]
  }
}
```

### 5.2 创建凭证

- **POST** `/api/credentials/`

**请求体：**

```json
{
  "name": "XX项目GitLab管理员",
  "cred_type": "gitlab_token",
  "auth_mode": "token",
  "data": {
    "token": "glpat-xxxxxxxx"
  },
  "username": "gitlab-admin",
  "expires_at": "2027-06-01T10:00:00+08:00",
  "is_active": true
}
```

约束：`gitlab_token` 必须使用 `token` 模式；`svn_password` / `ldap_password` 必须使用 `password` 模式（`data` 形如 `{"username": "u", "password": "p"}`）。归属人自动设为当前用户。

### 5.3 更新 / 删除凭证

- **PUT / PATCH** `/api/credentials/{id}/`：传入 `data` 则重新加密敏感数据。
- **DELETE** `/api/credentials/{id}/`：删除前校验是否被仓库等引用，被引用时返回 `code=40900`。

### 5.4 测试凭证有效性

- **POST** `/api/credentials/{id}/test/`

当前为简化实现（仅校验格式，不调用外部系统）：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "valid": true,
    "detail": "凭证格式有效（当前为简化实现）",
    "cred_type": "gitlab_token"
  }
}
```

### 5.5 凭证使用记录

- **GET** `/api/credentials/{id}/usage/`

从操作日志中查询该凭证的使用记录（module=凭证管理、action=使用凭证），分页返回操作日志结构。

### 5.6 支持的凭证类型

- **GET** `/api/credentials/types/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "cred_types": [
      {"value": "gitlab_token", "label": "GitLab Token"},
      {"value": "svn_password", "label": "SVN 密码（系统共享）"},
      {"value": "ldap_password", "label": "LDAP 密码"},
      {"value": "ai_api_key", "label": "AI API Key"}
    ],
    "auth_modes": [
      {"value": "token", "label": "Token"},
      {"value": "password", "label": "用户名密码"}
    ],
    "system_shared_cred_types": ["svn_password"]
  }
}
```

---

## 六、仓库管理接口

代码仓库仅支持 Git（GitLab）；SVN 仅作为打包产物推送目标（见第九章打包接口）。

### 6.1 仓库列表

- **GET** `/api/repositories/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| project | string | 项目 ID |
| repo_type | string | git |
| vendor | string | gitlab |
| health_status | string | healthy/unhealthy/unknown |
| credential | string | 凭证 ID |
| search | string | 名称/地址/外部标识模糊搜索 |

### 6.2 创建仓库

- **POST** `/api/repositories/`
- 仅项目管理员。

**请求体：**

```json
{
  "project": "uuid",
  "repo_type": "git",
  "vendor": "gitlab",
  "name": "后端代码仓库",
  "url": "https://gitlab.example.com",
  "external_identity": "group/project",
  "default_branch": "develop",
  "credential": "uuid",
  "credential_mode": "project"
}
```

说明：
- `credential` 必填，且只能绑定本人凭证或系统共享（SVN）凭证；凭证类型须与平台匹配（gitlab → `gitlab_token`）。
- `url` 支持直接粘贴克隆地址，后端自动解析为服务器根地址 + `external_identity`（`owner/repo`）。
- `credential_mode` 取值 `personal` / `project`，默认 `project`。

### 6.3 更新 / 删除仓库

- **PUT / PATCH / DELETE** `/api/repositories/{id}/`
- 仅项目管理员。

### 6.4 仓库连通性测试

- **POST** `/api/repositories/{id}/test/`
- 需项目开发人员权限。

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "connected": true,
    "detail": "连接成功"
  }
}
```

### 6.5 分支列表

- **GET** `/api/repositories/{id}/branches/`

优先读本地落库数据；本地无数据时自动从远端同步一次。

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "name": "main",
      "is_default": true,
      "last_commit_hash": "abc123",
      "last_commit_author": "张三",
      "last_commit_message": "...",
      "last_commit_at": "2026-06-20T10:00:00+08:00"
    }
  ]
}
```

### 6.6 同步分支

- **POST** `/api/repositories/{id}/sync-branches/`
- 需项目开发人员权限；仅 Git 仓库支持。从远端拉取全部分支落库，远端已删除的分支会从本地移除；同时扫描符合版本规则的 tag 入库。

**响应：**

```json
{
  "code": 0,
  "message": "分支同步成功",
  "data": {"synced_count": 5, "total": 5, "tag_synced_count": 12, "tag_total": 30}
}
```

### 6.7 Tag 列表

- **GET** `/api/repositories/{id}/tags/`

从远端实时获取仓库 tag 列表（仅 Git 仓库支持，SVN 仓库返回空列表）：

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {"name": "VA.4.1.154_20260601", "commit_hash": "abc123", "created_at": "2026-06-01T10:00:00+08:00"}
  ]
}
```

### 6.8 提交记录列表（仓库维度）

- **GET** `/api/repositories/{id}/commits/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| branch | string | 分支名 |
| review_status | string | unreviewed/pass/warning/illegal |

**响应：** 分页列表，单条结构见第七章 7.1。

### 6.9 同步提交记录

- **POST** `/api/repositories/{id}/sync-commits/`
- 需项目开发人员权限。

**请求体：**

```json
{
  "branch": "develop"
}
```

`branch` 可选，默认仓库默认分支。

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {"synced_count": 25, "illegal_count": 2}
}
```

### 6.10 下一版本号计算

- **GET** `/api/repositories/{id}/next-version/?release_type=formal`

`release_type` 取值 `formal` / `rc` / `beta`。基于仓库现有 Tag 与项目 `version_rule` 计算。

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "latest_tag": "VA.4.1.154",
    "next_version": "VA.4.1.155",
    "next_tag_name": "VA.4.1.155_20260731",
    "has_existing_tags": true,
    "all_types": {
      "formal": {"latest_tag": "...", "next_version": "...", "next_tag_name": "..."},
      "rc": {"latest_tag": "...", "next_version": "...", "next_tag_name": "..."},
      "beta": {"latest_tag": "...", "next_version": "...", "next_tag_name": "..."}
    }
  }
}
```

### 6.11 变更预览

- **GET** `/api/repositories/{id}/changes-preview/?branch=develop&release_type=formal`

预览上个 Tag 到目标分支之间的 commits 与 MRs，并解析 A/F 类更新内容（不落库），供创建发布表单使用。`branch` 必填；`release_type` 可选（`formal` / `rc` / `beta`，默认 `formal`），用于按发布类型分别取对应类型的最新 tag 作为基线：formal 取最新正式 tag，rc/beta 取各自 `-rc` / `-beta` 后缀的最新 tag。

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "last_tag": "VA.4.1.154_20260601",
    "head_hash": "abc123",
    "commits": [
      {"hash": "abc123", "author": "张三", "message": "...", "committed_at": "2026-06-20T10:00:00+08:00", "has_af": true}
    ],
    "merge_requests": [
      {"number": "!42", "title": "...", "description": "...", "author": "张三", "source_branch": "feature/x", "target_branch": "develop", "web_url": "https://...", "merged_at": "2026-06-20T10:00:00+08:00", "has_af": true}
    ],
    "parsed_updates": [
      {"type": "A", "content": "...", "source": "commit", "source_ref": "abc123"}
    ]
  }
}
```

### 6.12 Tag 区间合规审查

- **GET** `/api/repositories/{id}/review-range/?tag=latest`

按 Tag 区间拉取 commits 与 MRs 并做合规审查（不落库）。`tag` 指定 Tag 名称时审查该 Tag 与上一 Tag 之间的提交；为空或 `latest` 时审查最新 Tag 到分支 HEAD 之间的提交。

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "base": "VA.4.1.154_20260601",
    "head": "develop",
    "tags": [{"name": "VA.4.1.154_20260601", "created_at": "2026-06-01T10:00:00+08:00"}],
    "commits": [
      {"hash": "abc123", "author": "张三", "author_email": "zs@example.com", "message": "...", "committed_at": "2026-06-20T10:00:00+08:00", "review_status": "pass", "review_reason": "", "parsed_result": {}}
    ],
    "merge_requests": [],
    "stats": {"total": 10, "pass": 8, "warning": 2, "mr_total": 3}
  }
}
```

> `stats.warning` 已将 `illegal` 归入警告统计；commit / MR 条目内仍保留原始 `review_status`。

### 6.13 仓库统计

- **GET** `/api/repositories/stats/`

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 20,
    "healthy_count": 18,
    "git_count": 20,
    "svn_count": 0
  }
}
```

### 6.14 合规统计（按仓库聚合）

- **GET** `/api/repositories/compliance-stats/`

按仓库聚合提交审查结果计数，用于「仓库合规扫描」列表。

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": "uuid",
      "name": "后端代码仓库",
      "project_id": "uuid",
      "project_name": "版本发布管理系统",
      "repo_type": "git",
      "vendor": "gitlab",
      "default_branch": "develop",
      "health_status": "healthy",
      "last_sync_at": "2026-06-22T10:00:00+08:00",
      "commit_total": 50,
      "pass_count": 45,
      "warning_count": 3,
      "illegal_count": 2,
      "unreviewed_count": 0
    }
  ]
}
```

### 6.15 支持的平台类型

- **GET** `/api/repositories/vendors/`

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {"value": "gitlab", "label": "GitLab"}
  ]
}
```

---

## 七、提交审查接口

### 7.1 Commit 列表（全局）

- **GET** `/api/commits/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| project | string | 项目 ID |
| repository | string | 仓库 ID |
| branch | string | 分支 |
| review_status | string | unreviewed/pass/warning/illegal |
| author | string | 提交人 |
| search | string | 提交信息/哈希模糊搜索 |

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 50,
    "page": 1,
    "page_size": 20,
    "results": [
      {
        "id": "uuid",
        "project": "uuid",
        "project_name": "版本发布管理系统",
        "repository": "uuid",
        "repository_name": "后端代码仓库",
        "commit_hash": "271b688781e11ce76090b0ff1d281ec8d1dcd991",
        "author": "张三",
        "author_email": "zhangsan@example.com",
        "message": "变更类型：...",
        "committed_at": "2026-06-20T10:00:00+08:00",
        "branch": "develop",
        "change_type": "A/F类",
        "parsed_result": {
          "updates": [
            {"type": "A", "content": "移除干扰用户绑定数据采集(DA)的逻辑"},
            {"type": "F", "content": "信号定时开关新增清除指令并优化控制逻辑"}
          ]
        },
        "review_status": "pass",
        "review_reason": "",
        "created_at": "2026-06-20T10:00:00+08:00"
      }
    ]
  }
}
```

### 7.2 Commit 详情

- **GET** `/api/commits/{id}/`

### 7.3 人工复核 Commit

- **POST** `/api/commits/{id}/review/`
- 需项目测试人员权限。

**请求体：**

```json
{
  "review_status": "illegal",
  "reason": "缺少变更类型标记"
}
```

`review_status` 取值 `pass` / `warning` / `illegal`。

> 旧版「AI 审查建议」接口（`/api/commits/{id}/ai-review/`）后端未实现，已移除；AI 提交信息生成由 VS Code 插件直接调用 AI 服务，不经过本后端。

---

## 八、发布管理接口

发布状态机：`draft`（草稿）→ `pending`（待审批）→ `released`（已发布）/ `rejected`（已驳回）。审批通过自动推 tag，推 tag 成功置 `released`，失败置 `rejected` 并写入 `rejected_reason`；回退到初始节点可恢复为 `draft`。旧版 `building` / `auditing` 状态已废弃。

发布类型：`formal`（正式）/ `rc`（候选）/ `beta`（测试）。

### 8.1 发布记录列表

- **GET** `/api/releases/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| project | string | 项目 ID |
| repository | string | 仓库 ID |
| release_type | string | formal/rc/beta |
| status | string | draft/pending/released/rejected |
| publisher | string | 发布人 ID |
| version__icontains | string | 版本号模糊匹配 |
| created_at__gte / created_at__lte | string | 创建时间范围 |
| search | string | 版本号/Tag 名模糊搜索 |

列表项附带 `commit_total` / `pass_count` / `warning_count` / `illegal_count` / `has_doc`。

### 8.2 创建发布申请

- **POST** `/api/releases/`
- 项目成员可创建（草稿）。

**请求体：**

```json
{
  "project": "uuid",
  "repository": "uuid",
  "release_type": "formal",
  "branch": "main",
  "version": "VA.4.1.155",
  "tag_name": "VA.4.1.155_20260731",
  "related_changes": [],
  "updates": [{"type": "A", "content": "...", "source": "commit", "source_ref": "abc123"}],
  "has_config_changes": false,
  "config_change_doc": "",
  "impact_other": false,
  "impact_desc": "",
  "self_test_passed": true,
  "retest_passed": true
}
```

> `version` / `tag_name` 可选，为空时后端基于仓库 tag 和项目 `version_rule` 自动计算；rc/beta 类型自动补类型后缀与日期段。
> `repository` 必须属于所选项目。

### 8.3 发布详情

- **GET** `/api/releases/{id}/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "uuid",
    "project": "uuid",
    "project_name": "版本发布管理系统",
    "repository": "uuid",
    "repository_name": "后端代码仓库",
    "version": "VA.4.1.155",
    "tag_name": "VA.4.1.155_20260731",
    "branch": "main",
    "git_hash": "271b688781e11ce76090b0ff1d281ec8d1dcd991",
    "release_type": "formal",
    "release_type_display": "正式",
    "status": "draft",
    "status_display": "草稿",
    "release_doc": "| 项目 | 内容 |\n| --- | --- |\n...",
    "related_changes": [],
    "updates": [],
    "has_config_changes": false,
    "config_change_doc": "",
    "impact_other": false,
    "impact_desc": "",
    "self_test_passed": true,
    "retest_passed": true,
    "publisher": "uuid",
    "publisher_name": "蒋鑫",
    "package_tasks": [
      {
        "id": "uuid",
        "name": "web 打包",
        "status": "success",
        "status_display": "成功",
        "build_type": "",
        "artifact_count": 2,
        "started_at": "2026-06-22T10:00:00+08:00",
        "finished_at": "2026-06-22T10:05:00+08:00",
        "created_at": "2026-06-22T10:00:00+08:00"
      }
    ],
    "rejected_reason": "",
    "released_at": null,
    "created_at": "2026-06-22T10:00:00+08:00",
    "updated_at": "2026-06-22T10:00:00+08:00"
  }
}
```

`release_doc` 为 Markdown 格式字符串（两列表格），可手动编辑。

### 8.4 更新发布申请

- **PUT / PATCH** `/api/releases/{id}/`
- 仅草稿状态可编辑，可修改 `branch` / `version` / `tag_name`；分支变化时重新解析分支 HEAD 哈希，并校验 tag 后缀一致性与远端 tag 不重复。

### 8.5 删除发布申请

- **DELETE** `/api/releases/{id}/`
- 仅 `draft` / `rejected` 状态可删除。

### 8.6 发布关联 Commit 列表

- **GET** `/api/releases/{id}/commits/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 10,
    "page": 1,
    "page_size": 20,
    "results": [
      {
        "id": "uuid",
        "commit_id": "uuid",
        "commit_hash": "abc123",
        "author": "张三",
        "message": "...",
        "review_status": "pass",
        "review_reason": "",
        "parsed_result": {},
        "committed_at": "2026-06-20T10:00:00+08:00",
        "is_included": true,
        "edited_content": {}
      }
    ]
  }
}
```

### 8.7 生成发布说明

- **POST** `/api/releases/{id}/generate-doc/`
- 需项目开发人员权限。

**请求体：**

```json
{
  "commit_ids": ["uuid1", "uuid2"],
  "merge_similar": true
}
```

`commit_ids` 可选（为空时取本次变更范围全部提交）；`merge_similar` 默认 `true`。`data` 为生成后的发布说明 Markdown 字符串（同时已保存到发布记录）。

### 8.8 手动编辑发布说明

- **POST** `/api/releases/{id}/update-doc/`

**请求体：**

```json
{
  "release_doc": "| 项目 | 内容 |\n| --- | --- |\n| 版本 | VA.4.1.155 |"
}
```

### 8.9 导出发布单

- **GET** `/api/releases/{id}/export-md/`：导出 Markdown 文件（`text/markdown`）。
- **GET** `/api/releases/{id}/export-pdf/`：导出 PDF 文件（`application/pdf`）。
- **GET** `/api/releases/{id}/export-word/`：导出 Word 文件（`.docx`）。

均为文件流下载，非统一 JSON 响应。

### 8.10 提交审批

- **POST** `/api/releases/{id}/submit-audit/`
- 需项目开发人员权限。仅 `draft` 可提交；要求发布说明非空且纳入发布的提交中无 `illegal` 记录。
- 按发布类型匹配项目内置审批流程：流程无审批节点时直接推 tag 发布；否则创建 `WorkflowInstance` 并置为 `pending`。

**响应：**

```json
{
  "code": 0,
  "message": "提交成功",
  "data": {
    "id": "uuid",
    "status": "pending",
    "workflow_instance_id": "uuid"
  }
}
```

### 8.11 推 Tag

- **POST** `/api/releases/{id}/push-tag/`
- 需项目开发人员权限。审批流场景下由审批通过自动触发，也可对满足条件的发布手动调用。

**响应：**

```json
{
  "code": 0,
  "message": "推 tag 成功",
  "data": {
    "tag_name": "VA.4.1.155_20260731",
    "git_hash": "271b688781e11ce76090b0ff1d281ec8d1dcd991",
    "pushed_at": "2026-06-22T10:00:00+08:00"
  }
}
```

远端 tag 已存在返回 `code=40003`。

### 8.12 看板统计

- **GET** `/api/releases/dashboard/overview/`

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total_releases": 120,
    "success_rate": 0.95,
    "pending_audit_count": 5,
    "rejected_count": 3,
    "released_count": 100
  }
}
```

- **GET** `/api/releases/dashboard/trend/?days=30`

按天统计发布数 / 成功数 / 失败数，返回定长数组（`days` 默认 30）：

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {"date": "2026-07-01", "count": 3, "success_count": 3, "failure_count": 0}
  ]
}
```

- **GET** `/api/releases/dashboard/projects/`

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {"project_id": "uuid", "project_name": "版本发布管理系统", "release_count": 20, "success_rate": 0.9}
  ]
}
```

### 8.13 版本目录

- **GET** `/api/releases/catalog/`

按发布类型分组返回已发布（`released`）版本：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "formal": [],
    "rc": [],
    "beta": []
  }
}
```

---

## 九、打包接口（apps/package）

打包统一由本模块承担（Jenkins 已下线）。镜像可来自本地 Docker 或 Nexus（Nexus 连接在「系统配置」页面维护 `nexus_*` 键）。

### 9.1 打包镜像列表

- **GET** `/api/packages/images/`

**查询参数：** `source`（local/nexus）、`is_active`、`search`（名称/镜像地址）。

### 9.2 新增 / 更新 / 删除打包镜像

- **POST** `/api/packages/images/`
- **PUT / PATCH / DELETE** `/api/packages/images/{id}/`
- 仅超管。

**请求体：**

```json
{
  "name": "web 打包镜像",
  "source": "nexus",
  "registry_host": "nexus.example.com:8082",
  "repository": "docker-hosted",
  "image_name": "trace-ship/web-pack",
  "image_tag": "1.0.0",
  "script_entry": "/workspace/scripts/pack.sh",
  "default_build_path": ".",
  "default_output_path": "dist",
  "is_active": true
}
```

`image`（完整镜像地址）由后端按 `source` + 坐标自动拼接，只读。

### 9.3 上传镜像包导入本地 Docker

- **POST** `/api/packages/images/import/`
- 仅超管；`multipart/form-data` 上传 `file`（支持 `.tar` / `.tar.gz` / `.tgz` / `.tar.bz2` / `.tar.xz`），后端执行 `docker load`。

**响应：**

```json
{
  "code": 0,
  "message": "已导入 1 个镜像",
  "data": {"loaded": ["trace-ship/web-pack:1.0.0"]}
}
```

### 9.4 浏览 Nexus 仓库与镜像

- **GET** `/api/packages/images/nexus-repositories/`：列出 Nexus 中 docker 格式仓库。
- **GET** `/api/packages/images/nexus-images/?repository=&keyword=&continuation_token=`：搜索 Nexus docker 镜像，分页通过 `continuation_token` 翻页。

### 9.5 可选镜像聚合列表

- **GET** `/api/packages/images/available/?keyword=&source=`

聚合本地 Docker 与 Nexus 镜像（`source` 可选 local/nexus），任一来源失败不影响另一来源：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "items": [
      {"source": "local", "image": "web-pack:1.0.0", "name": "web-pack", "version": "1.0.0", "repository": "", "registry_host": "", "image_id": "abc123", "size": "100MB"},
      {"source": "nexus", "name": "trace-ship/web-pack", "version": "1.0.0", "repository": "docker-hosted", "image": "nexus.example.com:8082/docker-hosted/trace-ship/web-pack:1.0.0"}
    ],
    "errors": {"local": "", "nexus": ""}
  }
}
```

### 9.6 打包配置列表与维护

- **GET / POST** `/api/packages/configs/`
- **GET / PUT / PATCH / DELETE** `/api/packages/configs/{id}/`
- 查询需项目成员；写操作需项目管理员。

**查询参数：** `project`、`repository`、`is_active`、`auto_package_on_release`。

**请求体：**

```json
{
  "project": "uuid",
  "repository": "uuid",
  "name": "web 打包",
  "image_info": {
    "source": "nexus",
    "registry_host": "nexus.example.com:8082",
    "repository": "docker-hosted",
    "image_name": "trace-ship/web-pack",
    "image_tag": "1.0.0"
  },
  "custom_script": "",
  "build_path": ".",
  "output_path": "dist",
  "env_vars": {"NODE_ENV": "production"},
  "auto_package_on_release": true,
  "is_active": true,
  "svn_push_enabled": true,
  "svn_url": "svn://svn.example.com/releases",
  "svn_credential": "uuid",
  "svn_path_template": "{project}/{version}"
}
```

说明：
- `image_info` 为只写字段，后端按镜像坐标 `get_or_create` 镜像记录；读取时返回 `image_id` / `image_name` / `image_ref` / `image_source`。
- 配置了 `custom_script` 时容器内以 `sh -c` 直接执行该脚本，否则执行镜像内置 `script_entry`（默认 `/workspace/scripts/pack.sh`）。
- 启用 SVN 推送时 `svn_url`（须以 `svn://` / `http://` / `https://` 开头）与 `svn_credential`（必须为 `svn_password` 类型且启用）必填。
- 打包配置仅支持 Git 仓库，且仓库必须属于当前项目。

### 9.7 手动触发打包

- **POST** `/api/packages/configs/{id}/trigger/`

**请求体：**

```json
{
  "release_id": "uuid"
}
```

为指定发布记录创建打包任务，返回任务详情（HTTP 201）。发布推 tag 成功后，后端也会为开启 `auto_package_on_release` 的配置自动创建任务。

### 9.8 测试 SVN 推送配置

- **POST** `/api/packages/configs/test-svn/`
- 项目管理员（或项目负责人在内）可测；支持未保存的临时配置。

**请求体：**

```json
{
  "project_id": "uuid",
  "svn_url": "svn://svn.example.com/releases",
  "svn_credential_id": "uuid",
  "svn_path_template": "{project}/{version}"
}
```

### 9.9 浏览 SVN 制品目录

- **GET** `/api/packages/configs/{id}/svn-entries/?path=sub/dir`

实时浏览该配置 SVN 目录内容（`svn list`，不递归）；`path` 为相对子路径，拒绝 `..` 与绝对路径。

### 9.10 打包任务列表 / 详情

- **GET** `/api/packages/tasks/`
- **GET** `/api/packages/tasks/{id}/`

**查询参数：** `project`、`repository`、`release`、`config`、`status`、`build_type`、`search`（名称/版本/Tag/项目名/仓库名）。

任务状态：`queued` / `running` / `success` / `failure` / `canceled`。

**响应（单条）：**

```json
{
  "id": "uuid",
  "config": "uuid",
  "config_name": "web 打包",
  "release": "uuid",
  "release_version": "VA.4.1.155",
  "project": "uuid",
  "project_name": "版本发布管理系统",
  "repository": "uuid",
  "repository_name": "后端代码仓库",
  "triggered_by": "uuid",
  "triggered_by_name": "张三",
  "name": "web 打包",
  "build_type": "",
  "tag_name": "VA.4.1.155_20260731",
  "version": "VA.4.1.155",
  "commit_hash": "abc123",
  "config_snapshot": {},
  "status": "success",
  "status_display": "成功",
  "progress": 100,
  "stage_info": {},
  "can_push_svn": true,
  "artifact_info": [{"id": "uuid", "name": "app.tar.gz", "path": "app.tar.gz"}],
  "duration": 300000,
  "error_message": "",
  "started_at": "2026-06-22T10:00:00+08:00",
  "finished_at": "2026-06-22T10:05:00+08:00",
  "created_at": "2026-06-22T10:00:00+08:00",
  "updated_at": "2026-06-22T10:05:00+08:00"
}
```

### 9.11 取消打包任务

- **POST** `/api/packages/tasks/{id}/cancel/`
- 仅项目管理员；已结束的任务不可取消。

### 9.12 手动推送产物到 SVN

- **POST** `/api/packages/tasks/{id}/push-svn/`
- 仅项目管理员；任务成功且配置快照启用了 SVN 推送时可用（`can_push_svn=true`）。

### 9.13 任务日志与产物下载

- **GET** `/api/packages/tasks/{id}/logs/`：纯文本日志（`text/plain`，非 JSON 响应）。
- **GET** `/api/packages/tasks/{id}/artifacts/{artifact_id}/download/`：下载单个产物文件。
- **GET** `/api/packages/tasks/{id}/download-all/`：全部产物打包为 zip 下载。

---

## 十、工作流接口

### 10.1 流程定义列表

- **GET** `/api/workflow/definitions/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| project | string | 项目 ID |
| biz_type | string | release |
| is_active | bool | 是否启用 |

流程定义按项目内置（formal/rc/beta 各一条），`graph_data` 由后端根据 `node_config` 自动生成。

### 10.2 新增 / 删除流程定义（不支持）

- **POST / DELETE** `/api/workflow/definitions/`、`/api/workflow/definitions/{id}/`
- 内置流程不支持手动新增与删除，返回 `code=40003`。

### 10.3 更新流程定义

- **PUT / PATCH** `/api/workflow/definitions/{id}/`
- 仅项目负责人；只允许修改 `node_config` 审批链配置。

**请求体：**

```json
{
  "node_config": [
    {
      "node_id": "approval_1",
      "node_name": "负责人审批",
      "mode": "any",
      "approvers": [{"type": "leader"}]
    },
    {
      "node_id": "approval_2",
      "node_name": "测试会签",
      "mode": "all",
      "approvers": [{"type": "user", "user_id": "uuid"}]
    }
  ]
}
```

`mode`：`any`（或签）/ `all`（会签）。`approvers` 元素 `type` 取值：`leader`（项目负责人）/ `role`（项目成员角色，配合 `role` 字段）/ `user`（指定用户，配合 `user_id` 字段）。

### 10.4 启动流程实例

- **POST** `/api/workflow/instances/`
- 需项目开发人员权限；发布提审批通常由 `submit-audit` 自动创建，无需手动调用。

**请求体：**

```json
{
  "definition_id": "uuid",
  "biz_type": "release",
  "biz_id": "release_uuid"
}
```

### 10.5 流程实例列表 / 详情

- **GET** `/api/workflow/instances/`：过滤参数 `biz_type` / `biz_id` / `status` / `created_by`。
- **GET** `/api/workflow/instances/{id}/`：详情含任务列表与节点状态快照（`node_status`）、实例图快照（`graph_data`）。

实例状态：`running` / `completed` / `rejected` / `revoked`。

### 10.6 我发起的

- **GET** `/api/workflow/instances/initiated/?status=running`

返回当前用户创建的流程实例列表，支持 `status` 过滤。

### 10.7 撤销流程实例

- **POST** `/api/workflow/instances/{id}/revoke/`
- 发起人撤销运行中的实例。

### 10.8 我的待办 / 已办

- **GET** `/api/workflow/tasks/todo/`
- **GET** `/api/workflow/tasks/done/`

任务状态：`pending` / `approved` / `rejected` / `transferred` / `rollbacked`。

### 10.9 审批通过

- **POST** `/api/workflow/tasks/{id}/approve/`

**请求体：**

```json
{
  "comment": "同意发布"
}
```

流程全部节点通过后，后端自动为关联发布推 tag。

### 10.10 审批驳回

- **POST** `/api/workflow/tasks/{id}/reject/`

**请求体：**

```json
{
  "comment": "配置项改动未说明影响范围"
}
```

流程驳回后关联发布置为 `rejected` 并记录驳回意见。

### 10.11 转交

- **POST** `/api/workflow/tasks/{id}/transfer/`

**请求体：**

```json
{
  "to_user_id": "uuid",
  "comment": "请张工帮忙审批"
}
```

### 10.12 回退

- **POST** `/api/workflow/tasks/{id}/rollback/`

**请求体：**

```json
{
  "rollback_target": "approval_1",
  "comment": "请补充发布说明"
}
```

`rollback_target` 可选（目标节点 ID）；回退到初始节点时流程作废，实例自动删除，关联发布恢复为 `draft`。

> 旧版 `/api/workflow/instances/{id}/progress/` 与任务级 `revoke` 接口已不存在：进度信息包含在实例详情的 `node_status` / `graph_data` 中，撤销改为实例级 `revoke`。

---

## 十一、通知接口

### 11.1 通知列表

- **GET** `/api/notifications/`

仅返回当前用户的通知。**查询参数：** `notification_type`（audit/build/release/system）、`is_read`。

### 11.2 未读数

- **GET** `/api/notifications/unread-count/`

```json
{
  "code": 0,
  "message": "success",
  "data": {"count": 3}
}
```

### 11.3 标记已读

- **POST** `/api/notifications/{id}/read/`：标记单条已读（仅本人）。
- **POST** `/api/notifications/read-all/`：全部已读，返回处理条数。

### 11.4 清除通知

- **DELETE** `/api/notifications/clear/`：清除当前用户全部已读通知。
- **DELETE** `/api/notifications/clear-all/`：清除当前用户全部通知（含未读）。

---

## 十二、使用反馈接口

全员可查看与提交；删除仅限本人或超管；标记已处理仅超管。

### 12.1 反馈列表

- **GET** `/api/feedback/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| category | string | suggestion/bug/experience/other |
| status | string | open/processed |
| search | string | 标题/内容模糊搜索 |
| ordering | string | created_at / like_count（支持 `-` 前缀） |

**响应（单条）：**

```json
{
  "id": "uuid",
  "title": "建议支持批量审批",
  "content": "...",
  "category": "suggestion",
  "created_by": "uuid",
  "created_by_name": "张三",
  "like_count": 5,
  "liked": false,
  "status": "open",
  "processed_by": null,
  "processed_by_name": "",
  "processed_at": null,
  "created_at": "2026-06-22T10:00:00+08:00",
  "updated_at": "2026-06-22T10:00:00+08:00"
}
```

### 12.2 提交反馈

- **POST** `/api/feedback/`

**请求体：**

```json
{
  "title": "建议支持批量审批",
  "content": "...",
  "category": "suggestion"
}
```

`category` 可选 `suggestion` / `bug` / `experience` / `other`，默认 `suggestion`；标题与内容去空白且必填。提交人自动绑定当前用户。

### 12.3 删除反馈

- **DELETE** `/api/feedback/{id}/`
- 仅提交人本人或超管，否则返回 `code=40301`。

### 12.4 点赞切换

- **POST** `/api/feedback/{id}/like/`

已点赞则取消，未点赞则点赞：

```json
{
  "code": 0,
  "message": "点赞成功",
  "data": {"liked": true, "like_count": 6}
}
```

### 12.5 标记已处理

- **POST** `/api/feedback/{id}/process/`
- 仅超管；将状态置为 `processed` 并记录 `processed_by` / `processed_at`，重复处理返回 `code=40001`。

---

## 十三、系统管理接口

### 13.1 系统参数列表与维护

- **GET / POST** `/api/system/configs/`
- **GET / PUT / PATCH / DELETE** `/api/system/configs/{key}/`
- 仅超管；以 `key` 作为 lookup 字段，支持 `search`（key/描述模糊搜索）。

**响应（单条）：**

```json
{
  "id": 1,
  "key": "ldap_server_uri",
  "value": "ldaps://ldap.example.com:636",
  "description": "LDAP 服务器地址",
  "is_public": false,
  "created_at": "2026-06-01T10:00:00+08:00",
  "updated_at": "2026-06-22T10:00:00+08:00"
}
```

常用配置键：
- LDAP：`ldap_enabled` / `ldap_server_uri` / `ldap_bind_dn` / `ldap_bind_password` / `ldap_user_search_base` / `ldap_user_filter` / `ldap_tls_reqcert` / `ldap_ca_cert`（页面配置优先于环境变量）。
- Nexus：`nexus_base_url` / `nexus_username` / `nexus_password` / `nexus_registry_host`（打包镜像选择使用）。

### 13.2 LDAP 连接测试

- **POST** `/api/system/configs/ldap-test/`
- 仅超管；使用当前生效的 LDAP 配置（页面配置优先，环境变量兜底）测试连通性。

**响应：**

```json
{
  "code": 0,
  "message": "连接成功，服务账号绑定与搜索基准 DN 均可用",
  "data": {"detail": "连接成功，服务账号绑定与搜索基准 DN 均可用"}
}
```

### 13.3 操作日志

- **GET** `/api/system/logs/`
- 仅超管，只读。

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| module | string | 模块 |
| action | string | 动作 |
| user | string | 用户 ID |
| result | string | 结果 |
| created_at_after / created_at_before | string | 时间范围（DateTimeFromToRangeFilter） |

**响应（单条）：**

```json
{
  "id": 1,
  "user": {"id": "uuid", "username": "admin", "nickname": "系统管理员"},
  "module": "auth",
  "action": "login",
  "resource_type": "user",
  "resource_id": "uuid",
  "detail": {},
  "description": "",
  "result": "success",
  "ip": "127.0.0.1",
  "created_at": "2026-06-22T10:00:00+08:00"
}
```

> 旧版「AI 调用日志」接口（`/api/system/ai-logs/`）后端未实现，已移除。

---

## 十四、错误响应示例

### 参数错误

```json
{
  "code": 40001,
  "message": "参数错误",
  "data": {
    "version": ["版本号格式不正确"]
  }
}
```

### 无权限

```json
{
  "code": 40300,
  "message": "无权限访问该项目",
  "data": null
}
```

### 外部系统调用失败

```json
{
  "code": 50200,
  "message": "无法连接 SVN 服务器: Connection timeout",
  "data": null
}
```

---

## 十五、开发联调约定

1. **Swagger/Redoc 文档**：后端部署后可通过 `/swagger/` 或 `/redoc/` 查看在线文档，OpenAPI Schema 位于 `/api/schema/`。
2. **Postman 集合**：`docs/` 目录提供对应 Postman Collection。
3. **健康检查**：`/health/` 无需认证，检查 PostgreSQL 与 Redis 连通性，供容器探针使用。
