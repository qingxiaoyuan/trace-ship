"""
系统内置打包业务服务
"""
import hashlib
import logging
import os
import signal
import re
import select
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone
from rest_framework import serializers

from apps.credential.models import Credential
from apps.package.models import PackageConfig, PackageTask
from apps.repository.serializers import RepositorySerializer
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
        return {
            "config_id": str(config.id),
            "name": config.name,
            "image": image.image if image else "",
            "image_name": image.name if image else "",
            "script_entry": image.script_entry if image else "",
            "custom_script": config.custom_script,
            "build_path": cls._safe_rel_path(
                config.build_path,
                image.default_build_path if image else ".",
            ),
            "output_path": cls._safe_rel_path(
                config.output_path,
                image.default_output_path if image else "artifacts",
            ),
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

    @classmethod
    def _start_local_worker(cls, task_id: str, reason: str = "") -> None:
        """在当前后端进程中启动后台线程执行打包任务。"""

        def runner() -> None:
            close_old_connections()
            try:
                task = PackageTask.objects.select_related(
                    "config", "release", "project", "repository", "triggered_by",
                ).get(id=task_id)
                if reason:
                    cls.prepare_workspace(task)
                    cls._append_log(task, f"Celery 不可用，已降级为本地后台执行: {reason}")
                cls.run_task(task)
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
        ).select_related("project", "repository", "image")
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
                        cls._append_log(task, line.rstrip("\n"))
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

    @classmethod
    def _task_env(cls, task: PackageTask, workspace: Path) -> dict[str, str]:
        """构建打包执行环境变量。"""
        snapshot = task.config_snapshot or {}
        env_vars = snapshot.get("env_vars") if isinstance(snapshot.get("env_vars"), dict) else {}
        output_path = cls._safe_rel_path(snapshot.get("output_path", "artifacts"), "artifacts")
        return {
            **{str(k): str(v) for k, v in env_vars.items()},
            "TAG_NAME": task.tag_name,
            "VERSION": task.version,
            "BUILD_PATH": cls._safe_rel_path(snapshot.get("build_path", "."), "."),
            "OUTPUT_PATH": output_path,
            "PROJECT_CODE": task.project.code or task.project.name,
            "WORKSPACE": str(workspace),
            "SOURCE_DIR": str(workspace / "source"),
            "ARTIFACTS_DIR": str(workspace / "artifacts"),
            "DEPLOY_DIR": str(workspace / "deploy"),
            "SCRIPTS_DIR": str(workspace / "scripts"),
            "TMPDIR": str(workspace / "tmp"),
        }

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

        # 渲染版本目录名
        version_dir = path_template.format(
            version=task.version,
            tag_name=task.tag_name,
            build_type=task.build_type,
            project_code=task.project.code or task.project.name,
        ).strip("/")
        if not version_dir:
            raise RuntimeError("SVN 目录模板渲染结果为空")
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
        doc_path.write_text(release_doc, encoding="utf-8")

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
        try:
            cls._append_log(task, f"开始打包 {task.version} ({task.tag_name})")
            cls._update_stage(task, "checkout", 5, "正在拉取源码…")
            cls._checkout_source(task, workspace)
            cls._ensure_task_not_canceled(task)
            build_progress = 25 if svn_push_enabled else 30
            cls._update_stage(task, "build", build_progress, "开始执行打包…")
            cls._run_container(task, workspace)
            cls._ensure_task_not_canceled(task)
            artifacts_progress = 65 if svn_push_enabled else 80
            cls._update_stage(task, "artifacts", artifacts_progress, "正在扫描产物…")
            task.artifact_info = cls._scan_artifacts(workspace)
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
