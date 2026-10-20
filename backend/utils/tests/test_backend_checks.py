"""检查入口必须保留失败、隔离业务环境，并能重现完整 CI 范围。"""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from types import ModuleType
from typing import Any
from unittest.mock import patch

import pytest

CHECKS = Path(__file__).resolve().parents[3] / "scripts" / "checks"


def load_entry(name: str, filename: str) -> ModuleType:
    specification = importlib.util.spec_from_file_location(name, CHECKS / filename)
    assert specification is not None and specification.loader is not None
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


runner = load_entry("backend_check_runner", "backend.py")
with patch.dict(sys.modules, {"backend": runner}):
    container = load_entry("backend_container_runner", "backend-linux.py")


def read_result(directory: Path, filename: str = "backend-result.json") -> dict[str, Any]:
    return json.loads((directory / filename).read_text(encoding="utf-8"))


def test_subprocess_failure_keeps_exit_code_and_both_output_streams(
    tmp_path: Path, capsys: pytest.CaptureFixture[str],
) -> None:
    """记录日志不能像缺少 pipefail 的 tee 一样把失败变成通过。"""
    log = tmp_path / "check.log"
    exit_code = runner.stream_command(
        [sys.executable, "-c", "import sys; print('中文日志', flush=True); print('错误原因', file=sys.stderr); sys.exit(7)"],
        tmp_path, {**os.environ, "PYTHONIOENCODING": "utf-8"}, log,
    )
    assert exit_code == 7
    assert "中文日志" in log.read_text(encoding="utf-8")
    assert "错误原因" in log.read_text(encoding="utf-8")
    assert "中文日志" in capsys.readouterr().out


