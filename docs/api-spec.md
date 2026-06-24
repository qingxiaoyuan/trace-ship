# 后端接口文档（V1.0）

> 基于 [feat/后台设计.md](../feat/后台设计.md)、[feat/后台需求.md](../feat/后台需求.md) 整理。前后端分离开发，后端优先提供此文档供前端联调。

---

## 一、通用约定

### 1.1 基础信息

| 项 | 说明 |
|---|---|
| 协议 | HTTPS（开发环境可 HTTP） |
| Base URL | `https://api.trace-ship.example.com` 或 `http://localhost:8000` |
| 内容类型 | `application/json` |
| 认证方式 | JWT Bearer Token |
| 时区 | UTC+8（返回 ISO 8601 格式） |

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
| 40001 | 参数错误 |
| 40002 | 业务校验失败 |
| 40100 | 未登录或 Token 失效 |
| 40300 | 无权限 |
| 40400 | 资源不存在 |
| 40900 | 资源冲突 |
| 50000 | 服务器内部错误 |
| 50001 | 外部系统调用失败 |

### 1.4 通用分页参数

列表接口默认支持：

| 参数 | 类型 | 说明 |
|------|------|------|
| page | int | 页码，默认 1 |
| page_size | int | 每页条数，默认 20，最大 100 |
| ordering | string | 排序字段，如 `-created_at` |

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

---

## 二、认证接口

### 2.1 登录

- **POST** `/api/auth/login/`

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

### 2.2 刷新 Token

- **POST** `/api/auth/token/refresh/`

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
    "expires_in": 3600
  }
}
```

### 2.3 登出

- **POST** `/api/auth/logout/`

**请求头：** `Authorization: Bearer {access_token}`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

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

### 2.5 当前用户菜单

- **GET** `/api/auth/menus/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "id": "project",
      "name": "项目管理",
      "path": "/projects",
      "icon": "ProjectOutlined",
      "children": []
    }
  ]
}
```

---

## 三、用户与角色接口

### 3.1 用户列表

- **GET** `/api/account/users/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| keyword | string | 用户名/昵称/邮箱模糊搜索 |
| source | string | local/ldap |
| is_active | bool | 是否启用 |

**响应：** 分页列表

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
        "department": "研发部",
        "source": "ldap",
        "is_active": true,
        "is_superuser": false,
        "last_login": "2026-06-22T10:00:00+08:00",
        "created_at": "2026-06-01T10:00:00+08:00"
      }
    ]
  }
}
```

### 3.2 创建用户（本地应急账号）

- **POST** `/api/account/users/`

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

### 3.3 角色列表

- **GET** `/api/account/roles/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 5,
    "results": [
      {
        "id": "uuid",
        "name": "项目管理员",
        "code": "project_manager",
        "permissions": ["project.view", "project.edit"]
      }
    ]
  }
}
```

### 3.4 权限列表

- **GET** `/api/account/permissions/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 50,
    "results": [
      {
        "id": "uuid",
        "name": "查看项目",
        "code": "project.view",
        "module": "project"
      }
    ]
  }
}
```

---

## 四、项目管理接口

### 4.1 项目列表

- **GET** `/api/projects/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| keyword | string | 编码/名称模糊搜索 |
| status | int | 启用/停用 |

**响应：** 分页列表

### 4.2 创建项目

- **POST** `/api/projects/`

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
    "formal_branch": "main",
    "test_prefix": "test",
    "release_cycle_days": 3
  },
  "status": 1
}
```

### 4.3 项目详情

- **GET** `/api/projects/{id}/`

### 4.4 更新项目

- **PUT** `/api/projects/{id}/`

### 4.5 删除项目

- **DELETE** `/api/projects/{id}/`

### 4.6 项目成员列表

- **GET** `/api/projects/{id}/members/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 5,
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

### 4.7 添加项目成员

- **POST** `/api/projects/{id}/members/`

**请求体：**

