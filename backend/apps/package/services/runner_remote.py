"""
远程节点打包执行与产物回传

按任务快照中的 node_os_type 分发 Windows / 麒麟 Linux 两套 shell 语义；
旧快照没有 node_os_type 时按 Windows 兼容处理。
"""
import logging
from pathlib import PurePosixPath, PureWindowsPath

from apps.package.models import PackageTask
from apps.package.remote_base import RemoteSSHClient
from apps.package.remote_kylin import build_pack_run_script, sh_quote
from apps.package.remote_windows import RUN_LIMITED_PS1, cmd_quote
from utils.markdown_table import table_newlines_to_br

logger = logging.getLogger(__name__)


class RemoteRunnerMixin:
    """远程节点上的源码拉取、构建执行与产物回传。"""

    @staticmethod
    def _node_os_type(task: PackageTask) -> str:
        """任务快照中的节点 OS；旧快照无该键时按 windows 兼容处理。"""
        return ((task.config_snapshot or {}).get("node_os_type") or "windows").lower()

    @classmethod
    def _is_kylin(cls, task: PackageTask) -> bool:
        return cls._node_os_type(task) == "kylin"

    @classmethod
    def _remote_workspace(cls, task: PackageTask):
        """远程节点上该任务的工作目录（Windows 盘符路径 / 麒麟 POSIX 路径）。"""
        snapshot = task.config_snapshot or {}
        if cls._is_kylin(task):
            root = (snapshot.get("node_work_root") or "/data/trace-ship/workspaces").strip()
            return PurePosixPath(root) / str(task.id)
        root = (snapshot.get("node_work_root") or r"C:\trace-ship\workspaces").strip()
        return PureWindowsPath(root) / str(task.id)

    @classmethod
    def _checkout_source_remote(cls, task: PackageTask, client: RemoteSSHClient) -> None:
        """在远程节点上克隆源码（节点自行访问代码仓库）。"""
        snapshot = task.config_snapshot or {}
        kylin = cls._is_kylin(task)
        quote = sh_quote if kylin else cmd_quote
        remote_workspace = cls._remote_workspace(task)
        source_dir = remote_workspace / "source"
        clone_url = cls._clone_url(task.repository)
        auth_args = cls._auth_clone_args(task.repository, task.triggered_by, product=task.project)

        node_label = snapshot.get("node_name") or snapshot.get("node_host") or "远程节点"
        cls._append_log(task, f"[{node_label}] 远程工作目录: {remote_workspace}")
        clone_submodules = bool(snapshot.get("clone_submodules"))
        submodule_arg = " --recurse-submodules" if clone_submodules else ""
        cls._append_log(
            task,
            f'$ git clone --depth 1{submodule_arg} --branch {task.tag_name} {clone_url} "{source_dir}"',
        )

        def log_line(line: str) -> None:
            cls._append_log(task, cls._sanitize_log_line(line))

        # -c 参数逐个转义（extraHeader 值含空格）；credential.helper= 置空，
        # 避免 git 调用系统凭据管理器持久化凭据（SSH 会话下报错）
        git_args = ["-c", "credential.helper=", *auth_args]
        arg_parts = " ".join(quote(arg) for arg in git_args)
        client.mkdirs(remote_workspace, remote_workspace / "artifacts", remote_workspace / "tmp")
        # 清理历史残留，保证全新克隆
        client.remove_dir(source_dir)
        client.run_checked(
            f"git {arg_parts} clone --depth 1{submodule_arg} "
            f"--branch {quote(task.tag_name)} "
            f"{quote(clone_url)} {quote(str(source_dir))}",
            on_line=log_line,
            should_stop=lambda: cls._ensure_task_not_canceled(task),
            error_hint="节点需安装 git 且能访问代码仓库",
        )
        # 需要脚本内 push 时，把认证头持久化到节点工作副本的 .git/config（含子模块），
        # 打包脚本内 git push 可直接复用；凭证随 cleanup_workspace 清理工作区时一并删除
        if snapshot.get("inject_git_credential") and auth_args:
            header_value = next(
                (arg.split("=", 1)[1] for arg in auth_args if arg.startswith("http.extraHeader=")),
                "",
            )
            if header_value:
                client.run_checked(
                    f"git -C {quote(str(source_dir))} config http.extraHeader {quote(header_value)}",
                    on_line=log_line,
                    should_stop=lambda: cls._ensure_task_not_canceled(task),
                )
                if clone_submodules:
                    if kylin:
                        # 麒麟节点整条命令由 sh 解释，foreach 内层同样按 sh 转义
                        foreach_cmd = f"git config http.extraHeader {sh_quote(header_value)}"
                    else:
                        # Windows 上 foreach 命令在节点上由 Git Bash 的 sh -c 执行，内层必须用单引号：
                        # cmd_quote 的双引号转义（""）经 sshd → cmd /c → git.exe 参数解析后
                        # 会被吞掉，命令在空格处截断，sh 报 unexpected EOF（退出码 128）；
                        # 单引号对 cmd / git.exe 均透明，最终由 sh 解释。
                        foreach_cmd = f"git config http.extraHeader '{header_value}'"
                    # --quiet 抑制 foreach 回显命令本身，避免认证头明文进入构建日志。
                    client.run_checked(
                        f"git -C {quote(str(source_dir))} submodule foreach --recursive --quiet "
                        f"{quote(foreach_cmd)}",
                        on_line=log_line,
                        should_stop=lambda: cls._ensure_task_not_canceled(task),
                    )
                cls._append_log(task, "已将 Git 认证头写入节点工作副本，构建脚本可自行 git push")
        # 上传本次发布说明到源码根目录，供构建脚本读取（分支直打包无发布说明，跳过）
        if task.release_id:
            doc_path = source_dir / f"release-{cls._doc_filename(task.version)}.md"
            client.upload_text(doc_path, table_newlines_to_br(task.release.release_doc or ""))
            cls._append_log(task, f"已将发布说明写入源码根目录: {doc_path}")
        else:
            cls._append_log(task, "分支直打包：无发布说明，跳过上传")

    @classmethod
    def _revoke_remote_git_credential(cls, task: PackageTask, client: RemoteSSHClient) -> None:
        """回收远程节点工作副本中持久化的 Git 认证头（构建结束后调用）。

        认证头仅为构建脚本内 git push 临时写入 .git/config（含子模块），构建结束即移除，
        避免 cleanup_workspace 关闭时凭证长期残留节点。清理失败仅记日志，不影响任务结果。
        """
        snapshot = task.config_snapshot or {}
        if not snapshot.get("inject_git_credential"):
            return
        kylin = cls._is_kylin(task)
        quote = sh_quote if kylin else cmd_quote
        # 麒麟用 --unset-all 一次清掉同名多值；unset 系列在键不存在时退出码非零，
        # client.run 忽略退出码即可
        unset_flag = "--unset-all" if kylin else "--unset"
        source_dir = cls._remote_workspace(task) / "source"
        try:
            client.run(f"git -C {quote(str(source_dir))} config {unset_flag} http.extraHeader")
            if snapshot.get("clone_submodules"):
                # foreach 命令由 sh 执行，|| true 容忍子模块未写入认证头的情况
                client.run(
                    f"git -C {quote(str(source_dir))} submodule foreach --recursive "
                    f"{quote(f'git config {unset_flag} http.extraHeader || true')}"
                )
            cls._append_log(task, "已回收远程节点工作副本中的 Git 认证头")
        except Exception as exc:
            cls._append_log(task, f"警告：回收节点 Git 认证头失败（不影响任务结果）: {exc}")

    @staticmethod
    def _affinity_mask(cores: int) -> str:
        """CPU 核数转 start /affinity 的十六进制掩码（取低 N 位）。"""
        return format((1 << cores) - 1, "X")

    @staticmethod
    def _resource_limits(snapshot: dict) -> tuple[int, str, int]:
        """读取资源限制生效值（核数 / 优先级 / 内存上限 MB）。

        配置级优先、未设置跟随节点（快照已合并生效值）；
        兼容旧快照中的 node_cpu_* 键。
        """
        cores = int(snapshot.get("cpu_cores") or snapshot.get("node_cpu_cores") or 0)
        priority = (
            snapshot.get("cpu_priority") or snapshot.get("node_cpu_priority") or "normal"
        ).lower()
        mem_mb = int(snapshot.get("mem_limit_mb") or 0)
        return cores, priority, mem_mb

    @classmethod
    def _run_remote_build(cls, task: PackageTask, client: RemoteSSHClient) -> None:
        """在远程节点上执行打包脚本（按节点 OS 分发 Windows / 麒麟实现）。"""
        if cls._is_kylin(task):
            cls._run_remote_build_kylin(task, client)
            return
        cls._run_remote_build_windows(task, client)

    @classmethod
    def _run_remote_build_windows(cls, task: PackageTask, client: RemoteSSHClient) -> None:
        """在远程 Windows 节点上执行打包脚本。

        自定义脚本上传到节点临时目录，未配置时调用源码根目录 pack.bat。
        所有路径均通过 pack-run.bat 注入环境变量并透传目标脚本最终退出码，
        资源限制仅改变该包装脚本的启动方式。
        """
        snapshot = task.config_snapshot or {}
        custom_script = (snapshot.get("custom_script") or "").strip()
        remote_workspace = cls._remote_workspace(task)
        source_dir = remote_workspace / "source"
        env = cls._build_env(task, remote_workspace)
        build_path = env["BUILD_PATH"]
        work_dir = source_dir if build_path == "." else source_dir / PureWindowsPath(build_path)
        cores, priority, mem_mb = cls._resource_limits(snapshot)
        limited = cores > 0 or mem_mb > 0 or priority in ("belownormal", "low")

        run_script = remote_workspace / "tmp" / "pack-run.bat"
        bat_lines = [
            "@echo off",
            f"cd /d {cmd_quote(str(work_dir))} || exit /b 1",
            *[f'set "{key}={value}"' for key, value in env.items()],
            # 隐藏平台注入的敏感环境变量，但保留用户脚本的命令回显，便于排查。
            "@echo on",
        ]
        if custom_script:
            script_path = remote_workspace / "tmp" / "pack-custom.bat"
            client.upload_text(script_path, custom_script)
            bat_lines.append(f"call {cmd_quote(str(script_path))}")
            error_hint = ""
        else:
            bat_lines.append(f"call {cmd_quote(str(source_dir / 'pack.bat'))}")
            error_hint = "未配置自定义脚本时，源码根目录需提供 pack.bat 入口"
        # 在独立行保存退出码，避免后续包装命令覆盖目标脚本的结果。
        bat_lines.extend([
            '@set "TRACE_SHIP_EXIT_CODE=%errorlevel%"',
            "@exit /b %TRACE_SHIP_EXIT_CODE%",
        ])
        client.upload_text(run_script, "\n".join(bat_lines))

        if not limited:
            cls._append_log(
                task,
                f'$ call "{run_script}"  <注入 {len(env)} 个环境变量>',
            )
            client.run_checked(
                f"call {cmd_quote(str(run_script))}",
                on_line=lambda line: cls._append_log(task, cls._sanitize_log_line(line)),
                should_stop=lambda: cls._ensure_task_not_canceled(task),
                error_hint=error_hint,
            )
            return

        # 内存上限需要作业对象（PowerShell 包装脚本），优先级/核数在其中一并生效；
        # 仅 CPU 限制时用 start /wait 即可，无需节点侧脚本
        if mem_mb > 0:
            ps1_path = remote_workspace.parent / "bin" / "run-limited.ps1"
            client.upload_text(ps1_path, RUN_LIMITED_PS1)
            ps_priority = {"normal": "Normal", "belownormal": "BelowNormal", "low": "Idle"}.get(priority, "Normal")
            limit_desc = [f"内存 {mem_mb}MB"]
            if cores > 0:
                limit_desc.append(f"核数 {cores}")
            if priority in ("belownormal", "low"):
                limit_desc.append(f"优先级 {priority}")
            cls._append_log(
                task,
                f'$ powershell -File "{ps1_path}" -MemMB {mem_mb} -Cores {cores} -Priority {ps_priority}'
                f' -Script "{run_script}"  <注入 {len(env)} 个环境变量，{ "、".join(limit_desc) }>',
            )
            client.run_checked(
                f"powershell -NoProfile -ExecutionPolicy Bypass -File {cmd_quote(str(ps1_path))}"
                f" -MemMB {mem_mb} -Cores {cores} -Priority {ps_priority}"
                f" -Script {cmd_quote(str(run_script))}",
                on_line=lambda line: cls._append_log(task, cls._sanitize_log_line(line)),
                should_stop=lambda: cls._ensure_task_not_canceled(task),
                error_hint=error_hint,
            )
            return

        # /b 不创建新窗口，子进程输出继承 SSH 管道，构建日志才能回传平台
        start_args = 'start "" /b /wait'
        if priority in ("belownormal", "low"):
            start_args += f" /{priority}"
        if cores > 0:
            start_args += f" /affinity {cls._affinity_mask(cores)}"
        limit_desc = []
        if priority in ("belownormal", "low"):
            limit_desc.append(f"优先级 {priority}")
        if cores > 0:
            limit_desc.append(f"核数 {cores}")
        cls._append_log(
            task,
            f'$ {start_args} cmd /c "{run_script}"  <注入 {len(env)} 个环境变量，{ "、".join(limit_desc) }>',
        )
        client.run_checked(
            f"{start_args} cmd /c {cmd_quote(str(run_script))}",
            on_line=lambda line: cls._append_log(task, cls._sanitize_log_line(line)),
            should_stop=lambda: cls._ensure_task_not_canceled(task),
            error_hint=error_hint,
        )

    @classmethod
    def _run_remote_build_kylin(cls, task: PackageTask, client: RemoteSSHClient) -> None:
        """在麒麟 Linux 节点上执行打包脚本。

        自定义脚本上传为 pack-custom.sh，未配置时调用源码根目录 pack.sh；
        统一经 pack-run.sh 注入环境变量并施加资源限制（ulimit/taskset/nice），
        目标脚本以 sh -e 执行，退出码透传给平台判定。
        """
        snapshot = task.config_snapshot or {}
        custom_script = (snapshot.get("custom_script") or "").strip()
        remote_workspace = cls._remote_workspace(task)
        source_dir = remote_workspace / "source"
        env = cls._build_env(task, remote_workspace)
        build_path = env["BUILD_PATH"]
        work_dir = source_dir if build_path == "." else source_dir / PurePosixPath(build_path)
        cores, priority, mem_mb = cls._resource_limits(snapshot)

        if custom_script:
            target_script = remote_workspace / "tmp" / "pack-custom.sh"
            client.upload_text(target_script, custom_script)
            error_hint = ""
        else:
            target_script = source_dir / "pack.sh"
            error_hint = "未配置自定义脚本时，源码根目录需提供 pack.sh 入口"
        run_script = remote_workspace / "tmp" / "pack-run.sh"
        client.upload_text(
            run_script,
            build_pack_run_script(work_dir, env, target_script, cores, priority, mem_mb),
        )

        limit_desc = []
        if mem_mb > 0:
            limit_desc.append(f"内存 {mem_mb}MB")
        if cores > 0:
            limit_desc.append(f"核数 {cores}")
        if priority in ("belownormal", "low"):
            limit_desc.append(f"优先级 {priority}")
        limit_suffix = f"，{'、'.join(limit_desc)}" if limit_desc else ""
        cls._append_log(
            task,
            f'$ sh -e "{run_script}"  <注入 {len(env)} 个环境变量{limit_suffix}>',
        )
        client.run_checked(
            f"sh -e {sh_quote(str(run_script))}",
            on_line=lambda line: cls._append_log(task, cls._sanitize_log_line(line)),
            should_stop=lambda: cls._ensure_task_not_canceled(task),
            error_hint=error_hint,
        )

    @classmethod
    def _collect_remote_artifacts(cls, task: PackageTask, workspace, client: RemoteSSHClient) -> None:
        """将远程节点产物回传到本地工作区，按配置清理远程工作目录。"""
        snapshot = task.config_snapshot or {}
        remote_workspace = cls._remote_workspace(task)
        count = client.download_dir(remote_workspace / "artifacts", workspace / "artifacts")
        if snapshot.get("cleanup_workspace", True):
            client.remove_dir(remote_workspace)
            cls._append_log(task, f"已回传 {count} 个产物文件，远程工作目录已清理")
        else:
            cls._append_log(task, f"已回传 {count} 个产物文件，远程工作目录已保留（{remote_workspace}）")

    @classmethod
    def _collect_output_remote(cls, task: PackageTask, client: RemoteSSHClient) -> None:
        """远程打包：构建后在节点上把产物目录内容拷贝到 artifacts。"""
        if cls._is_kylin(task):
            cls._collect_output_remote_kylin(task, client)
            return
        cls._collect_output_remote_windows(task, client)

    @classmethod
    def _collect_output_remote_windows(cls, task: PackageTask, client: RemoteSSHClient) -> None:
        """Windows 节点产物归集：robocopy 拷贝，或系统自带 tar 压缩为 zip。

        快照开启 auto_compress 时，用节点系统自带 tar（Win10 1803+ / Server 2019+
        内置）把产物目录内所有内容压缩为单个 zip 压缩包（命名：软件名-版本-日期）。
        """
        snapshot = task.config_snapshot or {}
        remote_workspace = cls._remote_workspace(task)
        rel_dir = cls._output_dir_rel(snapshot)
        src = remote_workspace / "source" / PureWindowsPath(rel_dir)
        dst = remote_workspace / "artifacts"
        cls._append_log(task, f"正在收集产物目录 source\\{rel_dir} -> artifacts…")
        src_quoted = cmd_quote(str(src))
        dst_quoted = cmd_quote(str(dst))
        if bool(snapshot.get("auto_compress")):
            archive_name = f"{cls._archive_stem(task)}.zip"
            client.run_checked(
                # tar -a 按扩展名自动识别格式（.zip → zip）；-C src . 归档目录内容本身；
                # 产物目录不存在时提示后正常结束，与本地跳过行为一致
                f"if exist {src_quoted} "
                f"(tar -a -c -f {cmd_quote(str(dst / archive_name))} -C {src_quoted} . "
                f"& if errorlevel 1 exit /b 1 & exit /b 0) "
                f"else (echo 产物目录不存在: {src})",
                on_line=lambda line: cls._append_log(task, cls._sanitize_log_line(line)),
                should_stop=lambda: cls._ensure_task_not_canceled(task),
                error_hint="产物自动压缩失败",
            )
            cls._append_log(task, f"已自动压缩产物为单个压缩包（source\\{rel_dir} → {archive_name}）")
            return
        copy_cmd = f"robocopy {src_quoted} {dst_quoted} /e /r:1 /w:1 /njh /njs /np"
        client.run_checked(
            # robocopy 默认复制源目录内容（不含目录名本身），与本地 rglob 行为一致；
            # 退出码 < 8 均为成功（0=无文件，1=已复制，2=有额外文件，4=有不匹配），
            # >= 8 才是失败；/r:1 /w:1 避免默认百万次重试卡住 SSH 会话；
            # robocopy 成功也返回非零（1/2/4），必须显式 exit /b 0 归零，
            # 否则 run_checked 会把 1 误判为失败
            f"if exist {src_quoted} "
            f"({copy_cmd} "
            f"& if errorlevel 8 exit /b 1 & exit /b 0) "
            f"else (echo 产物目录不存在: {src})",
            on_line=lambda line: cls._append_log(task, cls._sanitize_log_line(line)),
            should_stop=lambda: cls._ensure_task_not_canceled(task),
            error_hint="产物自动收集失败",
        )

    @classmethod
    def _collect_output_remote_kylin(cls, task: PackageTask, client: RemoteSSHClient) -> None:
        """麒麟节点产物归集：cp -r 拷贝，或节点自带 tar 压缩为 .tar.gz。

        快照开启 auto_compress 时，用 tar -czf 把产物目录内所有内容压缩为
        单个 .tar.gz 压缩包（命名：软件名-版本-日期）。
        """
        snapshot = task.config_snapshot or {}
        remote_workspace = cls._remote_workspace(task)
        rel_dir = cls._output_dir_rel(snapshot)
        src = remote_workspace / "source" / PurePosixPath(rel_dir)
        dst = remote_workspace / "artifacts"
        cls._append_log(task, f"正在收集产物目录 source/{rel_dir} -> artifacts…")
        src_quoted = sh_quote(str(src))
        dst_quoted = sh_quote(str(dst))
        if bool(snapshot.get("auto_compress")):
            archive_name = f"{cls._archive_stem(task)}.tar.gz"
            client.run_checked(
                # -C src . 归档目录内容本身；产物目录不存在时提示后正常结束，与本地跳过行为一致
                f"if [ -d {src_quoted} ]; then "
                f"tar -czf {sh_quote(str(dst / archive_name))} -C {src_quoted} .; "
                f"else echo 产物目录不存在: {src}; fi",
                on_line=lambda line: cls._append_log(task, cls._sanitize_log_line(line)),
                should_stop=lambda: cls._ensure_task_not_canceled(task),
                error_hint="产物自动压缩失败",
            )
            cls._append_log(task, f"已自动压缩产物为单个压缩包（source/{rel_dir} → {archive_name}）")
            return
        client.run_checked(
            # cp -r src/. dst/ 复制源目录内容（不含目录名本身），与本地 rglob 行为一致
            f"if [ -d {src_quoted} ]; then "
            f"cp -r {src_quoted}/. {dst_quoted}/; "
            f"else echo 产物目录不存在: {src}; fi",
            on_line=lambda line: cls._append_log(task, cls._sanitize_log_line(line)),
            should_stop=lambda: cls._ensure_task_not_canceled(task),
            error_hint="产物自动收集失败",
        )
