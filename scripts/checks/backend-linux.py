"""在独立 Linux/Python 3.11 容器执行与 CI 完全相同的后端检查。"""

from __future__ import annotations

import argparse
import os
import platform
import subprocess
from datetime import UTC, datetime
from pathlib import Path

# 同目录模块只依赖标准库；Windows 无需先安装后端依赖。
from backend import configure_console, git_value, stream_command, write_json

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "docker" / "docker-compose.checks.yml"
PUBLIC_PACKAGE_INDEXES = (
    "https://pypi.org/simple",
    "https://pypi.tuna.tsinghua.edu.cn/simple",
    "https://mirrors.aliyun.com/pypi/simple",
    "https://mirrors.huaweicloud.com/repository/pypi/simple",
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("check", choices=("lint", "test", "all"))
    parser.add_argument("--report-dir", type=Path, help="默认 tmp/checks/backend-本次 UTC 时间")
    # 只接受公开源，防止带凭据的私有索引 URL 进入构建日志或归档。
    parser.add_argument("--package-index", default=PUBLIC_PACKAGE_INDEXES[0], metavar="公开HTTPS源")
    args = parser.parse_args(argv)
    if args.package_index not in PUBLIC_PACKAGE_INDEXES:
        parser.error("仅支持已登记的公开 HTTPS 源；不接受带凭据的索引地址")
    report_dir = (args.report_dir or ROOT / "tmp" / "checks" / (
        "backend-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    )).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    owned_reports = (
        "container-result.json", "image-build.log", "image.json", "container-lint.log", "container-test.log", "lint", "test",
    )
    if any((report_dir / name).exists() for name in owned_reports):
        parser.error("证据目录已有容器检查报告，请为本次运行选择新目录")

    env = os.environ.copy()
    env.update({
        "TRACE_SHIP_CHECK_SOURCE": str(ROOT),
        "TRACE_SHIP_CHECK_REPORTS": str(report_dir),
        "TRACE_SHIP_CHECK_COMMIT": git_value("rev-parse", "HEAD"),
        "TRACE_SHIP_CHECK_DIRTY": git_value("status", "--porcelain") or "clean",
        "TRACE_SHIP_CHECK_PIP_INDEX_URL": args.package_index,
    })
    # 显式项目名不受 docker/.env 中开发环境的 COMPOSE_PROJECT_NAME 覆盖。
    compose = ["docker", "compose", "--project-name", "trace-ship-checks", "--file", str(COMPOSE)]
    started_at = datetime.now(UTC).isoformat()
    steps: list[dict[str, object]] = []
    build = [*compose, "build", "backend"]
    exit_code = stream_command(build, ROOT, env, report_dir / "image-build.log")
    steps.append({"stage": "build", "command": build, "exit_code": exit_code})
    if exit_code == 0:
        image = subprocess.run(
            ["docker", "image", "inspect", "trace-ship-backend-checks:py311"],
            cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", check=False,
        )
        (report_dir / "image.json").write_text(image.stdout + image.stderr, encoding="utf-8")
        steps.append({"stage": "image-inspect", "exit_code": image.returncode})
        if image.returncode:
            exit_code = image.returncode
    if exit_code == 0:
        for check in ("lint", "test") if args.check == "all" else (args.check,):
            command = [
                *compose, "run", "--rm", "--no-deps", "backend", "python",
                "/workspace/scripts/checks/backend.py", check, "--report-dir", f"/reports/{check}",
            ]
            result = stream_command(command, ROOT, env, report_dir / f"container-{check}.log")
            steps.append({"stage": check, "command": command, "exit_code": result})
            if result and exit_code == 0:
                exit_code = result
    write_json(report_dir / "container-result.json", {
        "started_at": started_at,
        "finished_at": datetime.now(UTC).isoformat(),
        "host_os": platform.platform(),
        "host_python": platform.python_version(),
        "commit": env["TRACE_SHIP_CHECK_COMMIT"],
        "working_tree": env["TRACE_SHIP_CHECK_DIRTY"],
        "package_index": args.package_index,
        "steps": steps,
        "exit_code": exit_code,
        "status": "passed" if exit_code == 0 else "failed",
    })
    print(f"检查证据：{report_dir}", flush=True)
    return exit_code


if __name__ == "__main__":
    configure_console()
    raise SystemExit(main())
