# 0007 - 远程 Windows 打包节点执行器

**Status:** proposed
**Date:** 2026-08-10
**Spec:** 用户需求：打包功能支持在远程 Windows 机器上执行
**Deciders:** project maintainers

## Context

ADR-0002 确立的内置打包仅支持在平台宿主机以本地 Docker 容器执行。部分项目（.NET / MSBuild / Qt 等）必须在 Windows 环境构建，Linux 容器无法覆盖。

需要新增一种"远程 Windows 节点"执行方式，同时满足：

- 不破坏 ADR-0002 的任务主流程（checkout → build → artifacts → svn_push）与既有接口（日志、产物下载、SVN 推送均依赖平台本地工作区）；
- 节点凭证沿用 `apps.credential` 加密体系；
- 内网离线部署，远程执行库需随后端镜像分发。

## Decision

在 `apps.package` 内扩展而非新建模块：

- 新增系统级节点池模型 `PackageNode`（host / SSH 端口 / 凭证 / 远程工作根目录），由管理员在「系统配置」维护，提供 `/packages/nodes/{id}/test/` 与 `test-connection/` 连通性测试（SSH 登录 + 系统版本 + git 检测 + 工作目录创建）。
- `PackageConfig` 增加 `executor_type`（`local_docker` 默认 / `remote_windows`）与 `node` 外键；远程模式不要求镜像，本地模式不允许选节点。
- 节点登录使用新增凭证类型 `windows_password`（用户名密码），与 `svn_password` 同为全系统共享凭证。
- 远程执行采用 **SSH/SFTP 一体化**（paramiko）：SSH 流式执行命令并实时回写本地 `build.log`，SFTP 在构建后递归回传产物到平台本地工作区，后续扫描、下载、推 SVN 流程与本地打包完全复用。
- 源码由**节点自行 git clone**（节点预装 git 且可访问 GitLab）。认证使用 `git -c http.extraHeader="Authorization: Basic <base64>"`，不将凭证编入 URL（URL 编码的 `%XX` 会被 cmd `%var%` 展开破坏），并置空 `credential.helper=` 避免 wincredman 持久化报错。
- 构建脚本为 Windows 批处理：自定义脚本上传为 `tmp\pack-custom.bat` 执行；留空执行源码根目录 `pack.bat`。环境变量经 `set "K=V"` 前缀注入，值禁止 `"` 与 `%`。
- 节点信息（host/port/work_root/credential_id）写入 `config_snapshot`，凭证明文不落快照，运行时解析。
- 取消任务通过关闭 SSH 会话终止远程进程；产物回传完成后清理远程任务目录。

节点准入要求（OpenSSH Server、git、构建环境、目录约定）见 `docs/package-windows-node.md`。

## Consequences

- `requirements.txt` 新增 `paramiko`，外网构建后端镜像时自动装入。
- 远程执行引入新的边界情况（cmd 转义、编码 GBK 回退、SFTP 大文件传输不可中断），需要针对性测试与运维文档。
- `local_docker` 执行路径不变，历史配置与任务完全兼容。
- 删除仍被远程配置引用的节点会被拒绝（409），防止配置悬空。
