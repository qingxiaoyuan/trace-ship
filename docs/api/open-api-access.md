# 对外开放接口接入说明

Trace Ship 向外部系统提供一组只读查询接口，统一挂在 `/api/open/` 前缀下。
外部系统使用管理员签发的 **Access Token** 鉴权，每个 token 仅可调用被授权的接口。

## 鉴权方式

1. 联系 Trace Ship 管理员，在「系统管理 · 访问令牌」页面创建令牌，创建时会分配可调用的接口范围（scope）。
2. 管理员将 token 明文（形如 `tsat_xxxxxxxx`，仅创建时展示一次）线下交付。
3. 调用接口时在请求头携带：

```
Authorization: Bearer tsat_xxxxxxxx
```

token 被禁用、过期或访问未授权接口时请求会被拒绝。token 泄露请立即联系管理员吊销。

## 通用说明

- 所有接口仅支持 `GET`，响应格式统一为 `{code, message, data}`，`code=0` 表示成功。
- 常见错误：

| HTTP 状态码 | 含义 |
| --- | --- |
| 401 | 未携带 token、token 无效 / 已禁用 / 已过期 |
| 403 | token 未授权访问该接口，或使用了非 GET 方法 |
| 400 | 缺少必填参数 |
| 404 | 查询的资源不存在 |
| 502 | 后端调用 GitLab 失败 |

## 接口列表

### 1. 按 tag 查询发布变更文档

所需 scope：`release.doc`

```
GET /api/open/release-doc/?tag=<tag_name>&repository_id=<仓库ID>
```

参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| tag | 是 | 发布 tag 名称 |
| repository_id | 是 | Trace Ship 中的仓库 ID（UUID） |

仅返回已完成发布（已推 tag）的记录；草稿、审批中、已驳回的发布不对外暴露。

成功响应示例：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "project_name": "示例项目",
    "repository_name": "后端仓库",
    "version": "VA.1.0.0",
    "tag_name": "VA.1.0.0",
    "release_type": "formal",
    "release_doc": "| 类型 | 内容 |\n| --- | --- |\n| A | 新增功能 |",
    "config_change_doc": "无",
    "released_at": "2026-08-20T10:00:00+08:00"
  }
}
```

### 2. 查询两个 tag 之间的 commits 与 MRs

所需 scope：`repo.compare`

```
GET /api/open/compare/?repository_id=<仓库ID>&from_tag=<起始tag>&to_tag=<结束tag>[&branch=<目标分支>]
```

参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| repository_id | 是 | Trace Ship 中的仓库 ID（UUID） |
| from_tag | 是 | 起始 tag（基线，不含） |
| to_tag | 是 | 结束 tag |
| branch | 否 | MR 过滤用的目标分支，缺省为仓库默认分支 |

返回 `from_tag → to_tag` 区间的提交列表，以及合并到目标分支、合并时间落在区间内的 MR 列表。

> 注意：MR 区间过滤以 tag 指向 commit 的提交时间近似 tag 时间点（GitLab API 不提供 tag 创建时间）。
> 若 tag 打在历史 commit 上，区间会偏宽，返回的 MR 可能略多于实际区间。

成功响应示例：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "project_name": "示例项目",
    "repository_name": "后端仓库",
    "from_tag": "v1.0.0",
    "to_tag": "v1.1.0",
    "branch": "develop",
    "commits": [
      {
        "hash": "abc123...",
        "author": "张三",
        "message": "feat: 新增功能",
        "committed_at": "2026-06-15T10:00:00+08:00"
      }
    ],
    "mrs": [
      {
        "number": "1",
        "title": "新增功能",
        "author": "张三",
        "source_branch": "feature/a",
        "target_branch": "develop",
        "merged_at": "2026-06-16T10:00:00+08:00",
        "web_url": "https://gitlab.example.com/group/repo/-/merge_requests/1"
      }
    ]
  }
}
```

## 调用示例

```bash
# 查询发布变更文档
curl -H "Authorization: Bearer tsat_xxxxxxxx" \
  "http://<trace-ship-host>/api/open/release-doc/?tag=VA.1.0.0&repository_id=<仓库ID>"

# 查询两个 tag 之间的 commits 与 MRs
curl -H "Authorization: Bearer tsat_xxxxxxxx" \
  "http://<trace-ship-host>/api/open/compare/?repository_id=<仓库ID>&from_tag=v1.0.0&to_tag=v1.1.0"
```
