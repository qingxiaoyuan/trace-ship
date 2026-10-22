"""PostgreSQL 行锁验收的报告门禁独立于数据库运行，拒绝未执行或失败证据。"""

import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import patch

import pytest

from utils.tests.test_backend_checks import load_entry, runner

with patch.dict(sys.modules, {"backend": runner}):
    postgresql = load_entry("postgresql_check_runner", "backend-postgresql.py")


def write_junit(path: Path, count: int = 9, outcome: str | None = None) -> None:
    """生成包含实际测试节点的 JUnit，汇总属性不能代替逐项执行证据。"""
    root = ET.Element("testsuites")
    suite = ET.SubElement(root, "testsuite", tests="9", failures="0", errors="0", skipped="0")
    for index in range(count):
        case = ET.SubElement(suite, "testcase", name=f"行锁行为{index + 1}")
        if index == 0 and outcome is not None:
            ET.SubElement(case, outcome, message="本项未成功完成")
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def test_postgresql_accepts_nine_executed_passing_tests(tmp_path: Path) -> None:
    """九项全部实际执行并通过才满足独立行锁验收。"""
    report = tmp_path / "junit.xml"
    write_junit(report)
    assert postgresql.validate_junit(report) == {"tests": 9, "skipped": 0, "failures": 0, "errors": 0}


@pytest.mark.parametrize("outcome", ["skipped", "failure", "error"])
def test_postgresql_rejects_any_unfinished_or_failing_test(tmp_path: Path, outcome: str) -> None:
    """即使汇总声称成功，任一实际节点跳过、断言失败或异常也不能通过。"""
    report = tmp_path / "junit.xml"
    write_junit(report, outcome=outcome)
    with pytest.raises(ValueError, match="无跳过或失败"):
        postgresql.validate_junit(report)


@pytest.mark.parametrize("count", [0, 1, 7, 8, 10])
def test_postgresql_rejects_missing_or_unexpected_execution_count(tmp_path: Path, count: int) -> None:
    """空报告、漏执行和意外范围都必须失败，不能只相信 JUnit 的 tests 汇总值。"""
    report = tmp_path / "junit.xml"
    write_junit(report, count=count)
    with pytest.raises(ValueError, match="必须执行 9 项"):
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
