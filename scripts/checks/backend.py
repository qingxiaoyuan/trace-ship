"""本地与 CI 共用的后端检查入口；报告不改变检查的真实退出状态。"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shlex
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
PYTHON_VERSION = (3, 11)
OWNED_REPORTS = (
    "backend-result.json",
    "backend-environment.json",
    "backend-check.log",
    "backend-dependencies.txt",
    "junit.xml",
    "coverage.xml",
)


def configure_console() -> None:
    """Windows 与 Linux 的中文终端证据统一使用 UTF-8。"""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def write_json(path: Path, data: object) -> None:
    """以 UTF-8 保存可供人和 CI 读取的检查证据。"""
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def git_value(*args: str) -> str:
    """容器由宿主传入提交身份，直接执行时从当前仓库读取。"""
    try:
        result = subprocess.run(
            ["git", "-c", f"safe.directory={ROOT.as_posix()}", *args],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False,
        )
    except OSError:
        return "无法读取"
    return result.stdout.strip() if result.returncode == 0 else "无法读取"


def stream_command(command: list[str], cwd: Path, env: dict[str, str], log: Path) -> int:
    """同时输出终端和文件，无 shell 管道，直接返回子进程退出码。"""
    with log.open("w", encoding="utf-8") as output:
        try:
            process = subprocess.Popen(
                command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1,
            )
        except OSError as error:
            message = f"无法启动检查：{error}\n"
            output.write(message)
            print(message, end="", flush=True)
            return 127
        assert process.stdout is not None
        for line in process.stdout:
            output.write(line)
            output.flush()
            print(line, end="", flush=True)
        return process.wait()


def runtime_directory(report_dir: Path) -> Path:
    """容器可把运行时放原生 tmpfs，避免 Windows 报告挂载影响执行位和链接。"""
    configured = os.environ.get("TRACE_SHIP_CHECK_RUNTIME_DIR")
    return Path(configured).resolve() if configured else report_dir / "runtime"


def check_environment(report_dir: Path) -> dict[str, str]:
    """强制测试配置，并把所有检查缓存和临时产物放入独立目录。"""
    env = os.environ.copy()
    runtime = runtime_directory(report_dir)
    temporary = runtime / "tmp"
    temporary.mkdir(parents=True, exist_ok=True)
    env.update({
        "DJANGO_SETTINGS_MODULE": "config.settings.test",
        "PACKAGE_WORKSPACE_ROOT": str(runtime / "package-workspaces"),
        "COVERAGE_FILE": str(report_dir / ".coverage"),
        "RUFF_CACHE_DIR": str(runtime / "ruff"),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUNBUFFERED": "1",
        "TMPDIR": str(temporary),
        "TEMP": str(temporary),
        "TMP": str(temporary),
    })
    # 宿主的 pytest/coverage 附加参数不得偷偷缩减全量范围或覆盖率门槛。
    env.pop("PYTEST_ADDOPTS", None)
    env.pop("COVERAGE_PROCESS_START", None)
    return env


def check_command(check: str, report_dir: Path) -> list[str]:
    if check == "lint":
        return [sys.executable, "-m", "ruff", "check", "--config", "pyproject.toml", ".", "../scripts/checks"]
    return [
        sys.executable, "-m", "pytest",
        f"--junitxml={report_dir / 'junit.xml'}",
        f"--cov-report=xml:{report_dir / 'coverage.xml'}",
        "-o", f"cache_dir={runtime_directory(report_dir) / 'pytest'}",
    ]


def operating_system() -> dict[str, object]:
    """区分宿主内核与容器实际发行版，避免把两者误记为同一环境。"""
    details: dict[str, object] = {"platform": platform.platform()}
    if platform.system() == "Linux":
        details["distribution"] = platform.freedesktop_os_release()
    return details


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("check", choices=("lint", "test"))
    parser.add_argument("--report-dir", type=Path, required=True, help="本次独立证据目录，不复用旧报告")
    args = parser.parse_args(argv)
    report_dir = args.report_dir.resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    if any((report_dir / name).exists() for name in OWNED_REPORTS):
        parser.error("证据目录已有检查报告，请为本次运行选择新目录")

    command = check_command(args.check, report_dir)
    metadata = {
        "check": args.check,
        "started_at": datetime.now(UTC).isoformat(),
        "commit": os.environ.get("TRACE_SHIP_CHECK_COMMIT") or git_value("rev-parse", "HEAD"),
        "working_tree": os.environ.get("TRACE_SHIP_CHECK_DIRTY") or git_value("status", "--porcelain"),
        "os": operating_system(),
        "python": platform.python_version(),
        "executable": sys.executable,
        "settings": "config.settings.test",
        "runtime_directory": str(runtime_directory(report_dir)),
        "package_index": os.environ.get("TRACE_SHIP_CHECK_PIP_INDEX_URL", "直接入口未记录安装源"),
        "cwd": str(BACKEND),
        "command": command,
        "command_display": shlex.join(command),
    }
    write_json(report_dir / "backend-environment.json", metadata)
    check_executed = False
    if sys.version_info[:2] != PYTHON_VERSION:
        print("后端标准检查要求 Python 3.11；其他本地版本请使用 backend-linux.py。", file=sys.stderr)
        exit_code = 2
    else:
        env = check_environment(report_dir)
        dependencies = subprocess.run(
            [sys.executable, "-m", "pip", "freeze"], cwd=BACKEND, env=env,
            capture_output=True, text=True, encoding="utf-8", errors="replace", check=False,
        )
        (report_dir / "backend-dependencies.txt").write_text(
            dependencies.stdout + dependencies.stderr, encoding="utf-8",
        )
        if dependencies.returncode:
            exit_code = dependencies.returncode
            print("无法记录实际依赖，检查未执行。", file=sys.stderr)
        else:
            print(f"执行：{shlex.join(command)}", flush=True)
            check_executed = True
            exit_code = stream_command(command, BACKEND, env, report_dir / "backend-check.log")
    write_json(report_dir / "backend-result.json", {
        **metadata,
        "finished_at": datetime.now(UTC).isoformat(),
        "exit_code": exit_code,
        "check_executed": check_executed,
        "status": "passed" if exit_code == 0 else "failed",
    })
    return exit_code


if __name__ == "__main__":
    configure_console()
    raise SystemExit(main())
