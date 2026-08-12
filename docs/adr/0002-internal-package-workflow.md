# 0002 - 内置打包替代 Jenkins

**Status:** proposed
**Date:** 2026-07-02
**Spec:** 用户需求：全量替换 Jenkins，系统内部实现打包
**Deciders:** project maintainers

## Context

新发布流程不再依赖 Jenkins。审批完成并推送 tag 成功后，发布记录保持 `released` 状态，打包作为独立任务记录执行结果、日志和产物。

系统需要支持两类打包模式：

- 简易打包：项目选择 `web` / `qt` 类型，并关联同类型启用的 Docker 打包镜像。
- 本地脚本：项目配置本地脚本，在后端 / Celery 所在机器的隔离工作区执行。

## Decision

新增 `apps.package` 作为唯一打包模块，包含系统级 `PackageImage`、项目级 `PackageConfig` 和任务级 `PackageTask`。

发布推 tag 成功后由 `ReleaseService.push_tag` 调用 `PackageService.trigger_auto_packages_for_release` 创建打包任务。打包任务失败只记录在 `PackageTask`，不回滚发布状态。

每个任务使用独立工作区：

- `source/`：按已发布 tag 拉取源码。
- `artifacts/`：后端提供下载的产物目录。
- `logs/build.log`：任务完整日志。
- `tmp/`：临时目录。

简易 Web 打包第一阶段固定从源码内 `dist` 收集产物到工作区 `artifacts/`。任务 API 不返回后端物理路径，日志和产物通过受权限保护的接口读取。

Jenkins 相关数据库表作为历史迁移依赖保留，但不再注册产品 API、前端页面或默认开发基础设施入口。

## 2026-08-12 演进

- 拉取源码后平台将本次发布说明写入源码根目录 `release-{version}.md`（内容与 SVN 推送文件一致，单元格内换行转 `<br>`），并注入环境变量 `RELEASE_DOC_PATH`（该文件完整路径），本地 Docker 与远程 Windows 均生效。
- SVN 推送提交 message 由固定摘要改为「摘要行 + 空行 + 原始发布说明全文」；发布说明为空时保持原摘要行。

## Consequences

发布状态机从“发布依赖构建成功”调整为“发布成功后独立打包”。这降低了外部 CI 依赖，也让打包失败不会阻断已发布 tag。

系统需要维护 Celery / Redis 可用性；开发环境允许降级为本地后台线程执行，但生产应优先使用 Celery Worker。

本地脚本打包具备宿主机命令执行能力，只应开放给可信项目管理员，并需保留操作日志和任务日志。项目环境变量可能包含敏感信息，任务日志必须避免明文输出环境变量值。

## Alternatives Considered

继续使用 Jenkins 被拒绝，因为新流程要求系统内部完成打包，Jenkins 接入对当前系统价值有限。

将打包结果并入 `ReleaseRecord.status` 被拒绝，因为发布成功和打包成功是两个不同生命周期，打包失败不应回滚已发布版本。
