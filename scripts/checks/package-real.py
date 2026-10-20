"""使用真实 Git、生产打包链路和 Docker 验收虚构软件；不连接业务环境。"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import stat
import subprocess
import uuid
from datetime import UTC, datetime
from pathlib import Path

from backend import configure_console, git_value, stream_command, write_json

ROOT = Path(__file__).resolve().parents[2]
PUBLIC_PACKAGE_INDEXES = (
    "https://pypi.org/simple", "https://pypi.tuna.tsinghua.edu.cn/simple",
    "https://mirrors.aliyun.com/pypi/simple", "https://mirrors.huaweicloud.com/repository/pypi/simple",
)


class CheckFailed(RuntimeError):
    """保持构建或执行命令的真实退出码。"""

    def __init__(self, exit_code: int) -> None:
        self.exit_code = exit_code
        super().__init__(f"验收步骤失败，退出码 {exit_code}")


def linux_path(path: Path) -> str:
    """Docker Desktop 与 Linux daemon 在嵌套挂载时使用同一绝对目录。"""
    if os.name == "nt":
        if len(path.drive) != 2 or path.drive[1] != ":":
            raise ValueError("Windows 验收只支持本地盘符目录")
        return f"/run/desktop/mnt/host/{path.drive[0].lower()}/{path.relative_to(path.anchor).as_posix()}"
    return str(path)


def remove_runtime(runtime: Path) -> None:
    """Git 对象在 Windows 带只读位，仅解除本次目录中文件的只读位。"""
    def retry_readonly(function: object, filename: str, _error: object) -> None:
        target = Path(filename).resolve()
        if target != runtime and runtime not in target.parents:
            raise RuntimeError("清理目标越出本次运行目录")
        target.chmod(stat.S_IWRITE | stat.S_IREAD)
        if not callable(function):
            raise RuntimeError("清理回调不可调用")
        function(filename)

    shutil.rmtree(runtime, onerror=retry_readonly)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-dir", type=Path)
    parser.add_argument("--package-index", default=PUBLIC_PACKAGE_INDEXES[0], metavar="公开HTTPS源")
    args = parser.parse_args(argv)
    if args.package_index not in PUBLIC_PACKAGE_INDEXES:
        parser.error("仅支持已登记的公开 HTTPS 源，不接受带凭据地址")
    run_id = uuid.uuid4().hex
    report = (args.report_dir or ROOT / "tmp" / "checks" / f"package-real-{run_id}").resolve()
    report.mkdir(parents=True, exist_ok=True)
    if any(report.iterdir()):
        parser.error("证据目录须为空，请为本次运行使用新目录")
    runtime_parent = (ROOT / "tmp" / "package-real-runtime").resolve()
    runtime_parent.mkdir(parents=True, exist_ok=True)
    runtime = runtime_parent / run_id
    runtime.mkdir()
    (runtime / ".package-real").write_text(run_id, encoding="ascii")
    helper = f"trace-ship/package-real-helper:{run_id}"
    builder = f"trace-ship/package-real-fixture:{run_id}"
    container = f"trace-ship-package-real-{run_id}"
    started = datetime.now(UTC).isoformat()
    env = os.environ.copy()
    steps: list[dict[str, object]] = []
    exit_code = 1
    cleanup: dict[str, object] = {}

    def run(stage: str, command: list[str]) -> int:
        result = stream_command(command, ROOT, env, report / f"{stage}.log")
        steps.append({"stage": stage, "command": command, "exit_code": result})
        if result:
            raise CheckFailed(result)
        return result

    try:
        # 共享后端 Dockerfile 保持 Python/业务依赖一致；只扩展真实 Docker CLI。
        compose = ["docker", "compose", "--project-name", "trace-ship-checks", "--file",
                   str(ROOT / "docker" / "docker-compose.checks.yml")]
        env.update({
            "TRACE_SHIP_CHECK_PIP_INDEX_URL": args.package_index,
            "TRACE_SHIP_CHECK_SOURCE": str(ROOT), "TRACE_SHIP_CHECK_REPORTS": str(report),
            "TRACE_SHIP_CHECK_COMMIT": git_value("rev-parse", "HEAD"),
            "TRACE_SHIP_CHECK_DIRTY": git_value("status", "--porcelain") or "clean",
        })
        run("backend-image", [*compose, "build", "backend"])
        run("helper-image", ["docker", "build", "--file",
                        str(ROOT / "docker" / "checks" / "Dockerfile.package-real"), "--tag", helper, str(ROOT)])
        run("fixture-image", ["docker", "build", "--network", "none", "--tag", builder,
                        str(ROOT / "scripts" / "checks" / "fixtures" / "package-real")])
        identities = subprocess.run(["docker", "image", "inspect", helper, builder], cwd=ROOT,
                                    capture_output=True, text=True, encoding="utf-8", check=False)
        if identities.returncode:
            raise RuntimeError("无法记录本次辅助镜像和真实构建镜像身份")
        write_json(report / "images.json", json.loads(identities.stdout))
        command = [
            "docker", "run", "--rm", "--name", container, "--network", "none",
            "--mount", f"type=bind,source={ROOT},target=/workspace,readonly",
            "--mount", f"type=bind,source={runtime},target={linux_path(runtime)}",
            "--mount", f"type=bind,source={report},target=/reports",
            "--mount", "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
            "-e", f"PACKAGE_REAL_RUN_ID={run_id}", "-e", f"PACKAGE_REAL_IMAGE={builder}",
            "-e", f"PACKAGE_REAL_RUNTIME={linux_path(runtime)}", "-e", "PYTHONDONTWRITEBYTECODE=1",
            "-e", f"TRACE_SHIP_CHECK_COMMIT={git_value('rev-parse', 'HEAD')}",
            helper, "python", "/workspace/scripts/checks/package_real_driver.py",
        ]
        exit_code = run("execution", command)
    except CheckFailed as error:
        exit_code = error.exit_code
    except Exception as error:
        print(f"验收入口失败：{error}", flush=True)
        exit_code = 1
    finally:
        # 不清理任何共享镜像或其他任务；运行目录须同时满足父目录和随机标识校验。
        removed = subprocess.run(["docker", "container", "rm", "--force", container], cwd=ROOT,
                                 capture_output=True, text=True, check=False)
        cleanup["helper_container_removed"] = removed.returncode == 0 or "No such container" in removed.stderr
        fixture_containers = subprocess.run(
            ["docker", "container", "ls", "--all", "--quiet", "--filter", f"ancestor={builder}"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        cleanup["fixture_containers_removed"] = fixture_containers.returncode == 0
        if fixture_containers.returncode == 0 and fixture_containers.stdout.strip():
            # 唯一随机镜像只由本次检查使用；也清理中断时可能残留的该镜像容器。
            residual = subprocess.run(
                ["docker", "container", "rm", "--force", *fixture_containers.stdout.split()],
                cwd=ROOT, capture_output=True, text=True, check=False,
            )
            cleanup["fixture_containers_removed"] = residual.returncode == 0
        cleanup["unique_images_removed"] = True
        for unique_image in (helper, builder):
            existing = subprocess.run(["docker", "image", "inspect", unique_image], cwd=ROOT,
                                      capture_output=True, text=True, check=False)
            if existing.returncode == 0:
                removed_image = subprocess.run(["docker", "image", "rm", unique_image], cwd=ROOT,
                                               capture_output=True, text=True, check=False)
                if removed_image.returncode:
                    cleanup["unique_images_removed"] = False
        try:
            if runtime.resolve().parent != runtime_parent or (runtime / ".package-real").read_text() != run_id:
                raise RuntimeError("验收运行目录身份不符，拒绝递归清理")
            remove_runtime(runtime)
            cleanup["runtime_removed"] = not runtime.exists()
        except (OSError, RuntimeError) as cleanup_error:
            cleanup["runtime_removed"] = False
            cleanup["runtime_error"] = str(cleanup_error)
        if any(value is False for value in cleanup.values()):
            exit_code = exit_code or 1
        write_json(report / "package-real-result.json", {
            "run_id": run_id, "started_at": started, "finished_at": datetime.now(UTC).isoformat(),
            "commit": git_value("rev-parse", "HEAD"), "working_tree": git_value("status", "--porcelain"),
            "host_os": platform.platform(), "host_python": platform.python_version(),
            "package_index": args.package_index, "steps": steps, "cleanup": cleanup,
            "exit_code": exit_code, "status": "passed" if exit_code == 0 else "failed",
        })
        print(f"真实打包验收证据：{report}", flush=True)
    return exit_code


if __name__ == "__main__":
    configure_console()
    raise SystemExit(main())
