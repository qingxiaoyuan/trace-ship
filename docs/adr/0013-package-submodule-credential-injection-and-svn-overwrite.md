# 0013 - 打包支持 Git 子模块拉取、脚本内 push 凭证注入与 SVN 覆盖式提交

**状态:** proposed
**日期:** 2026-08-19
**决策者:** 产品/研发团队
**关联规格:** 打包前拉取 git submodule、打包脚本内在子仓库执行 push、SVN 产物覆盖式提交的业务需求；代码评审（/code-review）要求将凭证可见性边界显式归档

## 背景

既有打包流程（见 0002）clone 源码时固定 `git clone --depth 1 --branch <tag>`，不拉取
子模块，且构建环境内没有任何 Git 凭证，打包脚本无法对（子）仓库执行 push；
SVN 产物推送只支持 `svn import` 新建版本目录，目录已存在即报错，无法覆盖更新
同一目录下的产物。业务上需要：

1. clone 时递归拉取 `.gitmodules` 子模块；
2. 打包脚本（custom_script / 镜像 pack.sh / 远程 pack.bat）内可自行 `git push`；
3. SVN 推送支持对已存在目录的覆盖式提交。

凭证注入会扩大凭证的可见范围（构建脚本、容器环境变量、节点工作副本），属于新的
安全边界决策，需显式记录。

## 决策

1. **子模块拉取**：`PackageConfig` 新增 `clone_submodules` 开关（默认关）。开启后
   本地与远程 Windows 的 clone 均追加 `--recurse-submodules`；主仓库保持
   `--depth 1` 浅克隆，**子模块不浅化**（完整克隆，保证后续可提交并 push）。
   仅支持子模块与主仓库在同一 GitLab 服务器、同一凭证可达的场景。
2. **脚本内 push 的凭证注入**：`PackageConfig` 新增 `inject_git_credential` 开关
   （默认关，由配置方显式开启并承担凭证可见性责任）。开启后：
   - 本地 Docker：把 `utils/git_askpass.sh` 复制到 `workspace/tmp`（容器内
     `/workspace/tmp`），以 `-e` 注入 `GIT_ASKPASS`、`TRACE_SHIP_GIT_USERNAME/
     PASSWORD`、`GIT_TERMINAL_PROMPT=0` 及 `GIT_AUTHOR/COMMITTER` 提交身份
     （取触发人昵称/邮箱）；日志展示对 `-e` 值全程掩码，凭证不进 build.log；
     开启但仓库无可用凭证时记日志并跳过注入。
   - 远程 Windows：clone 后把 `http.extraHeader` 认证头写入节点工作副本（含
     `submodule foreach --recursive` 全部子模块）的 `.git/config`；**构建阶段
     结束（无论成败）即执行 `git config --unset` 回收**，回收失败仅记日志；
     `cleanup_workspace` 开启时工作区整体删除作为最终兜底。
3. **SVN 覆盖式提交**：`PackageConfig` 新增 `svn_commit_mode`（`new_dir` 默认 /
   `overwrite`）。`new_dir` 行为完全不变；`overwrite` 下目标目录不存在仍走
   `import_path` 首次导入，已存在则走 `SVNProvider.sync_directory`：
   全量 checkout（`--ignore-externals`）→ 本地产物覆盖拷贝 → 新增 `svn add
   --force`、本地已删 `svn rm` → 有变更才 commit，远程目录最终与本地产物
   镜像一致（含删除远程多余文件）。

## 影响与兼容性

- 三个开关均为新增配置、默认关闭/默认 `new_dir`，历史配置与任务快照（经
  `_snapshot` 兼容默认值）行为完全不变。
- 凭证可见性边界：开启注入后，凭证对打包脚本明文可见（本地容器环境变量、
  远程节点 `.git/config`）；远程节点在构建后即回收认证头，缩短残留窗口。
- 覆盖式提交会**删除**远程目录中不存在于本次产物的文件，配置界面已明示风险。
- `sync_release_docs_to_svn` 的文档同步替换（0012）依赖 `stage_info.svn_push`
  的 `remote_url`，两种提交模式下该结构不变，文档同步在覆盖模式下继续可用。
- 新增迁移 `package.0021`（`clone_submodules` / `inject_git_credential` /
  `svn_commit_mode`）。

## 2026-08-28 演进

- 远程节点支持麒麟 Linux 后（见 0007 同日演进），凭证注入/回收约定被麒麟分支完整继承：
  clone 后向节点工作副本（含 `submodule foreach --recursive` 全部子模块）的 `.git/config`
  写入 `http.extraHeader`，构建结束（无论成败）即回收、`cleanup_workspace` 整体删除兜底。
- 麒麟侧差异：远程命令插值统一经 `shlex.quote`（替代 Windows 的 cmd 转义约定）；回收改用
  `git config --unset-all http.extraHeader`（覆盖键不存在与多值场景，较 Windows 的
  `--unset` 更稳），回收失败同样仅记日志。
