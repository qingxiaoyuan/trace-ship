"""在一次性内部网络和 PostgreSQL 数据库中执行真实行锁回归。"""

from __future__ import annotations

import argparse
import json
import os
import platform
import secrets
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from backend import (
    BACKEND,
    ROOT,
    check_environment,
    configure_console,
    git_value,
    operating_system,
    runtime_directory,
    stream_command,
    write_json,
)

COMPOSE = ROOT / "docker" / "docker-compose.postgresql-checks.yml"
POSTGRES_IMAGE = "postgres:16-bookworm@sha256:0ea6700a3b4f0ae6ce746519073558aed4d88a79d8d07622a9a644946c7319c4"
PUBLIC_PACKAGE_INDEXES = (
    "https://pypi.org/simple",
    "https://pypi.tuna.tsinghua.edu.cn/simple",
    "https://mirrors.aliyun.com/pypi/simple",
    "https://mirrors.huaweicloud.com/repository/pypi/simple",
)
TEST_NODES = (
    "apps/release/tests/test_tag_cleanup.py::test_postgresql_task_creation_waits_for_cleanup",
    "apps/release/tests/test_rc_source.py::test_reselection_and_submission_serialize_on_postgresql",
    "apps/release/tests/test_version_reservation.py::test_postgresql_serializes_same_version_submissions",
    "apps/release/tests/test_version_reservation.py::test_postgresql_termination_waits_for_retry",
    "apps/release/tests/test_workflow_termination.py::test_postgresql_final_approval_and_termination_are_serialized",
    "apps/release/tests/test_workflow_termination.py::test_postgresql_final_approval_and_return_are_serialized",
    "apps/package/tests/test_release_repackage_postgresql.py",
)
EXPECTED_TESTS = 11


def validate_junit(path: Path) -> dict[str, int]:
    """任何未执行、跳过、失败或缺失报告都不能被计作 PostgreSQL 验证通过。"""
    cases = ET.parse(path).getroot().findall(".//testcase")
    counts = {
        "tests": len(cases),
        "skipped": sum(case.find("skipped") is not None for case in cases),
        "failures": sum(case.find("failure") is not None for case in cases),
        "errors": sum(case.find("error") is not None for case in cases),
    }
    if counts["tests"] != EXPECTED_TESTS or any(counts[key] for key in ("skipped", "failures", "errors")):
        raise ValueError(f"PostgreSQL 行锁检查必须执行 {EXPECTED_TESTS} 项且无跳过或失败：{counts}")
    return counts


def run_inside(report_dir: Path) -> int:
    """只能由专用 Compose 环境启动，固定测试设置并记录数据库实际身份。"""
    if (
        platform.system() != "Linux"
        or sys.version_info[:2] != (3, 11)
        or os.environ.get("TRACE_SHIP_POSTGRES_CHECKS") != "1"
    ):
        print("PostgreSQL 检查要求隔离 Linux/Python 3.11 容器，请使用默认宿主入口。", file=sys.stderr)
        return 2
    report_dir.mkdir(parents=True, exist_ok=True)
    if (report_dir / "postgresql-result.json").exists() or (report_dir / "junit.xml").exists():
        raise ValueError("证据目录已有 PostgreSQL 报告，请选择新目录")
    env = check_environment(report_dir)
    env["DJANGO_SETTINGS_MODULE"] = "config.settings.postgresql_check"
    metadata = {
        "started_at": datetime.now(UTC).isoformat(),
        "commit": os.environ.get("TRACE_SHIP_CHECK_COMMIT") or git_value("rev-parse", "HEAD"),
        "working_tree": os.environ.get("TRACE_SHIP_CHECK_DIRTY") or git_value("status", "--porcelain"),
        "os": operating_system(),
        "python": platform.python_version(),
        "settings": env["DJANGO_SETTINGS_MODULE"],
        "database_host": "postgres",
        "database_name": "trace_ship_checks_test",
        "scope": list(TEST_NODES),
        "coverage": "定点并发验证；原 SQLite 全量检查及覆盖率门槛独立保留",
    }
    # 在 pytest 前确认实际连接成功，不能让 SQLite skip 掩盖缺失的 PostgreSQL。
    probe = [sys.executable, "-c", (
        "import django,json; django.setup(); from django.db import connection; "
        "assert connection.vendor == 'postgresql'; "
        "cursor=connection.cursor(); cursor.execute('SELECT version()'); "
        "print(json.dumps({'vendor':connection.vendor,'version':cursor.fetchone()[0]})); connection.close()"
    )]
    exit_code = stream_command(probe, BACKEND, env, report_dir / "database-environment.json")
    counts: dict[str, int] = {}
    check_executed = False
    if exit_code == 0:
        dependencies = subprocess.run(
            [sys.executable, "-m", "pip", "freeze"], cwd=BACKEND, env=env,
            capture_output=True, text=True, encoding="utf-8", errors="replace", check=False,
        )
        (report_dir / "backend-dependencies.txt").write_text(
            dependencies.stdout + dependencies.stderr, encoding="utf-8",
        )
        exit_code = dependencies.returncode
    if exit_code == 0:
        command = [
            sys.executable, "-m", "pytest", "--ds=config.settings.postgresql_check", "--no-cov",
            f"--junitxml={report_dir / 'junit.xml'}", "-o", f"cache_dir={runtime_directory(report_dir) / 'pytest'}",
            *TEST_NODES,
        ]
        metadata["command"] = command
        check_executed = True
        exit_code = stream_command(command, BACKEND, env, report_dir / "postgresql-check.log")
        try:
            counts = validate_junit(report_dir / "junit.xml")
        except (OSError, ValueError, ET.ParseError) as error:
            print(f"PostgreSQL 报告校验失败：{error}", file=sys.stderr)
            exit_code = exit_code or 1
    write_json(report_dir / "postgresql-result.json", {
        **metadata, "finished_at": datetime.now(UTC).isoformat(), "check_executed": check_executed,
        "counts": counts, "exit_code": exit_code, "status": "passed" if exit_code == 0 else "failed",
    })
    return exit_code


