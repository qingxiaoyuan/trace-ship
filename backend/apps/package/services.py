"""
系统内置打包业务服务
"""
import base64
import hashlib
import logging
import os
import signal
import re
import select
import shutil
import subprocess
import threading
from pathlib import Path, PureWindowsPath
from typing import Any

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone
from rest_framework import serializers

from apps.credential.models import Credential
from apps.package.models import PackageConfig, PackageNode, PackageTask
from apps.package.remote_windows import (
    RUN_LIMITED_PS1,
    RemoteWindowsClient,
    build_set_env_prefix,
    cmd_quote,
)
from apps.repository.serializers import RepositorySerializer
from utils.markdown_table import table_newlines_to_br
from utils.provider.credential_resolver import resolve_credential
from utils.provider.factory import get_provider


logger = logging.getLogger(__name__)
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SECRET_ENV_RE = re.compile(r"(TOKEN|PASSWORD|PASSWD|SECRET|KEY|CREDENTIAL|AUTH)", re.IGNORECASE)


class PackageTaskCanceledError(RuntimeError):
    """打包任务已取消。"""


class PackageService:
    """打包配置解析、任务创建与任务执行服务。"""

    @staticmethod
    def workspace_root() -> Path:
        """返回打包工作区根目录。"""
        root = getattr(settings, "PACKAGE_WORKSPACE_ROOT", None)
        return Path(root or Path(settings.BASE_DIR) / "package_workspaces")

    @staticmethod
    def _safe_rel_path(value: str, default: str = ".") -> str:
        """归一化相对路径，禁止绝对路径与上跳路径。"""
        path = (value or default or ".").strip().replace("\\", "/").strip("/")
        if not path:
            return "."
        parts = [part for part in path.split("/") if part and part != "."]
        if any(part == ".." for part in parts):
            raise serializers.ValidationError({"path": "构建目录和输出目录不能包含 .."})
        return "/".join(parts) if parts else "."

    @staticmethod
    def _clone_url(repo) -> str:
        """返回仓库克隆地址。"""
        return RepositorySerializer().get_clone_url(repo)

    @staticmethod
    def _build_auth_env(repo, request_user=None) -> dict[str, str]:
        """解析仓库凭证为 Git 可用的环境变量。

        GitLab Token 通过 HTTP(S) 克隆时，git 需要用户名+密码做 Basic 认证。
        GitLab 个人访问令牌的默认用户名为 ``oauth2``；部署令牌/项目访问令牌
        可在凭证 username 字段填写对应用户名覆盖默认值。
        """
        data = resolve_credential(repo, request_user)
        env: dict[str, str] = {}
        username = data.get("username") or ""
        token = data.get("token") or data.get("password") or ""

        # GitLab Token 通过 HTTP 克隆时，默认用户名为 oauth2
        if not username and token:
            username = "oauth2"

        if username:
            env["TRACE_SHIP_GIT_USERNAME"] = str(username)
        if token:
            env["TRACE_SHIP_GIT_PASSWORD"] = str(token)
            env["GIT_ASKPASS"] = str(Path(settings.BASE_DIR) / "utils" / "git_askpass.sh")
        return env

    @classmethod
    def _snapshot(cls, config: PackageConfig) -> dict[str, Any]:
        """生成配置快照，避免执行时配置变更影响历史任务。"""
        image = config.image
        node = config.node
        return {
            "config_id": str(config.id),
            "name": config.name,
            "executor_type": config.executor_type or "local_docker",
            "image": image.image if image else "",
            "image_name": image.name if image else "",
            "script_entry": image.script_entry if image else "",
            "node_id": str(node.id) if node else None,
            "node_name": node.name if node else "",
            "node_host": node.host if node else "",
            "node_port": node.port if node else 22,
            "node_work_root": node.work_root if node else "",
            "node_credential_id": str(node.credential_id) if node and node.credential_id else None,
            # 资源限制生效值：配置级优先，未设置（0/空串）时跟随节点；内存上限仅配置级
            "cpu_cores": config.cpu_cores or (node.cpu_cores if node else 0),
            "cpu_priority": config.cpu_priority
            or (node.cpu_priority if node else "")
            or "belownormal",
            "mem_limit_mb": config.mem_limit_mb or 0,
            "custom_script": config.custom_script,
            "build_path": cls._safe_rel_path(
                config.build_path,
                image.default_build_path if image else ".",
            ),
            "output_path": cls._safe_rel_path(
                config.output_path,
                image.default_output_path if image else "artifacts",
            ),
            "auto_collect_output": bool(config.auto_collect_output),
            "cleanup_workspace": config.cleanup_workspace,
            "env_vars": config.env_vars or {},
            "svn_push_enabled": config.svn_push_enabled,
            "svn_url": config.svn_url or "",
            "svn_credential_id": str(config.svn_credential_id) if config.svn_credential_id else None,
            "svn_path_template": config.svn_path_template or "{version}",
        }

    @classmethod
    def create_task_for_release(cls, config: PackageConfig, release, request_user=None) -> PackageTask:
        """为已发布版本创建打包任务。"""
        if release.status != "released":
            raise serializers.ValidationError({"release": "只有已发布版本才能触发打包"})
        if not config.is_active:
            raise serializers.ValidationError({"config": "打包配置已停用"})
        if config.repository_id != release.repository_id:
            raise serializers.ValidationError({"repository": "打包配置与发布仓库不一致"})

        snapshot = cls._snapshot(config)
        task = PackageTask.objects.create(
            config=config,
            release=release,
            project=release.project,
            repository=release.repository,
            triggered_by=request_user,
            name=f"{config.name} / {release.version}",
            tag_name=release.tag_name,
            version=release.version,
            release_type=release.release_type,
            commit_hash=release.git_hash,
            config_snapshot=snapshot,
        )
        cls.dispatch_task(task)
        return task

    @classmethod
    def dispatch_task(cls, task: PackageTask) -> None:
        """投递打包任务；Celery 不可用时降级为本进程后台执行。"""
        from apps.package.tasks import run_package_task

        try:
            run_package_task.delay(str(task.id))
        except Exception as exc:
            logger.warning("Celery 投递失败，改用本地后台线程执行打包 task_id=%s error=%s", task.id, exc)
            cls._start_local_worker(str(task.id), str(exc))

    # 节点并发占满时的重投间隔（秒）
    NODE_WAIT_RETRY_SECONDS = 30

    @classmethod
    def node_slot_available(cls, task: PackageTask) -> tuple[bool, int, int]:
        """检查远程节点是否有空闲并发槽位。

        Returns:
            (available, running_count, max_concurrency)；
            本地 Docker 任务、未绑定节点的任务、节点已删除的兜底场景直接放行。
        """
        snapshot = task.config_snapshot or {}
        if (snapshot.get("executor_type") or "local_docker") != "remote_windows":
            return True, 0, 0
        node_id = snapshot.get("node_id")
        if not node_id:
            return True, 0, 0
        try:
            node = PackageNode.objects.get(id=node_id)
            max_concurrency = max(1, node.max_concurrency or 1)
        except PackageNode.DoesNotExist:
            max_concurrency = 1
        running = (
            PackageTask.objects.filter(status="running", config_snapshot__node_id=str(node_id))
            .exclude(id=task.id)
            .count()
        )
        return running < max_concurrency, running, max_concurrency

    @classmethod
    def run_task_with_gate(cls, task: PackageTask) -> None:
        """带节点并发闸门的任务入口：无空闲槽位时保持排队并延迟重投。"""
        if task.is_finished:
            return
        available, running, max_concurrency = cls.node_slot_available(task)
        if available:
            cls.run_task(task)
            return
        # 排队等待：写日志与阶段标记，延迟后重新投递（不直接失败）
        if not task.workspace_path:
            cls.prepare_workspace(task)
        task.stage_info = {
            "stage": "waiting_node",
            "progress": 0,
            "running": running,
            "max_concurrency": max_concurrency,
        }
        task.save(update_fields=["stage_info", "updated_at"])
        cls._append_log(task, f"节点并发已满（{running}/{max_concurrency}），排队等待空闲槽位…")
        cls._redispatch_delayed(task)

    @classmethod
    def _redispatch_delayed(cls, task: PackageTask) -> None:
        """延迟重投任务；Celery 不可用时用后台线程等待后重试。"""
        from apps.package.tasks import run_package_task

        try:
            run_package_task.apply_async(
                args=[str(task.id)], countdown=cls.NODE_WAIT_RETRY_SECONDS,
            )
        except Exception as exc:
            logger.warning("Celery 延迟重投失败，改用本地后台线程等待 task_id=%s error=%s", task.id, exc)
            cls._start_local_worker(str(task.id), delay=cls.NODE_WAIT_RETRY_SECONDS)

    @classmethod
    def _start_local_worker(cls, task_id: str, reason: str = "", delay: int = 0) -> None:
        """在当前后端进程中启动后台线程执行打包任务。"""

        def runner() -> None:
            if delay > 0:
                threading.Event().wait(delay)
            close_old_connections()
            try:
                task = PackageTask.objects.select_related(
                    "config", "release", "project", "repository", "triggered_by",
                ).get(id=task_id)
                if reason:
                    cls.prepare_workspace(task)
                    cls._append_log(task, f"Celery 不可用，已降级为本地后台执行: {reason}")
                cls.run_task_with_gate(task)
            except PackageTask.DoesNotExist:
                logger.warning("本地后台执行打包时任务不存在 task_id=%s", task_id)
            except Exception:
                logger.exception("本地后台执行打包异常 task_id=%s", task_id)
            finally:
                close_old_connections()

        thread = threading.Thread(target=runner, name=f"package-task-{task_id}", daemon=True)
        thread.start()

    @classmethod
    def trigger_auto_packages_for_release(cls, release, request_user=None) -> list[PackageTask]:
        """发布推 tag 成功后触发同仓库启用的自动打包配置。"""
        configs = PackageConfig.objects.filter(
            repository=release.repository,
            auto_package_on_release=True,
            is_active=True,
        ).select_related("project", "repository", "image", "node")
        tasks = []
        for config in configs:
            tasks.append(cls.create_task_for_release(config, release, request_user=request_user))
        return tasks

    @classmethod
    def prepare_workspace(cls, task: PackageTask) -> Path:
        """为任务创建隔离工作区。"""
        day = timezone.localtime(timezone.now()).strftime("%Y%m%d")
        workspace = cls.workspace_root() / day / str(task.id)
        source = workspace / "source"
        artifacts = workspace / "artifacts"
        logs = workspace / "logs"
        tmp = workspace / "tmp"
        for path in (source, artifacts, logs, tmp):
            path.mkdir(parents=True, exist_ok=True)
        task.workspace_path = str(workspace)
        task.log_path = str(logs / "build.log")
        task.save(update_fields=["workspace_path", "log_path", "updated_at"])
        return workspace

    @staticmethod
    def _append_log(task: PackageTask, content: str) -> None:
        """追加任务日志。"""
        if not task.log_path:
            return
        Path(task.log_path).parent.mkdir(parents=True, exist_ok=True)
        with open(task.log_path, "a", encoding="utf-8") as f:
            f.write(content)
            if content and not content.endswith("\n"):
                f.write("\n")

    # ANSI 转义序列：CSI（颜色/光标控制）、OSC（标题等）、单字符序列
    ANSI_ESCAPE_RE = re.compile(
        r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])"
    )

    @classmethod
    def _sanitize_log_line(cls, line: str) -> str:
        """
        清理打包输出中的乱码来源

        容器以伪终端（-t）运行时，npm/vite 等工具会输出 ANSI 颜色与
        光标控制序列、以及 \r 进度覆盖，直接写入日志会显示为乱码：
        - \r 进度覆盖：只保留最后一段有效文本
        - ANSI 转义序列：整体剥离
        - 其他控制字符：剔除（保留 \t 与 \n）
        """
        if "\r" in line:
            line = line.split("\r")[-1]
        line = cls.ANSI_ESCAPE_RE.sub("", line)
        return "".join(ch for ch in line if ch in ("\t", "\n") or ch >= " ")

    @classmethod
    def _run_command(
        cls,
        task: PackageTask,
        command: list[str],
        cwd: Path,
        env: dict[str, str] | None = None,
        shell: bool = False,
    ) -> None:
        """执行命令并把输出写入日志。"""
        cls._append_log(task, f"$ {cls._display_command(command, shell=shell)}")
        process = subprocess.Popen(
            command if not shell else command[0],
            cwd=str(cwd),
            env={**os.environ, **(env or {})},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            shell=shell,
            start_new_session=True,
        )
        assert process.stdout is not None
        try:
            while True:
                cls._ensure_task_not_canceled(task)
                ready, _, _ = select.select([process.stdout], [], [], 0.5)
                if ready:
                    line = process.stdout.readline()
                    if line:
                        # TTY 模式下输出为 \r\n，剥离回车与 ANSI 转义避免日志乱码
                        cls._append_log(task, cls._sanitize_log_line(line.rstrip("\r\n")))
                        continue
                code = process.poll()
                if code is not None:
                    break
        except PackageTaskCanceledError:
            cls._terminate_process_group(process)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls._kill_process_group(process)
                process.wait(timeout=5)
            raise
        if code != 0:
            raise RuntimeError(f"命令执行失败，退出码 {code}")

    @staticmethod
    def _terminate_process_group(process: subprocess.Popen) -> None:
        """终止整个进程组，避免子进程继续执行。"""
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    @staticmethod
    def _kill_process_group(process: subprocess.Popen) -> None:
        """强制杀死整个进程组。"""
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    @staticmethod
    def _display_command(command: list[str], shell: bool = False) -> str:
        """返回用于日志展示的命令，避免泄露环境变量敏感值。"""
        if shell:
            return command[0]

        display: list[str] = []
        mask_next_env = False
        for item in command:
            if mask_next_env:
                name, sep, value = item.partition("=")
                if sep and (value or SECRET_ENV_RE.search(name)):
                    display.append(f"{name}=******")
                else:
                    display.append(item)
                mask_next_env = False
                continue
            display.append(item)
            if item in ("-e", "--env"):
                mask_next_env = True
        return " ".join(display)

    @classmethod
    def _checkout_source(cls, task: PackageTask, workspace: Path) -> None:
        """克隆仓库并 checkout 到发布 tag。"""
        source_dir = workspace / "source"
        if any(source_dir.iterdir()):
            shutil.rmtree(source_dir)
            source_dir.mkdir(parents=True, exist_ok=True)
        clone_url = cls._clone_url(task.repository)
        env = cls._build_auth_env(task.repository, task.triggered_by)
        cls._run_command(task, ["git", "clone", "--depth", "1", "--branch", task.tag_name, clone_url, str(source_dir)], workspace, env)

    @staticmethod
    def _auth_clone_args(repo, request_user=None) -> list[str]:
        """生成 git 认证参数（http.extraHeader Basic 头）。

        不把凭证编进克隆 URL：URL 编码产生的 %XX 会被 cmd 的 %var% 展开破坏，
        且会触发 wincredman 持久化报错。base64 字符集（A-Za-z0-9+/=）对 cmd 安全，
        也不会出现在报错回显中。
        """
        data = resolve_credential(repo, request_user)
        username = data.get("username") or ""
        token = data.get("token") or data.get("password") or ""
        if not token:
            return []
        if not username:
            username = "oauth2"
        raw = base64.b64encode(f"{username}:{token}".encode("utf-8")).decode("ascii")
        return ["-c", f"http.extraHeader=Authorization: Basic {raw}"]

    @staticmethod
    def _remote_workspace(task: PackageTask) -> PureWindowsPath:
        """远程节点上该任务的工作目录。"""
        snapshot = task.config_snapshot or {}
        root = (snapshot.get("node_work_root") or r"C:\trace-ship\workspaces").strip()
        return PureWindowsPath(root) / str(task.id)

    @classmethod
    def _build_env(cls, task: PackageTask, workspace) -> dict[str, str]:
        """构建打包执行环境变量（workspace 可为本地 Path 或远程 PureWindowsPath）。"""
        snapshot = task.config_snapshot or {}
        env_vars = snapshot.get("env_vars") if isinstance(snapshot.get("env_vars"), dict) else {}
        return {
            **{str(k): str(v) for k, v in env_vars.items()},
            "TAG_NAME": task.tag_name,
            "VERSION": task.version,
            "BUILD_PATH": cls._safe_rel_path(snapshot.get("build_path", "."), "."),
            "OUTPUT_PATH": cls._safe_rel_path(snapshot.get("output_path", "artifacts"), "artifacts"),
            "PROJECT_CODE": task.project.code or task.project.name,
            "WORKSPACE": str(workspace),
            "SOURCE_DIR": str(workspace / "source"),
            "ARTIFACTS_DIR": str(workspace / "artifacts"),
            "DEPLOY_DIR": str(workspace / "deploy"),
            "SCRIPTS_DIR": str(workspace / "scripts"),
            "TMPDIR": str(workspace / "tmp"),
        }

    @classmethod
    def _checkout_source_remote(cls, task: PackageTask, client: RemoteWindowsClient) -> None:
        """在远程 Windows 节点上克隆源码（节点自行访问代码仓库）。"""
        snapshot = task.config_snapshot or {}
        remote_workspace = cls._remote_workspace(task)
        source_dir = remote_workspace / "source"
        clone_url = cls._clone_url(task.repository)
        auth_args = cls._auth_clone_args(task.repository, task.triggered_by)

        node_label = snapshot.get("node_name") or snapshot.get("node_host") or "远程节点"
        cls._append_log(task, f"[{node_label}] 远程工作目录: {remote_workspace}")
        cls._append_log(
            task,
            f'$ git clone --depth 1 --branch {task.tag_name} {clone_url} "{source_dir}"',
        )

        def log_line(line: str) -> None:
            cls._append_log(task, cls._sanitize_log_line(line))

        # -c 参数逐个 cmd_quote（extraHeader 值含空格）；credential.helper= 置空，
        # 避免 git 调用 wincredman 持久化凭据（SSH 会话下报错）
        git_args = ["-c", "credential.helper=", *auth_args]
        arg_parts = " ".join(cmd_quote(arg) for arg in git_args)
        client.mkdirs(remote_workspace, remote_workspace / "artifacts", remote_workspace / "tmp")
        # 清理历史残留，保证全新克隆
        client.remove_dir(source_dir)
        client.run_checked(
            f"git {arg_parts} clone --depth 1 "
            f"--branch {cmd_quote(task.tag_name)} "
            f"{cmd_quote(clone_url)} {cmd_quote(str(source_dir))}",
            on_line=log_line,
            should_stop=lambda: cls._ensure_task_not_canceled(task),
            error_hint="节点需安装 git 且能访问代码仓库",
        )

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
    def _run_remote_build(cls, task: PackageTask, client: RemoteWindowsClient) -> None:
        """在远程 Windows 节点上执行打包脚本。

        有自定义脚本时上传到节点临时目录后执行；
        否则执行源码根目录下的 pack.bat（节点接入约定）。
        节点配置了 CPU 限制（核数 / 优先级）时，组装 pack-run.bat 后用
        start /wait 包装执行——优先级与亲和性对整棵构建进程树生效，
        防止打包占满 CPU 导致 SSH 断连。
        """
        snapshot = task.config_snapshot or {}
        custom_script = (snapshot.get("custom_script") or "").strip()
        remote_workspace = cls._remote_workspace(task)
        source_dir = remote_workspace / "source"
        env = cls._build_env(task, remote_workspace)
        build_path = env["BUILD_PATH"]
        work_dir = source_dir if build_path == "." else source_dir / PureWindowsPath(build_path)
        set_prefix = build_set_env_prefix(env)

        cores, priority, mem_mb = cls._resource_limits(snapshot)
        limited = cores > 0 or mem_mb > 0 or priority in ("belownormal", "low")

        if not limited:
            if custom_script:
                script_path = remote_workspace / "tmp" / "pack-custom.bat"
                client.upload_text(script_path, custom_script)
                entry = f"call {cmd_quote(str(script_path))}"
                error_hint = ""
            else:
                entry = f"call {cmd_quote(str(source_dir / 'pack.bat'))}"
                error_hint = "未配置自定义脚本时，源码根目录需提供 pack.bat 入口"
            # 日志展示不打印环境变量明文，避免泄露敏感值
            cls._append_log(
                task,
                f'$ cd /d "{work_dir}" && <注入 {len(env)} 个环境变量> && {entry}',
            )
            client.run_checked(
                f"cd /d {cmd_quote(str(work_dir))} && {set_prefix} && {entry}",
                on_line=lambda line: cls._append_log(task, cls._sanitize_log_line(line)),
                should_stop=lambda: cls._ensure_task_not_canceled(task),
                error_hint=error_hint,
            )
            return

        # 资源限制路径：完整命令写入 pack-run.bat，start /wait 包装执行
        run_script = remote_workspace / "tmp" / "pack-run.bat"
        bat_lines = [
            "@echo off",
            f"cd /d {cmd_quote(str(work_dir))}",
            *[f'set "{key}={value}"' for key, value in env.items()],
        ]
        if custom_script:
            bat_lines.append(custom_script)
            error_hint = ""
        else:
            bat_lines.append(f"call {cmd_quote(str(source_dir / 'pack.bat'))}")
            error_hint = "未配置自定义脚本时，源码根目录需提供 pack.bat 入口"
        bat_lines.append("exit /b %errorlevel%")
        client.upload_text(run_script, "\n".join(bat_lines))

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
    def _collect_remote_artifacts(cls, task: PackageTask, workspace: Path, client: RemoteWindowsClient) -> None:
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
    def _task_env(cls, task: PackageTask, workspace: Path) -> dict[str, str]:
        """构建打包执行环境变量。"""
        return cls._build_env(task, workspace)

    @staticmethod
    def _docker_env_args(env_vars: dict[str, Any]) -> list[str]:
        """把项目配置的环境变量转换为 docker -e 参数。"""
        args: list[str] = []
        for key, value in env_vars.items():
            name = str(key)
            if not ENV_NAME_RE.match(name):
                raise RuntimeError(f"环境变量名不合法: {name}")
            args.extend(["-e", f"{name}={value}"])
        return args

    @classmethod
    def _run_container(cls, task: PackageTask, workspace: Path) -> None:
        """在容器内执行打包。

        镜像目录约定：平台只挂载 /workspace/source、/workspace/artifacts、/workspace/tmp；
        /workspace/scripts（含 pack.sh 入口）与 /workspace/deploy（可选）由镜像提供。
        有自定义脚本时用镜像内 shell 直接执行，否则执行镜像的 /workspace/scripts/pack.sh。
        统一通过 --entrypoint /bin/sh 启动，避免镜像自身 ENTRYPOINT 干扰。
        """
        snapshot = task.config_snapshot or {}
        image = snapshot.get("image")
        script_entry = snapshot.get("script_entry") or "/workspace/scripts/pack.sh"
        custom_script = (snapshot.get("custom_script") or "").strip()
        if not image:
            raise RuntimeError("打包配置缺少镜像")

        env = cls._task_env(task, workspace)
        env_vars = snapshot.get("env_vars") if isinstance(snapshot.get("env_vars"), dict) else {}
        build_path = env["BUILD_PATH"]
        source_build_path = f"/workspace/source/{build_path}" if build_path != "." else "/workspace/source"

        output_path = env["OUTPUT_PATH"]
        command = [
            "docker", "run", "--rm",
            # 分配伪终端：避免容器内进程因 stdout 非 TTY 退化为块缓冲，保证打包日志实时输出
            "-t",
            # 使用宿主机网络，便于容器直接访问内网 npm 源等服务
            "--network", "host",
            *cls._docker_env_args(env_vars),
            "-e", "WORKSPACE=/workspace",
            "-e", "SOURCE_DIR=/workspace/source",
            "-e", "ARTIFACTS_DIR=/workspace/artifacts",
            "-e", "DEPLOY_DIR=/workspace/deploy",
            "-e", "SCRIPTS_DIR=/workspace/scripts",
            "-e", f"TAG_NAME={env['TAG_NAME']}",
            "-e", f"VERSION={env['VERSION']}",
            "-e", f"BUILD_PATH={build_path}",
            "-e", f"OUTPUT_PATH={output_path}",
            "-e", f"PROJECT_CODE={env['PROJECT_CODE']}",
            "-v", f"{workspace / 'source'}:/workspace/source",
            "-v", f"{workspace / 'artifacts'}:/workspace/artifacts",
            "-v", f"{workspace / 'tmp'}:/workspace/tmp",
            "-w", source_build_path,
            "--entrypoint", "/bin/sh",
        ]
        if custom_script:
            command.extend([str(image), "-c", custom_script])
        else:
            command.extend([str(image), str(script_entry)])
        try:
            cls._run_command(task, command, workspace, env)
        except RuntimeError as exc:
            if "退出码 127" in str(exc) and not custom_script:
                raise RuntimeError(
                    f"镜像缺少打包入口脚本 {script_entry}，不符合镜像接入规范；"
                    "请更换符合规范的镜像，或在打包配置中填写自定义打包脚本"
                ) from exc
            raise

    @classmethod
    def _output_dir_rel(cls, snapshot: dict) -> str:
        """产物目录相对源码根的路径（构建目录/产物目录 合并）。"""
        build_path = cls._safe_rel_path(snapshot.get("build_path", "."), ".")
        output_path = cls._safe_rel_path(snapshot.get("output_path", "artifacts"), "artifacts")
        return output_path if build_path == "." else f"{build_path}/{output_path}"

    @classmethod
    def _collect_output_local(cls, task: PackageTask, workspace: Path) -> None:
        """本地打包：构建后把产物目录内容归集到 artifacts。"""
        snapshot = task.config_snapshot or {}
        rel_dir = cls._output_dir_rel(snapshot)
        src = workspace / "source" / rel_dir
        if not src.exists() or not src.is_dir():
            cls._append_log(task, f"产物目录不存在，跳过自动收集: source/{rel_dir}")
            return
        dst = workspace / "artifacts"
        count = 0
        for file in src.rglob("*"):
            if not file.is_file():
                continue
            target = dst / file.relative_to(src)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)
            count += 1
        cls._append_log(task, f"已自动收集产物 {count} 个文件（source/{rel_dir} → artifacts）")

    @classmethod
    def _collect_output_remote(cls, task: PackageTask, client: RemoteWindowsClient) -> None:
        """远程打包：构建后在节点上把产物目录内容拷贝到 artifacts。"""
        snapshot = task.config_snapshot or {}
        remote_workspace = cls._remote_workspace(task)
        rel_dir = cls._output_dir_rel(snapshot)
        src = remote_workspace / "source" / PureWindowsPath(rel_dir)
        dst = remote_workspace / "artifacts"
        cls._append_log(task, f"正在收集产物目录 source\\{rel_dir} -> artifacts…")
        src_quoted = cmd_quote(str(src))
        dst_quoted = cmd_quote(str(dst))
        client.run_checked(
            # robocopy 默认复制源目录内容（不含目录名本身），与本地 rglob 行为一致；
            # 退出码 < 8 均为成功（0=无文件，1=已复制，2=有额外文件，4=有不匹配），
            # >= 8 才是失败；/r:1 /w:1 避免默认百万次重试卡住 SSH 会话；
            # robocopy 成功也返回非零（1/2/4），必须显式 exit /b 0 归零，
            # 否则 run_checked 会把 1 误判为失败
            f"if exist {src_quoted} "
            f"(robocopy {src_quoted} {dst_quoted} /e /r:1 /w:1 /njh /njs /np "
            f"& if errorlevel 8 exit /b 1 & exit /b 0) "
            f"else (echo 产物目录不存在: {src})",
            on_line=lambda line: cls._append_log(task, cls._sanitize_log_line(line)),
            should_stop=lambda: cls._ensure_task_not_canceled(task),
            error_hint="产物自动收集失败",
        )

    @classmethod
    def _scan_artifacts(cls, workspace: Path) -> list[dict[str, Any]]:
        """扫描产物目录并生成文件索引。"""
        root = workspace / "artifacts"
        if not root.exists():
            return []
        artifacts: list[dict[str, Any]] = []
        for file in root.rglob("*"):
            if not file.is_file():
                continue
            rel = file.relative_to(root).as_posix()
            digest = hashlib.sha256()
            with open(file, "rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    digest.update(chunk)
            artifacts.append({
                "id": hashlib.sha1(rel.encode("utf-8")).hexdigest()[:16],
                "name": file.name,
                "path": rel,
                "size": file.stat().st_size,
                "sha256": digest.hexdigest(),
            })
        return artifacts

    @classmethod
    def cancel_task(cls, task: PackageTask) -> PackageTask:
        """取消排队中或进行中的打包任务。"""
        if task.is_finished:
            return task
        now = timezone.now()
        task.status = "canceled"
        task.progress = 0
        task.stage_info = {"stage": "canceled", "progress": 0}
        task.finished_at = now
        if task.started_at and not task.duration:
            task.duration = int((now - task.started_at).total_seconds() * 1000)
        cls._append_log(task, "任务已被用户取消")
        task.save(update_fields=[
            "status", "progress", "stage_info", "finished_at", "duration", "updated_at",
        ])
        return task

    @classmethod
    def _ensure_task_not_canceled(cls, task: PackageTask) -> None:
        """检查任务是否已被用户取消。"""
        task.refresh_from_db(fields=["status", "progress", "stage_info", "finished_at", "duration", "updated_at"])
        if task.status == "canceled":
            raise PackageTaskCanceledError("任务已被用户取消")

    @classmethod
    def _update_stage(
        cls,
        task: PackageTask,
        stage: str,
        progress: int,
        log: str = "",
        extra: dict[str, Any] | None = None,
    ) -> None:
        """更新任务阶段和进度。"""
        cls._ensure_task_not_canceled(task)
        info: dict[str, Any] = {"stage": stage, "progress": progress}
        if extra:
            info.update(extra)
        task.stage_info = info
        task.progress = progress
        task.save(update_fields=["stage_info", "progress", "updated_at"])
        if log:
            cls._append_log(task, log)

    @classmethod
    def _push_artifacts_to_svn(cls, task: PackageTask, workspace: Path) -> dict[str, Any]:
        """将打包产物推送到 SVN 版本号目录。

        Args:
            task: 打包任务记录
            workspace: 任务工作区

        Returns:
            推送结果字典，包含 remote_url、file_count、files

        Raises:
            RuntimeError: 配置不完整、凭证失效、目录已存在或推送失败
        """
        snapshot = task.config_snapshot or {}
        svn_url = snapshot.get("svn_url", "")
        cred_id = snapshot.get("svn_credential_id")
        path_template = snapshot.get("svn_path_template", "{version}")

        if not svn_url or not cred_id:
            raise RuntimeError("SVN 推送配置不完整")

        # 解析凭证
        try:
            credential = Credential.objects.get(id=cred_id)
        except Credential.DoesNotExist as exc:
            raise RuntimeError("SVN 凭证不存在") from exc
        if not credential.is_active:
            raise RuntimeError("SVN 凭证已停用")
        credential.last_used_at = timezone.now()
        credential.save(update_fields=["last_used_at", "updated_at"])
        cred_data = credential.get_data()

        # 渲染版本目录名（支持 {release_type} 占位符区分正式/RC/测试版）
        version_dir = path_template.format(
            version=task.version,
            tag_name=task.tag_name,
            build_type=task.build_type,
            project_code=task.project.code or task.project.name,
            release_type=task.release_type or "formal",
        ).strip("/")
        if not version_dir:
            raise RuntimeError("SVN 目录模板渲染结果为空")
        # 默认模板 {version} 下，非正式版目录自动带类型后缀，避免 rc/测试版覆盖正式版目录
        if path_template == "{version}" and task.release_type and task.release_type != "formal":
            version_dir = f"{version_dir}-{task.release_type}"
        remote_url = f"{svn_url.rstrip('/')}/{version_dir}"

        # 创建 provider 并检查目录是否已存在
        provider = get_provider("svn", svn_url, cred_data)
        if provider.remote_exists(remote_url):
            raise RuntimeError(f"SVN 目录已存在: {remote_url}")

        artifacts_dir = workspace / "artifacts"
        if not artifacts_dir.exists():
            raise RuntimeError("产物目录不存在，无法推送")

        upload_dir = workspace / "tmp" / "svn_upload"
        if upload_dir.exists():
            shutil.rmtree(upload_dir)
        shutil.copytree(artifacts_dir, upload_dir)

        doc_name = f"release-{task.version}.md"
        doc_path = upload_dir / doc_name
        if doc_path.exists():
            raise RuntimeError(f"SVN 上传目录已存在发布文档同名文件: {doc_name}")
        release_doc = ""
        if task.release_id:
            release_doc = task.release.release_doc or ""
        # 推送 SVN 的发布文档转为标准 Markdown 表格语法（单元格内换行用 <br>）
        doc_path.write_text(table_newlines_to_br(release_doc), encoding="utf-8")

        message = f"Release {task.version} artifacts ({task.tag_name})"
        provider.import_path(str(upload_dir), remote_url, message)

        uploaded_files = sorted(
            file.relative_to(upload_dir).as_posix()
            for file in upload_dir.rglob("*")
            if file.is_file()
        )
        return {
            "remote_url": remote_url,
            "file_count": len(uploaded_files),
            "files": uploaded_files,
        }

    @classmethod
    def manual_push_svn(cls, task: PackageTask) -> dict[str, Any]:
        """手动将已完成的打包产物推送到 SVN。

        Args:
            task: 已完成的打包任务

        Returns:
            推送结果字典，包含 remote_url、file_count、files

        Raises:
            serializers.ValidationError: 任务状态不满足或缺少产物
            RuntimeError: SVN 配置不完整或推送失败
        """
        if task.status != "success":
            raise serializers.ValidationError({"task": "只有打包成功的任务才能推送 SVN"})
        if not task.artifact_info:
            raise serializers.ValidationError({"task": "没有可推送的产物"})

        # 确保工作区存在
        workspace_path = task.workspace_path
        if not workspace_path or not Path(workspace_path).exists():
            raise RuntimeError("任务工作区不存在，无法推送产物")
        workspace = Path(workspace_path)
        artifacts_dir = workspace / "artifacts"
        if not artifacts_dir.exists():
            raise RuntimeError("产物目录不存在，无法推送")

        # 从快照解析 SVN 配置，快照缺失时回退到配置
        snapshot = task.config_snapshot or {}
        if not snapshot.get("svn_url") or not snapshot.get("svn_credential_id"):
            config = task.config
            if not config or not config.svn_push_enabled:
                raise RuntimeError("打包配置未启用 SVN 推送，无法手动推送")
            snapshot = {
                **snapshot,
                "svn_push_enabled": True,
                "svn_url": config.svn_url,
                "svn_credential_id": str(config.svn_credential_id) if config.svn_credential_id else None,
                "svn_path_template": config.svn_path_template or "{version}",
            }
            task.config_snapshot = snapshot
        if not snapshot.get("svn_push_enabled"):
            raise RuntimeError("打包配置未启用 SVN 推送，无法手动推送")

        cls._append_log(task, "开始手动推送产物到 SVN…")
        result = cls._push_artifacts_to_svn(task, workspace)
        cls._append_log(
            task,
            f"SVN 推送完成: {result['remote_url']} ({result['file_count']} 个文件)",
        )

        # 更新 stage_info 记录推送结果
        stage_info = dict(task.stage_info) if task.stage_info else {}
        stage_info["svn_push"] = result
        task.stage_info = stage_info
        task.save(update_fields=["stage_info", "config_snapshot", "updated_at"])

        return result

    @classmethod
    def run_task(cls, task: PackageTask) -> PackageTask:
        """执行打包任务。"""
        if task.is_finished:
            return task
        started = timezone.now()
        task.status = "running"
        task.started_at = started
        task.progress = 0
        task.stage_info = {"stage": "checkout", "progress": 5}
        task.save(update_fields=["status", "started_at", "progress", "stage_info", "updated_at"])
        workspace = cls.prepare_workspace(task)
        snapshot = task.config_snapshot or {}
        svn_push_enabled = bool(snapshot.get("svn_push_enabled"))
        executor_type = snapshot.get("executor_type") or "local_docker"
        # 远程执行全程复用同一条 SSH 连接：分阶段建连在并发/节点繁忙时
        # 容易在握手阶段被 Windows OpenSSH 断开（No existing session）
        remote_client: RemoteWindowsClient | None = None
        try:
            cls._append_log(task, f"开始打包 {task.version} ({task.tag_name})")
            cls._update_stage(task, "checkout", 5, "正在拉取源码…")
            if executor_type == "remote_windows":
                remote_client = RemoteWindowsClient.from_snapshot(snapshot)
                remote_client.connect()
                cls._checkout_source_remote(task, remote_client)
            else:
                cls._checkout_source(task, workspace)
            cls._ensure_task_not_canceled(task)
            build_progress = 25 if svn_push_enabled else 30
            cls._update_stage(task, "build", build_progress, "开始执行打包…")
            artifacts_progress = 65 if svn_push_enabled else 80
            if executor_type == "remote_windows":
                cls._run_remote_build(task, remote_client)
                cls._ensure_task_not_canceled(task)
                cls._update_stage(task, "artifacts", artifacts_progress, "正在回传产物…")
                if snapshot.get("auto_collect_output"):
                    cls._collect_output_remote(task, remote_client)
                cls._collect_remote_artifacts(task, workspace, remote_client)
            else:
                cls._run_container(task, workspace)
                cls._ensure_task_not_canceled(task)
                cls._update_stage(task, "artifacts", artifacts_progress, "正在扫描产物…")
                if snapshot.get("auto_collect_output"):
                    cls._collect_output_local(task, workspace)
            task.artifact_info = cls._scan_artifacts(workspace)
            if not task.artifact_info:
                cls._append_log(
                    task,
                    "警告：未扫描到任何打包产物，请检查产物目录配置或打包脚本输出路径",
                )
            cls._ensure_task_not_canceled(task)

            # SVN 推送阶段
            svn_push_result: dict[str, Any] | None = None
            if svn_push_enabled:
                cls._update_stage(task, "svn_push", 90, "正在推送产物到 SVN…")
                svn_push_result = cls._push_artifacts_to_svn(task, workspace)
                cls._append_log(
                    task,
                    f"SVN 推送完成: {svn_push_result['remote_url']}"
                    f" ({svn_push_result['file_count']} 个文件)",
                )

            task.status = "success"
            task.progress = 100
            done_info: dict[str, Any] = {"stage": "done", "progress": 100}
            if svn_push_result:
                done_info["svn_push"] = svn_push_result
            task.stage_info = done_info
            task.error_message = ""
            cls._append_log(task, "打包完成")
        except PackageTaskCanceledError:
            task.refresh_from_db(fields=["status", "progress", "stage_info", "finished_at", "duration", "updated_at"])
            task.error_message = ""
        except Exception as exc:
            task.status = "failure"
            task.error_message = str(exc)
            cls._append_log(task, f"打包失败: {exc}")
        finally:
            if remote_client is not None:
                remote_client.close()
            finished = timezone.now()
            task.finished_at = finished
            task.duration = int((finished - started).total_seconds() * 1000)
            task.save(update_fields=[
                "status", "progress", "stage_info", "artifact_info", "error_message", "finished_at",
                "duration", "updated_at",
            ])
            try:
                from apps.notification.services import NotificationService

                NotificationService.notify_package_result(task, task.release)
            except Exception:
                pass
        return task
