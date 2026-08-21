"""
打包服务基础设施：工作区、日志与命令执行
"""
import logging
import os
import re
import select
import signal
import subprocess
from pathlib import Path
from typing import Any

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from apps.package.models import PackageTask
from apps.repository.serializers import RepositorySerializer
from utils.provider.credential_resolver import resolve_credential

logger = logging.getLogger(__name__)
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SECRET_ENV_RE = re.compile(r"(TOKEN|PASSWORD|PASSWD|SECRET|KEY|CREDENTIAL|AUTH)", re.IGNORECASE)
# 「自动压缩产物」压缩包文件名中的非法字符（Windows 保留字符与控制字符），统一替换为 -
_ARCHIVE_NAME_INVALID_RE = re.compile(r'[\\/:*?"<>|\s\x00-\x1f]+')


class PackageTaskCanceledError(RuntimeError):
    """打包任务已取消。"""


class PackageBaseMixin:
    """工作区、日志、命令执行等基础设施方法。"""

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
                    # 进程已退出：先把管道中剩余输出全部读完再结束。
                    # 否则脚本快速失败（如 sh -e 遇错即停）时，最后一段输出
                    # （往往是错误信息）尚未被 select 报告就绪，会被直接丢弃
                    for line in process.stdout:
                        if line:
                            cls._append_log(task, cls._sanitize_log_line(line.rstrip("\r\n")))
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

    @staticmethod
    def _doc_filename(version: str) -> str:
        """生成发布说明文件名中的版本段，替换路径/文件名非法字符。

        分支直打包时 version 即分支名（可能含 ``/``），若不处理会导致
        写入源码根目录或 SVN 上传目录时越级创建子目录。
        """
        cleaned = _ARCHIVE_NAME_INVALID_RE.sub("-", version or "").strip("-")
        return cleaned or "latest"

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
