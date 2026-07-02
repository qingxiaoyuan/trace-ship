"""
系统内置打包业务服务
"""
import hashlib
import logging
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

from django.conf import settings
from django.db import close_old_connections
from django.utils import timezone
from rest_framework import serializers

from apps.package.models import PackageConfig, PackageTask
from apps.repository.serializers import RepositorySerializer
from utils.provider.credential_resolver import resolve_credential


logger = logging.getLogger(__name__)
ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


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
        """解析仓库凭证为 Git 可用的环境变量。"""
        data = resolve_credential(repo, request_user)
        env: dict[str, str] = {}
        username = data.get("username") or ""
        token = data.get("token") or data.get("password") or ""
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
            "mode": config.mode,
            "build_type": config.build_type,
            "image": image.image if image else "",
            "image_name": image.name if image else "",
            "script_entry": image.script_entry if image else "",
            "local_script": config.local_script,
            "build_path": cls._safe_rel_path(
                config.build_path,
                image.default_build_path if image else ".",
            ),
            "output_path": cls._safe_rel_path(
                config.output_path,
                image.default_output_path if image else "artifacts",
            ),
            "env_vars": config.env_vars or {},
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
            mode=config.mode,
            build_type=config.build_type,
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
        cls._append_log(task, f"$ {' '.join(command) if not shell else command[0]}")
        process = subprocess.Popen(
            command if not shell else command[0],
            cwd=str(cwd),
            env={**os.environ, **(env or {})},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            shell=shell,
        )
        assert process.stdout is not None
        for line in process.stdout:
            cls._append_log(task, line.rstrip("\n"))
        code = process.wait()
        if code != 0:
            raise RuntimeError(f"命令执行失败，退出码 {code}")

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
            "BUILD_TYPE": task.build_type,
            "BUILD_PATH": cls._safe_rel_path(snapshot.get("build_path", "."), "."),
            "OUTPUT_PATH": output_path,
            "PROJECT_CODE": task.project.code or task.project.name,
            "WORKSPACE": str(workspace),
            "SOURCE_DIR": str(workspace / "source"),
            "ARTIFACTS_DIR": str(workspace / "artifacts"),
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
    def _run_simple(cls, task: PackageTask, workspace: Path) -> None:
        """执行简易容器打包。"""
        snapshot = task.config_snapshot or {}
        image = snapshot.get("image")
        script_entry = snapshot.get("script_entry")
        if not image or not script_entry:
            raise RuntimeError("简易打包缺少镜像或脚本入口")
        env = cls._task_env(task, workspace)
        env_vars = snapshot.get("env_vars") if isinstance(snapshot.get("env_vars"), dict) else {}
        build_path = env["BUILD_PATH"]
        source_build_path = f"/workspace/source/{build_path}" if build_path != "." else "/workspace/source"
        command = [
            "docker", "run", "--rm",
            *cls._docker_env_args(env_vars),
            "-e", f"TAG_NAME={env['TAG_NAME']}",
            "-e", f"VERSION={env['VERSION']}",
            "-e", f"BUILD_TYPE={env['BUILD_TYPE']}",
            "-e", f"BUILD_PATH={build_path}",
            "-e", "OUTPUT_PATH=dist",
            "-e", "ARTIFACTS_DIR=/workspace/artifacts",
            "-e", f"PROJECT_CODE={env['PROJECT_CODE']}",
            "-e", "WORKSPACE=/workspace",
            "-v", f"{workspace / 'source'}:/workspace/source",
            "-v", f"{workspace / 'artifacts'}:/workspace/artifacts",
            "-w", source_build_path,
            str(image),
            str(script_entry),
        ]
        cls._run_command(task, command, workspace, env)

    @classmethod
    def _run_local(cls, task: PackageTask, workspace: Path) -> None:
        """执行本地脚本打包。"""
        snapshot = task.config_snapshot or {}
        script = (snapshot.get("local_script") or "").strip()
        if not script:
            raise RuntimeError("本地打包缺少脚本")
        env = cls._task_env(task, workspace)
        build_path = env["BUILD_PATH"]
        cwd = workspace / "source" / build_path if build_path != "." else workspace / "source"
        cwd.mkdir(parents=True, exist_ok=True)
        cls._run_command(task, [script], cwd, env, shell=True)

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
    def run_task(cls, task: PackageTask) -> PackageTask:
        """执行打包任务。"""
        if task.is_finished:
            return task
        started = timezone.now()
        task.status = "running"
        task.started_at = started
        task.save(update_fields=["status", "started_at", "updated_at"])
        workspace = cls.prepare_workspace(task)
        try:
            cls._append_log(task, f"开始打包 {task.version} ({task.tag_name})")
            cls._checkout_source(task, workspace)
            if task.mode == "simple":
                cls._run_simple(task, workspace)
            else:
                cls._run_local(task, workspace)
            task.artifact_info = cls._scan_artifacts(workspace)
            task.status = "success"
            task.error_message = ""
            cls._append_log(task, "打包完成")
        except Exception as exc:
            task.status = "failure"
            task.error_message = str(exc)
            cls._append_log(task, f"打包失败: {exc}")
        finally:
            finished = timezone.now()
            task.finished_at = finished
            task.duration = int((finished - started).total_seconds() * 1000)
            task.save(update_fields=[
                "status", "artifact_info", "error_message", "finished_at",
                "duration", "updated_at",
            ])
            try:
                from apps.notification.services import NotificationService

                NotificationService.notify_package_result(task, task.release)
            except Exception:
                pass
        return task