```json
{
  "user_id": "uuid",
  "role": "developer"
}
```

角色可选：`developer`/`tester`/`manager`/`auditor`/`viewer`

### 4.8 项目外站绑定列表

- **GET** `/api/projects/{id}/integrations/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 3,
    "results": [
      {
        "id": "uuid",
        "integration_type": "git_repo",
        "vendor": "gitlab",
        "name": "后端代码仓库",
        "external_identity": "group/project",
        "config": {
          "server_url": "https://gitlab.example.com",
          "default_branch": "develop"
        },
        "credential_mode": "fixed",
        "is_active": true,
        "created_at": "2026-06-01T10:00:00+08:00"
      }
    ]
  }
}
```

### 4.9 新增项目外站绑定

- **POST** `/api/projects/{id}/integrations/`

**请求体：**

```json
{
  "integration_type": "git_repo",
  "vendor": "gitlab",
  "name": "后端代码仓库",
  "external_identity": "group/project",
  "config": {
    "server_url": "https://gitlab.example.com",
    "default_branch": "develop"
  },
  "credential_id": "uuid",
  "credential_mode": "fixed"
}
```

### 4.10 测试外站绑定连通性

- **POST** `/api/projects/{id}/integrations/{iid}/test/`

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

---

## 五、凭证管理接口

### 5.1 凭证列表

- **GET** `/api/credentials/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| keyword | string | 名称模糊搜索 |
| cred_type | string | gitlab_token/gitea_token/svn_password/jenkins_token/ldap_password/ai_api_key |
| scope | string | personal/project/global |

**响应：** 分页列表，凭证内容脱敏

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 10,
    "results": [
      {
        "id": "uuid",
        "name": "XX项目GitLab管理员",
        "cred_type": "gitlab_token",
        "auth_mode": "token",
        "username": "gitlab-admin",
        "masked_data": "glpa****abcd",
        "expires_at": "2027-06-01T10:00:00+08:00",
        "scope": "project",
        "project_id": "uuid",
        "is_global": false,
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
  "scope": "personal",
  "project": "uuid",
  "is_global": false
}
```

### 5.3 测试凭证有效性

- **POST** `/api/credentials/{id}/test/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "valid": true,
    "detail": "凭证有效"
  }
}
```

### 5.4 凭证使用记录

- **GET** `/api/credentials/{id}/usage/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 20,
    "results": [
      {
        "id": "uuid",
        "module": "repository",
        "action": "sync_commits",
        "used_at": "2026-06-22T10:00:00+08:00"
      }
    ]
  }
}
```

### 5.5 支持的凭证类型

- **GET** `/api/credentials/types/`

---

## 六、仓库管理接口

### 6.1 仓库列表

