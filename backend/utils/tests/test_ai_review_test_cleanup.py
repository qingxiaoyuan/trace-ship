"""原始并发用例失败时仍须清理线程和批次名额，pytest 必须带失败退出。"""

import os
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def test_ai_waiting_test_exits_with_failures_and_releases_slots(tmp_path):
    """在子进程跑真实用例，覆盖失败清理及 SQLite 读写竞争。"""
    plugin = tmp_path / "cleanup_failure_plugin.py"
    plugin.write_text('''
import threading

import pytest


@pytest.fixture(autouse=True, params=["assertion", "timeout", "partial_acquire", "sqlite_lock"])
def force_cleanup_failure(request, monkeypatch):
    from apps.workflow import ai_review_model
    from apps.workflow.services import WorkflowEngine

    slots = ai_review_model._BATCH_SLOTS
    acquire = slots.acquire
    threads_before = set(threading.enumerate())

    def fail(*args, **kwargs):
        raise AssertionError("故障注入：撤销前断言失败")

    if request.param == "assertion":
        monkeypatch.setattr(WorkflowEngine, "revoke_instance", fail)
    elif request.param == "timeout":
        # 不撤销，让真实 future.result(timeout=3) 超时。
        monkeypatch.setattr(WorkflowEngine, "revoke_instance", lambda *args: None)
    elif request.param == "partial_acquire":
        acquisitions = 0

        def partial_acquire(*args, **kwargs):
            nonlocal acquisitions
            acquisitions += 1
            return False if acquisitions == 2 else acquire(*args, **kwargs)

        monkeypatch.setattr(slots, "acquire", partial_acquire)
    else:
        from django.db import transaction

        from apps.workflow import ai_review

        read_locked = threading.Event()
        revoke_finished = threading.Event()
        validate = ai_review._is_current_execution
        revoke = WorkflowEngine.revoke_instance

        def hold_validation_read(*args):
            with transaction.atomic():
                current = validate(*args)
                if current:
                    read_locked.set()
                    assert revoke_finished.wait(2), "测试撤销未结束"
                return current

        def revoke_during_read(*args):
            try:
                # 未同步的原用例会与校验读取竞争；正确同步时工作线程仍停在名额等待处。
                read_locked.wait(0.5)
                return revoke(*args)
            finally:
                revoke_finished.set()

        monkeypatch.setattr(ai_review, "_is_current_execution", hold_validation_read)
        monkeypatch.setattr(WorkflowEngine, "revoke_instance", revoke_during_read)
    yield
    monkeypatch.setattr(slots, "acquire", acquire)
    assert not [thread for thread in threading.enumerate()
                if thread not in threads_before and thread.name.startswith("ThreadPoolExecutor")]
    held = 0
    try:
        while held < 2 and acquire(blocking=False):
            held += 1
        assert held == 2, "失败后泄漏批次名额"
        assert not acquire(blocking=False), "失败后重复释放批次名额"
    finally:
        for _ in range(held):
            slots.release()
''', encoding="utf-8")
    report = tmp_path / "failures.xml"
    environment = {**os.environ, "DJANGO_SETTINGS_MODULE": "config.settings.test", "PYTEST_ADDOPTS": ""}
    environment["PYTHONPATH"] = os.pathsep.join(filter(None, (str(tmp_path), environment.get("PYTHONPATH"))))
    command = [
        sys.executable, "-m", "pytest", "--no-cov", "-p", plugin.stem,
        "-o", f"cache_dir={tmp_path / 'cache'}", f"--junitxml={report}",
        "apps/release/tests/test_ai_review_node.py::test_single_batch_revoked_while_waiting_never_calls_model",
    ]
    result = subprocess.run(command, cwd=Path(__file__).resolve().parents[2], env=environment,
                            capture_output=True, text=True, timeout=40, check=False)
    output = result.stdout + result.stderr
    assert result.returncode == 1, output
    cases = ET.parse(report).findall(".//testcase")
    assert len(cases) == 4, output
    assert all(case.find("error") is None for case in cases), output
    locked_case = next(case for case in cases if "sqlite_lock" in case.attrib["name"])
    assert locked_case.find("failure") is None and locked_case.find("skipped") is None, output
    failures = {case.attrib["name"]: case.find("failure").text
                for case in cases if case.find("failure") is not None}
    assert len(failures) == 3, output
    assert "故障注入：撤销前断言失败" in next(value for name, value in failures.items() if "assertion" in name)
    assert "TimeoutError" in next(value for name, value in failures.items() if "timeout" in name)
    assert "未取得测试批次名额" in next(value for name, value in failures.items() if "partial_acquire" in name)