def inspect_image(image: str, path: Path) -> int:
    """仅保存镜像身份，不归档包含临时密码的容器环境。"""
    result = subprocess.run(
        ["docker", "image", "inspect", image, "--format", "{{json .}}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=False,
    )
    if result.returncode:
        path.write_text(result.stderr, encoding="utf-8")
        return result.returncode
    image_data = json.loads(result.stdout)
    write_json(path, {key: image_data.get(key) for key in ("Id", "RepoDigests", "Architecture", "Os", "Created")})
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-dir", type=Path)
    parser.add_argument("--package-index", default=PUBLIC_PACKAGE_INDEXES[0], metavar="公开HTTPS源")
    parser.add_argument("--inside-container", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.package_index not in PUBLIC_PACKAGE_INDEXES:
        parser.error("仅支持已登记的公开 HTTPS 源；不接受带凭据的索引地址")
    report_dir = (args.report_dir or ROOT / "tmp" / "checks" / (
        "postgresql-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    )).resolve()
    if args.inside_container:
        return run_inside(report_dir)
    report_dir.mkdir(parents=True, exist_ok=True)
    if any(report_dir.glob("*.log")) or (report_dir / "container-result.json").exists() or (report_dir / "test").exists():
        parser.error("证据目录已有检查报告，请为本次运行选择新目录")
    project = "trace-ship-pg-checks-" + uuid4().hex[:12]
    env = os.environ.copy()
    env.update({
        "TRACE_SHIP_CHECK_SOURCE": str(ROOT), "TRACE_SHIP_CHECK_REPORTS": str(report_dir),
        "TRACE_SHIP_CHECK_COMMIT": git_value("rev-parse", "HEAD"),
        "TRACE_SHIP_CHECK_DIRTY": git_value("status", "--porcelain") or "clean",
        "TRACE_SHIP_CHECK_PIP_INDEX_URL": args.package_index,
        "TRACE_SHIP_POSTGRES_IMAGE": POSTGRES_IMAGE,
        "TRACE_SHIP_POSTGRES_PASSWORD": secrets.token_urlsafe(32),
    })
    compose = ["docker", "compose", "--project-name", project, "--file", str(COMPOSE)]
    steps: list[dict[str, object]] = []
    exit_code = 0
    started_at = datetime.now(UTC).isoformat()
    try:
        for stage, command in (
            ("build", [*compose, "build", "backend"]),
            ("database-start", [*compose, "up", "--wait", "--wait-timeout", "90", "postgres"]),
            ("test", [*compose, "run", "--rm", "--no-deps", "backend", "python",
                      "/workspace/scripts/checks/backend-postgresql.py", "--inside-container",
                      "--report-dir", "/reports/test"]),
        ):
            exit_code = stream_command(command, ROOT, env, report_dir / f"{stage}.log")
            steps.append({"stage": stage, "exit_code": exit_code})
            if exit_code:
                break
            if stage == "database-start":
                for name, image in (("postgresql", POSTGRES_IMAGE), ("backend", "trace-ship-backend-checks:py311")):
                    inspected = inspect_image(image, report_dir / f"{name}-image.json")
                    steps.append({"stage": f"inspect-{name}", "exit_code": inspected})
                    exit_code = exit_code or inspected
                if exit_code:
                    break
    except KeyboardInterrupt:
        exit_code = 130
        print("PostgreSQL 检查已中断，执行本次隔离资源清理。", file=sys.stderr)
    except (OSError, ValueError) as error:
        exit_code = 1
        print(f"PostgreSQL 检查未完成：{error}", file=sys.stderr)
    finally:
        # 唯一项目名限定清理范围，不操作其他开发、业务容器或持久卷。
        cleanup_code = stream_command([*compose, "down", "--timeout", "10"], ROOT, env, report_dir / "cleanup.log")
        steps.append({"stage": "cleanup", "exit_code": cleanup_code})
        exit_code = exit_code or cleanup_code
        write_json(report_dir / "container-result.json", {
            "started_at": started_at, "finished_at": datetime.now(UTC).isoformat(),
            "host_os": platform.platform(), "host_python": platform.python_version(),
            "commit": env["TRACE_SHIP_CHECK_COMMIT"], "working_tree": env["TRACE_SHIP_CHECK_DIRTY"],
            "project": project, "postgresql_image": POSTGRES_IMAGE, "package_index": args.package_index,
            "steps": steps, "cleanup_exit_code": cleanup_code, "exit_code": exit_code,
            "status": "passed" if exit_code == 0 else "failed",
        })
    print(f"PostgreSQL 检查证据：{report_dir}", flush=True)
    return exit_code


if __name__ == "__main__":
    configure_console()
    raise SystemExit(main())