- **GET** `/api/repositories/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| project_id | string | 项目 ID |
| repo_type | string | git/svn |
| vendor | string | gitlab/gitea/github/gitee/svn |

### 6.2 创建仓库

- **POST** `/api/repositories/`

**请求体：**

```json
{
  "project_id": "uuid",
  "integration_id": "uuid",
  "repo_type": "git",
  "vendor": "gitlab",
  "name": "后端代码仓库",
  "url": "https://gitlab.example.com/group/project.git",
  "external_identity": "group/project",
  "default_branch": "develop",
  "credential_id": "uuid",
  "credential_mode": "fixed"
}
```

### 6.3 仓库连通性测试

- **POST** `/api/repositories/{id}/test/`

### 6.4 分支列表

- **GET** `/api/repositories/{id}/branches/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": [
    {
      "name": "main",
      "is_default": true,
      "last_commit_hash": "abc123"
    },
    {
      "name": "develop",
      "is_default": false,
      "last_commit_hash": "def456"
    }
  ]
}
```

### 6.5 提交记录列表

- **GET** `/api/repositories/{id}/commits/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| branch | string | 分支名 |
| since | string | ISO 8601 起始时间 |
| until | string | ISO 8601 结束时间 |
| author | string | 提交人 |
| review_status | string | pass/warning/illegal |

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 50,
    "results": [
      {
        "id": "uuid",
        "commit_hash": "271b688781e11ce76090b0ff1d281ec8d1dcd991",
        "author": "张三",
        "message": "变更类型：...",
        "committed_at": "2026-06-20T10:00:00+08:00",
        "parsed_result": {
          "change_type": "有配置项改动",
          "updates": [
            {"type": "A", "content": "移除干扰用户绑定数据采集(DA)的逻辑"},
            {"type": "F", "content": "信号定时开关新增清除指令并优化控制逻辑"}
          ],
          "config_changes": {"System": {"DeviceType": "0"}},
          "related_changes": {}
        },
        "review_status": "pass",
        "ai_suggestion": ""
      }
    ]
  }
}
```

### 6.6 同步提交记录

- **POST** `/api/repositories/{id}/sync-commits/`

**请求体：**

```json
{
  "branch": "develop",
  "since": "2026-06-01T00:00:00+08:00"
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "synced_count": 25,
    "illegal_count": 2
  }
}
```

### 6.7 支持的 Git 平台类型

- **GET** `/api/repositories/vendors/`

---

## 七、提交审查接口

### 7.1 Commit 列表（全局）

- **GET** `/api/commits/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| project_id | string | 项目 ID |
| repository_id | string | 仓库 ID |
| branch | string | 分支 |
| review_status | string | pass/warning/illegal |
| author | string | 提交人 |
| since | string | 起始时间 |
| until | string | 结束时间 |

### 7.2 手动审查 Commit

- **POST** `/api/commits/{id}/review/`

**请求体：**

```json
{
  "review_status": "illegal",
  "reason": "缺少变更类型标记"
}
```

### 7.3 AI 审查建议

- **GET** `/api/commits/{id}/ai-review/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "review_status": "warning",
    "suggestion": "配置项改动格式不标准，建议统一为 [System] 段落格式。",
    "risks": ["配置项改动可能影响启动参数"]
  }
}
```

---

## 八、发布管理接口

### 8.1 发布记录列表

