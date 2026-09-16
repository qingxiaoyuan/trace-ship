"""
本地 Docker 打包执行与产物收集
"""
import hashlib
import shutil
from pathlib import Path
from typing import Any

from django.conf import settings
from django.utils import timezone

from apps.package.models import PackageTask
from apps.package.services.base import _ARCHIVE_NAME_INVALID_RE, ENV_NAME_RE


class LocalRunnerMixin:
    """本地 Docker 容器执行打包与产物归集。"""

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
    def _git_inject_env_args(cls, task: PackageTask, workspace: Path) -> list[str]:
        """生成注入 Git 凭证的 docker -e 参数，供构建脚本自行执行 git push。

        配置开启 inject_git_credential 时：把 askpass 脚本复制到 workspace/tmp
        （容器内挂载为 /workspace/tmp），以 -e 注入 GIT_ASKPASS 与
        TRACE_SHIP_GIT_USERNAME/PASSWORD；同时注入 GIT_AUTHOR/COMMITTER 信息，
        脚本 commit 时无需再配置 user.name/user.email。
        凭证对打包脚本可见，功能默认关闭，由打包配置显式开启。
        """
        snapshot = task.config_snapshot or {}
        if not snapshot.get("inject_git_credential"):
            return []
        auth_env = cls._build_auth_env(task.repository, task.triggered_by, product=task.project)
        if not auth_env.get("TRACE_SHIP_GIT_PASSWORD"):
            # 开关开启但仓库无可用凭证：显式记日志，避免脚本内 push 失败时无从排查
            cls._append_log(task, "已开启注入 Git 凭证，但仓库未配置可用凭证，跳过注入（脚本内 git push 将不可用）")
            return []
        askpass_dst = workspace / "tmp" / "git-askpass.sh"
        shutil.copy(Path(settings.BASE_DIR) / "utils" / "git_askpass.sh", askpass_dst)
        askpass_dst.chmod(0o755)
        user = task.triggered_by
        author_name = (user.nickname or user.username) if user else ""
        author_email = (user.email if user else "") or "trace-ship@local"
        args = [
            "-e", "GIT_ASKPASS=/workspace/tmp/git-askpass.sh",
            "-e", "GIT_TERMINAL_PROMPT=0",
            "-e", f"GIT_AUTHOR_NAME={author_name or 'trace-ship'}",
            "-e", f"GIT_AUTHOR_EMAIL={author_email}",
            "-e", f"GIT_COMMITTER_NAME={author_name or 'trace-ship'}",
            "-e", f"GIT_COMMITTER_EMAIL={author_email}",
        ]
        for key in ("TRACE_SHIP_GIT_USERNAME", "TRACE_SHIP_GIT_PASSWORD"):
            if auth_env.get(key):
                args.extend(["-e", f"{key}={auth_env[key]}"])
        return args

    @classmethod
    def _run_container(cls, task: PackageTask, workspace: Path) -> None:
        """在容器内执行打包。

        镜像目录约定：平台只挂载 /workspace/source、/workspace/artifacts、/workspace/tmp；
        /workspace/scripts（含 pack.sh 入口）与 /workspace/deploy（可选）由镜像提供。
        有自定义脚本时用镜像内 shell 以 -ec（遇错即停）执行，否则执行镜像的 /workspace/scripts/pack.sh。
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
            # 发布说明文件仅发布触发的任务写入源码根目录（文件名经路径安全化），
            # 分支直打包无发布说明，不注入 RELEASE_DOC_PATH
            *(
                ["-e", f"RELEASE_DOC_PATH=/workspace/source/release-{cls._doc_filename(task.version)}.md"]
                if task.release_id
                else []
            ),
            "-e", "ARTIFACTS_DIR=/workspace/artifacts",
            "-e", "DEPLOY_DIR=/workspace/deploy",
            "-e", "SCRIPTS_DIR=/workspace/scripts",
            "-e", f"TAG_NAME={env['TAG_NAME']}",
            "-e", f"VERSION={env['VERSION']}",
            "-e", f"BUILD_PATH={build_path}",
            "-e", f"OUTPUT_PATH={output_path}",
            "-e", f"PROJECT_CODE={env['PROJECT_CODE']}",
            # 可选：注入 Git 凭证与提交身份，供打包脚本在（子）仓库内自行 git push
            *cls._git_inject_env_args(task, workspace),
            "-v", f"{workspace / 'source'}:/workspace/source",
            "-v", f"{workspace / 'artifacts'}:/workspace/artifacts",
            "-v", f"{workspace / 'tmp'}:/workspace/tmp",
            "-w", source_build_path,
            "--entrypoint", "/bin/sh",
        ]
        if custom_script:
            # -e 遇错即停：避免脚本中间步骤（如编译）失败但退出码被后续命令覆盖，
            # 导致任务被误判为成功
            command.extend([str(image), "-ec", custom_script])
        else:
            # 内置入口同样以 -e 执行（遇错即停），不依赖镜像 pack.sh 内部是否写了 set -e，
            # 避免镜像脚本中间步骤失败被后续命令覆盖导致误判成功
            command.extend([str(image), "-e", str(script_entry)])
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
    def _archive_stem(cls, task: PackageTask) -> str:
        """生成产物压缩包文件名主干（不含扩展名）：软件名-版本-日期

        软件名取打包配置名（配置被删除时回退仓库名）；版本取发布版本号；
        日期为打包当天（本地时区 YYYYMMDD）。
        文件名中的非法字符统一替换为 -，避免 Windows / 下载场景命名问题。
        """

        def safe(part: str) -> str:
            cleaned = _ARCHIVE_NAME_INVALID_RE.sub("-", part or "").strip("-")
            return cleaned or "package"

        software = safe(
            task.config.name
            if task.config
            else (task.repository.name if task.repository else "")
        )
        version = safe(task.version or "")
        date = timezone.localdate().strftime("%Y%m%d")
        return f"{software}-{version}-{date}"

    @classmethod
    def _collect_output_local(cls, task: PackageTask, workspace: Path) -> None:
        """本地打包：构建后把产物目录内容归集到 artifacts。

        快照开启 auto_compress 时，将产物目录内所有内容压缩为单个
        zip 压缩包（命名：软件名-版本-日期），最终只保留该压缩包。
        """
        snapshot = task.config_snapshot or {}
        rel_dir = cls._output_dir_rel(snapshot)
        src = workspace / "source" / rel_dir
        if not src.exists() or not src.is_dir():
            cls._append_log(task, f"产物目录不存在，跳过自动收集: source/{rel_dir}")
            return
        dst = workspace / "artifacts"
        if bool(snapshot.get("auto_compress")):
            dst.mkdir(parents=True, exist_ok=True)
            archive_stem = cls._archive_stem(task)
            # make_archive 以 root_dir 内容为压缩包根（不含目录名本身），与远程 tar 行为一致
            shutil.make_archive(str(dst / archive_stem), "zip", root_dir=src)
            cls._append_log(
                task,
                f"已自动压缩产物为单个压缩包（source/{rel_dir} → {archive_stem}.zip）",
            )
            return
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
