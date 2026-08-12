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
| `RELEASE_DOC_PATH` | 源码根目录下本次发布说明 MD 的完整路径（`release-{version}.md`） |
| `DEPLOY_DIR` / `SCRIPTS_DIR` | 预留目录（节点可自行使用） |
| 自定义环境变量 | 打包配置中的 `env_vars` |

平台拉取源码后会向源码根目录写入本次发布说明 `release-{version}.md`（单元格内换行转 `<br>`），构建脚本可直接通过 `%RELEASE_DOC_PATH%` 读取该文件。

产物写入 `%ARTIFACTS_DIR%`（即 `{task}\artifacts`）后，平台经 SFTP 回传到本地工作区，后续扫描、下载、推 SVN 流程与本地 Docker 打包一致。

## 资源限制（防止打包占满节点）

节点支持 CPU 资源限制，打包配置可进一步覆盖并追加内存上限：

| 层级 | 配置 | 说明 |
|---|---|---|
| 节点 | 构建可用 CPU 核数 | 通过 `start /affinity` 掩码把构建进程树限定在低 N 核（建议总核数-1） |
| 节点 | 构建进程 CPU 优先级 | `低于正常`（默认推荐）/ `低`；即使 CPU 跑满，sshd 与系统进程仍优先调度，SSH 不断连 |
| 打包配置 | CPU 核数 / 优先级 | 留空（0/跟随节点）时用节点配置，填写后覆盖节点 |
| 打包配置 | 内存上限 (MB) | 0 为不限；>0 时平台上传 `run-limited.ps1`（作业对象 JOB_MEMORY 硬上限，覆盖整棵进程树），并以 PowerShell 包装执行 |

原理：Windows 下进程优先级与亲和性会被整棵子进程树继承，MSBuild/pnpm 派生的子进程同样受限；内存上限通过作业对象实现，KILL_ON_JOB_CLOSE 保证取消时整树回收。配置了任一限制时，平台将构建命令写入 `pack-run.bat` 再包装执行，退出码正常透传。

推荐组合：`最大并发数 = 1` + `低于正常` 优先级 + 核数 = 总核数-1，打包期间节点保持可用。

## 注意事项

- 节点输出按 UTF-8 解码、GBK 回退；建议在脚本开头 `chcp 65001` 避免中文乱码。
- git 克隆统一带 `-c credential.helper=`：URL 已内嵌凭证，避免 git 调用 wincredman 持久化凭据导致 `unable to persist credentials` 报错。
- 取消任务时平台关闭 SSH 会话，远程进程随之终止。
- 日志展示不打印环境变量明文；git 克隆报错中的凭证 URL 会被替换为原始地址。