- **GET** `/api/releases/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| project_id | string | 项目 ID |
| release_type | string | formal/test |
| status | string | draft/pending/building/auditing/released/rejected |
| publisher_id | string | 发布人 |
| version | string | 版本号 |
| since | string | 起始时间 |
| until | string | 结束时间 |

### 8.2 创建发布申请

- **POST** `/api/releases/`

**请求体：**

```json
{
  "project_id": "uuid",
  "repository_id": "uuid",
  "release_type": "formal",
  "source_branch": "develop",
  "target_branch": "main",
  "version": "VA.4.1.155",
  "description": "本次发布修复了信号定时开关问题"
}
```

> `version` 可选，为空时后端按项目 `version_rule` 自动计算。
> `repository_id` 为第三阶段新增，用于明确本次发布要推 tag 的目标仓库。

### 8.3 发布详情

- **GET** `/api/releases/{id}/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "uuid",
    "project_id": "uuid",
    "repository_id": "uuid",
    "version": "VA.4.1.155",
    "tag_name": "VA.4.1.155",
    "source_branch": "develop",
    "target_branch": "main",
    "git_hash": "271b688781e11ce76090b0ff1d281ec8d1dcd991",
    "release_type": "formal",
    "status": "draft",
    "release_doc": {
      "change_type": "有配置项改动",
      "updates": [],
      "config_changes": {},
      "related_changes": {},
      "impact_other": false,
      "test_status": "自测试通过",
      "publisher": "蒋鑫"
    },
    "publisher": {
      "id": "uuid",
      "nickname": "蒋鑫"
    },
    "created_at": "2026-06-22T10:00:00+08:00"
  }
}
```

### 8.4 可发布 Commit 列表

- **GET** `/api/releases/{id}/commits/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 10,
    "results": [
      {
        "commit_id": "uuid",
        "commit_hash": "abc123",
        "message": "...",
        "is_included": true,
        "edited_content": null
      }
    ]
  }
}
```

### 8.5 生成发布说明

- **POST** `/api/releases/{id}/generate-doc/`

**请求体：**

```json
{
  "commit_ids": ["uuid1", "uuid2"],
  "merge_similar": true
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "version": "VA.4.1.155",
    "git_hash": "271b688781e11ce76090b0ff1d281ec8d1dcd991",
    "change_type": "有配置项改动",
    "updates": [
      {"type": "A", "content": "移除干扰用户绑定数据采集(DA)的逻辑"},
      {"type": "F", "content": "信号定时开关新增清除指令并优化控制逻辑"}
    ],
    "config_changes": {"System": {"DeviceType": "0"}},
    "related_changes": {},
    "impact_other": false,
    "test_status": "自测试通过",
    "publisher": "蒋鑫"
  }
}
```

### 8.6 提交审批

- **POST** `/api/releases/{id}/submit-audit/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "release_id": "uuid",
    "status": "pending",
    "workflow_instance_id": null
  }
}
```

> 第三阶段 `submit-audit` 为简化状态流转（`draft → pending`），暂不创建工作流实例，
> `workflow_instance_id` 固定返回 `null`，完整审批流在第四阶段实现。

### 8.7 推 Tag

- **POST** `/api/releases/{id}/push-tag/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "tag_name": "VA.4.1.155",
    "git_hash": "271b688781e11ce76090b0ff1d281ec8d1dcd991",
    "pushed_at": "2026-06-22T10:00:00+08:00"
  }
}
```

---

## 九、Jenkins 集成接口

### 9.1 Jenkins 任务列表

- **GET** `/api/jenkins/jobs/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| project_id | string | 项目 ID |

### 9.2 创建 Jenkins 任务

- **POST** `/api/jenkins/jobs/`

**请求体：**

```json
{
  "project_id": "uuid",
  "integration_id": "uuid",
  "name": "后端打包任务",
  "server_url": "https://jenkins.example.com",
  "job_name": "trace-ship-backend-build",
  "credential_id": "uuid",
  "credential_mode": "fixed",
  "params_template": {
    "VERSION": "{{version}}",
    "BRANCH": "{{branch}}",
    "GIT_HASH": "{{git_hash}}"
  }
}
```

### 9.3 触发构建

- **POST** `/api/jenkins/jobs/{id}/trigger/`

**请求体：**

```json
{
  "version": "VA.4.1.155",
  "branch": "main",
  "git_hash": "271b688781e11ce76090b0ff1d281ec8d1dcd991"
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "build_id": "uuid",
    "queue_id": "123",
    "build_number": 123,
    "status": "queue"
  }
}
```

### 9.4 构建记录详情

- **GET** `/api/jenkins/builds/{id}/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "uuid",
    "job_id": "uuid",
    "queue_id": "123",
    "build_number": 123,
    "status": "success",
    "params": {
      "VERSION": "VA.4.1.155",
      "BRANCH": "main"
    },
    "log_url": "https://jenkins.example.com/job/xxx/123/console",
    "artifact_info": [
      {
        "file_name": "app.tar.gz",
        "url": "https://jenkins.example.com/job/xxx/123/artifact/app.tar.gz"
      }
    ],
    "started_at": "2026-06-22T10:00:00+08:00",
    "finished_at": "2026-06-22T10:05:00+08:00"
  }
}
```

### 9.5 构建日志

- **GET** `/api/jenkins/builds/{id}/log/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "content": "Started by user ...\nBuilding ...\nFinished: SUCCESS"
  }
}
```

---

## 十、工作流接口

### 10.1 流程定义列表