def test_check_environment_overrides_production_and_host_pytest_options(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DJANGO_SETTINGS_MODULE", "config.settings.prod")
    monkeypatch.setenv("PYTEST_ADDOPTS", "--no-cov -k only_one_test")
    monkeypatch.setenv("PACKAGE_WORKSPACE_ROOT", "/real-business-workspaces")
    monkeypatch.delenv("TRACE_SHIP_CHECK_RUNTIME_DIR", raising=False)
    env = runner.check_environment(tmp_path)
    assert env["DJANGO_SETTINGS_MODULE"] == "config.settings.test"
    assert env["PACKAGE_WORKSPACE_ROOT"] == str(tmp_path / "runtime" / "package-workspaces")
    assert env["COVERAGE_FILE"] == str(tmp_path / ".coverage")
    assert "PYTEST_ADDOPTS" not in env
    assert Path(env["TMPDIR"]).is_dir()


def test_container_runtime_can_use_native_storage_instead_of_report_mount(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    reports = tmp_path / "reports"
    native_runtime = tmp_path / "native-runtime"
    monkeypatch.setenv("TRACE_SHIP_CHECK_RUNTIME_DIR", str(native_runtime))
    env = runner.check_environment(reports)
    assert env["PACKAGE_WORKSPACE_ROOT"] == str(native_runtime / "package-workspaces")
    assert env["TMPDIR"] == str(native_runtime / "tmp")
    assert env["COVERAGE_FILE"] == str(reports / ".coverage")
    assert f"cache_dir={native_runtime / 'pytest'}" in runner.check_command("test", reports)


def test_test_failure_is_reported_even_when_coverage_may_pass(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(runner.sys, "version_info", (3, 11, 17))
    monkeypatch.setattr(runner, "git_value", lambda *args: "test-commit")
    freeze = subprocess.CompletedProcess([], 0, stdout="pytest==8.4.2\n", stderr="")
    monkeypatch.setattr(runner.subprocess, "run", lambda *args, **kwargs: freeze)
    calls: list[tuple[list[str], Path, dict[str, str]]] = []

    def failing_check(command: list[str], cwd: Path, env: dict[str, str], log: Path) -> int:
        calls.append((command, cwd, env))
        log.write_text("1 failed; coverage 89%\n", encoding="utf-8")
        return 1

    monkeypatch.setattr(runner, "stream_command", failing_check)
    assert runner.main(["test", "--report-dir", str(tmp_path)]) == 1
    assert read_result(tmp_path)["status"] == "failed"
    assert read_result(tmp_path)["exit_code"] == 1
    assert read_result(tmp_path)["check_executed"] is True
    command, cwd, env = calls[0]
    assert command[1:3] == ["-m", "pytest"]
    # 覆盖率门槛由 pytest.ini 决定；入口不得覆盖现有或将来提高的门槛。
    assert not any(argument.startswith("--cov-fail-under") for argument in command)
    assert not any(argument in command for argument in ("--no-cov", "-k", "-x"))
    assert cwd == runner.BACKEND
    assert env["DJANGO_SETTINGS_MODULE"] == "config.settings.test"
    assert (tmp_path / "backend-dependencies.txt").read_text(encoding="utf-8") == freeze.stdout


def test_wrong_python_version_cannot_produce_a_passing_standard_check(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(runner.sys, "version_info", (3, 12, 0))
    monkeypatch.setattr(runner, "git_value", lambda *args: "test-commit")
    assert runner.main(["lint", "--report-dir", str(tmp_path)]) == 2
    assert read_result(tmp_path)["exit_code"] == 2
    assert read_result(tmp_path)["check_executed"] is False
    assert not (tmp_path / "backend-check.log").exists()


def test_old_evidence_is_not_reused(tmp_path: Path) -> None:
    (tmp_path / "junit.xml").write_text("old report", encoding="utf-8")
    with pytest.raises(SystemExit) as error:
        runner.main(["test", "--report-dir", str(tmp_path)])
    assert error.value.code == 2
    assert (tmp_path / "junit.xml").read_text(encoding="utf-8") == "old report"


def test_container_all_continues_after_lint_failure_and_reports_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    # CI 先记录宿主环境并启动 tee，不应与容器证据产生冲突。
    (tmp_path / "environment.txt").write_text("CI runner", encoding="utf-8")
    (tmp_path / "check.log").write_text("outer tee", encoding="utf-8")
    monkeypatch.setattr(container, "git_value", lambda *args: "test-commit")
    monkeypatch.setattr(
        container.subprocess, "run",
        lambda *args, **kwargs: subprocess.CompletedProcess([], 0, stdout='[{"Id": "sha256:test-image"}]', stderr=""),
    )
    outcomes = iter((0, 4, 0))
    commands: list[list[str]] = []

    def execute(command: list[str], cwd: Path, env: dict[str, str], log: Path) -> int:
        commands.append(command)
        assert env["TRACE_SHIP_CHECK_SOURCE"] == str(container.ROOT)
        assert env["TRACE_SHIP_CHECK_REPORTS"] == str(tmp_path)
        assert env["TRACE_SHIP_CHECK_PIP_INDEX_URL"] == "https://pypi.tuna.tsinghua.edu.cn/simple"
        return next(outcomes)

    monkeypatch.setattr(container, "stream_command", execute)
    assert container.main([
        "all", "--report-dir", str(tmp_path), "--package-index", "https://pypi.tuna.tsinghua.edu.cn/simple",
    ]) == 4
    report = read_result(tmp_path, "container-result.json")
    assert [step["stage"] for step in report["steps"]] == ["build", "image-inspect", "lint", "test"]
    assert [step["exit_code"] for step in report["steps"]] == [0, 0, 4, 0]
    assert report["status"] == "failed"
    assert report["package_index"] == "https://pypi.tuna.tsinghua.edu.cn/simple"
    assert commands[0][2:4] == ["--project-name", "trace-ship-checks"]
    assert commands[-1][-3:] == ["test", "--report-dir", "/reports/test"]


def test_container_build_failure_leaves_checks_unexecuted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(container, "git_value", lambda *args: "test-commit")
    monkeypatch.setattr(container, "stream_command", lambda *args: 127)
    assert container.main(["all", "--report-dir", str(tmp_path)]) == 127
    report = read_result(tmp_path, "container-result.json")
    assert len(report["steps"]) == 1
    assert report["steps"][0]["stage"] == "build"
    assert report["exit_code"] == 127


def test_private_index_is_rejected_without_exposing_credentials(
    tmp_path: Path, capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as error:
        container.main([
            "test", "--report-dir", str(tmp_path), "--package-index", "https://user:private-token@example.com/simple",
        ])
    assert error.value.code == 2
    assert "private-token" not in capsys.readouterr().err
    assert not (tmp_path / "container-result.json").exists()
