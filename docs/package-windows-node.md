# Windows 远程打包节点接入指南

Trace Ship 支持将打包任务下发到远程 Windows 机器执行（如 .NET / MSBuild / Qt 等必须在 Windows 上构建的场景）。平台通过 SSH 执行命令、SFTP 回传产物。

## 节点要求

1. **OpenSSH Server**：Windows 10 / Server 2019+ 可按可选功能安装：

   ```powershell
   Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
   Start-Service sshd
   Set-Service -Name sshd -StartupType Automatic
   ```

   默认 shell 保持 cmd 即可。

2. **git**：节点需安装 git 且能访问 GitLab（源码由节点自行克隆，平台下发带凭证的克隆地址）。

3. **构建环境**：按项目需要预装 MSBuild / .NET SDK / Qt 等；节点不主动联网安装依赖。

4. **工作目录**：默认 `C:\trace-ship\workspaces`，平台按任务创建 `{work_root}\{task_id}\{source,artifacts,tmp}`，完成后自动清理。

## 平台配置

1. 「凭证」页新增 **Windows 密码** 类型凭证（用户名密码，全系统共享）。
2. 「系统配置」页「远程打包节点」卡片新增节点（地址 / SSH 端口 / 凭证 / 工作目录），可用「测试连接」验证 SSH 连通性、系统版本与 git 检测。
3. 项目「打包配置」执行方式选择 **远程 Windows 节点** 并选择节点：
   - 自定义打包脚本：Windows 批处理语法，平台上传到节点后以 `call` 执行；
   - 留空则执行源码根目录下的 `pack.bat`。

## 注入环境变量

打包执行时通过 `set "K=V"` 注入（值不允许包含 `"` 与 `%`）：

| 变量 | 说明 |
|---|---|
| `TAG_NAME` / `VERSION` / `PROJECT_CODE` | 发布 tag、版本号、项目编码 |
| `BUILD_PATH` / `OUTPUT_PATH` | 构建目录（相对源码根）、产物目录名 |
| `WORKSPACE` / `SOURCE_DIR` / `ARTIFACTS_DIR` / `TMPDIR` | 节点上的 Windows 路径 |
| `DEPLOY_DIR` / `SCRIPTS_DIR` | 预留目录（节点可自行使用） |
| 自定义环境变量 | 打包配置中的 `env_vars` |

产物写入 `%ARTIFACTS_DIR%`（即 `{task}\artifacts`）后，平台经 SFTP 回传到本地工作区，后续扫描、下载、推 SVN 流程与本地 Docker 打包一致。

## 注意事项

- 节点输出按 UTF-8 解码、GBK 回退；建议在脚本开头 `chcp 65001` 避免中文乱码。
- git 克隆统一带 `-c credential.helper=`：URL 已内嵌凭证，避免 git 调用 wincredman 持久化凭据导致 `unable to persist credentials` 报错。
- 取消任务时平台关闭 SSH 会话，远程进程随之终止。
- 日志展示不打印环境变量明文；git 克隆报错中的凭证 URL 会被替换为原始地址。