- **GET** `/api/workflow/definitions/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| project_id | string | 项目 ID |
| biz_type | string | release/... |

### 10.2 创建流程定义

- **POST** `/api/workflow/definitions/`

**请求体：**

```json
{
  "project_id": "uuid",
  "name": "正式发布审批流",
  "biz_type": "release",
  "graph_data": {
    "nodes": [
      {"id": "start", "type": "start-node"},
      {"id": "approve", "type": "approval-node", "properties": {"approverType": "leader", "mode": "or"}},
      {"id": "end", "type": "end-node"}
    ],
    "edges": [
      {"sourceNodeId": "start", "targetNodeId": "approve", "condition": "default"},
      {"sourceNodeId": "approve", "targetNodeId": "end", "condition": "approved"}
    ]
  },
  "is_active": true
}
```

### 10.3 启动流程实例

- **POST** `/api/workflow/instances/`

**请求体：**

```json
{
  "definition_id": "uuid",
  "biz_type": "release",
  "biz_id": "release_uuid"
}
```

### 10.4 流程实例详情

- **GET** `/api/workflow/instances/{id}/`

### 10.5 流程进度

- **GET** `/api/workflow/instances/{id}/progress/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "instance_id": "uuid",
    "status": "running",
    "current_node_ids": ["approve"],
    "node_status": {
      "start": "completed",
      "approve": "pending",
      "end": "not_started"
    },
    "graph_data": {}
  }
}
```

### 10.6 我的待办

- **GET** `/api/workflow/tasks/todo/`

### 10.7 我的已办

- **GET** `/api/workflow/tasks/done/`

### 10.8 审批通过

- **POST** `/api/workflow/tasks/{id}/approve/`

**请求体：**

```json
{
  "comment": "同意发布"
}
```

### 10.9 审批驳回

- **POST** `/api/workflow/tasks/{id}/reject/`

**请求体：**

```json
{
  "comment": "配置项改动未说明影响范围"
}
```

### 10.10 转交

- **POST** `/api/workflow/tasks/{id}/transfer/`

**请求体：**

```json
{
  "to_user_id": "uuid",
  "comment": "请张工帮忙审批"
}
```

### 10.11 撤销

- **POST** `/api/workflow/tasks/{id}/revoke/`

---

## 十一、看板接口

### 11.1 总览统计

- **GET** `/api/dashboard/overview/`

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total_releases": 120,
    "success_rate": 0.95,
    "pending_audit_count": 5,
    "upcoming_releases": 3
  }
}
```

### 11.2 发布趋势

- **GET** `/api/dashboard/trend/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| days | int | 最近天数，默认 30 |

### 11.3 项目发布统计

- **GET** `/api/dashboard/projects/`

---

## 十二、系统管理接口

### 12.1 系统参数列表

- **GET** `/api/system/configs/`

### 12.2 更新系统参数

- **PUT** `/api/system/configs/{key}/`

**请求体：**

```json
{
  "value": "https://ldap.example.com",
  "description": "LDAP 服务器地址"
}
```

### 12.3 操作日志

- **GET** `/api/system/logs/`

**查询参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| module | string | 模块 |
| action | string | 动作 |
| user_id | string | 用户 ID |
| since | string | 起始时间 |
| until | string | 结束时间 |

### 12.4 AI 调用日志

- **GET** `/api/system/ai-logs/`

---

## 十三、错误响应示例

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
  "code": 50001,
  "message": "Jenkins 连接失败",
  "data": {
    "detail": "Connection timeout"
  }
}
```

---

## 十四、开发联调约定

1. **Swagger/Redoc 文档**：后端部署后可通过 `/swagger/` 或 `/redoc/` 查看在线文档。
2. **Postman 集合**：后端每个里程碑交付时同步提供对应 Postman Collection。
3. **Mock 数据**：前端可在无后端环境下，通过 `/api/mock/*` 临时接口获取假数据（阶段一提供）。
4. **接口版本控制**：URL 中不带版本号，通过 `Accept: application/vnd.trace-ship.v1+json` 协商，默认 V1。
