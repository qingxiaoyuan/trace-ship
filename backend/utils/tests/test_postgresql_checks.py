"""PostgreSQL 行锁验收的报告门禁独立于数据库运行，拒绝未执行或失败证据。"""

import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

import pytest

from utils.tests.test_backend_checks import load_entry, runner

with patch.dict(sys.modules, {"backend": runner}):
    postgresql = load_entry("postgresql_check_runner", "backend-postgresql.py")


# 与共享检查入口实际收集的参数化测试一致，分别代表 14 次行锁行为。
TEST_CASES = (
    "test_postgresql_task_creation_waits_for_cleanup",
    "test_reselection_and_submission_serialize_on_postgresql",
    "test_postgresql_serializes_same_version_submissions",
    "test_postgresql_termination_waits_for_retry",
    "test_postgresql_final_approval_and_termination_are_serialized[approve]",
    "test_postgresql_final_approval_and_termination_are_serialized[terminate]",
    "test_postgresql_final_approval_and_return_are_serialized[approve]",
    "test_postgresql_final_approval_and_return_are_serialized[return]",
    "test_postgresql_adoption_and_approval_are_serialized[adopt]",
    "test_postgresql_adoption_and_approval_are_serialized[approve]",
    "test_postgresql_review_snapshot_waits_for_complete_model_save",
    "test_repackage_waits_for_config_change_and_revalidates[disabled-400]",
    "test_repackage_waits_for_config_change_and_revalidates[moved-project-403]",
    "test_config_writer_waits_for_repackage_snapshot",
)


def test_postgresql_scope_includes_all_fourteen_cases() -> None:
    """明确固定检查入口和参数化用例数量，范围调整时须同步验收门禁。"""
    assert postgresql.TEST_NODES == (
        "apps/release/tests/test_tag_cleanup.py::test_postgresql_task_creation_waits_for_cleanup",
        "apps/release/tests/test_rc_source.py::test_reselection_and_submission_serialize_on_postgresql",
        "apps/release/tests/test_version_reservation.py::test_postgresql_serializes_same_version_submissions",
        "apps/release/tests/test_version_reservation.py::test_postgresql_termination_waits_for_retry",
        "apps/release/tests/test_workflow_termination.py::test_postgresql_final_approval_and_termination_are_serialized",
        "apps/release/tests/test_workflow_termination.py::test_postgresql_final_approval_and_return_are_serialized",
        "apps/release/tests/test_ai_remediation.py::test_postgresql_adoption_and_approval_are_serialized",
        "apps/system/tests/test_ai_settings.py::test_postgresql_review_snapshot_waits_for_complete_model_save",
        "apps/package/tests/test_release_repackage_postgresql.py",
    )
    assert len(TEST_CASES) == postgresql.EXPECTED_TESTS == 14


def write_junit(path: Path, count: int = 14, outcome: str | None = None) -> None:
    """生成包含实际测试节点的 JUnit，汇总属性不能代替逐项执行证据。"""
    root = ET.Element("testsuites")
    suite = ET.SubElement(root, "testsuite", tests="14", failures="0", errors="0", skipped="0")
    for index in range(count):
        case = ET.SubElement(suite, "testcase", name=TEST_CASES[index] if index < len(TEST_CASES) else f"额外用例{index + 1}")
        if index == 0 and outcome is not None:
            ET.SubElement(case, outcome, message="本项未成功完成")
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def test_postgresql_accepts_fourteen_executed_passing_tests(tmp_path: Path) -> None:
    """十四项全部实际执行并通过才满足独立行锁验收。"""
    report = tmp_path / "junit.xml"
    write_junit(report)
    assert postgresql.validate_junit(report) == {"tests": 14, "skipped": 0, "failures": 0, "errors": 0}


@pytest.mark.parametrize("outcome", ["skipped", "failure", "error"])
def test_postgresql_rejects_any_unfinished_or_failing_test(tmp_path: Path, outcome: str) -> None:
    """即使汇总声称成功，任一实际节点跳过、断言失败或异常也不能通过。"""
    report = tmp_path / "junit.xml"
    write_junit(report, outcome=outcome)
    with pytest.raises(ValueError, match="无跳过或失败"):
        postgresql.validate_junit(report)


@pytest.mark.parametrize("count", [0, 1, 7, 9, 10, 11, 12, 13, 15])
def test_postgresql_rejects_missing_or_unexpected_execution_count(tmp_path: Path, count: int) -> None:
    """空报告、漏执行和意外范围都必须失败，不能只相信 JUnit 的 tests 汇总值。"""
    report = tmp_path / "junit.xml"
    write_junit(report, count=count)
    with pytest.raises(ValueError, match="必须执行 14 项"):
        postgresql.validate_junit(report)


def test_postgresql_rejects_missing_report(tmp_path: Path) -> None:
    """缺失报告不能被解释为零失败。"""
    with pytest.raises(FileNotFoundError):
        postgresql.validate_junit(tmp_path / "not-created.xml")


def test_postgresql_rejects_truncated_report(tmp_path: Path) -> None:
    """检查或归档中断留下的不完整 XML 不能成为通过证据。"""
    report = tmp_path / "junit.xml"
    report.write_text("<testsuites><testsuite>", encoding="utf-8")
    with pytest.raises(ET.ParseError):
        postgresql.validate_junit(report)
