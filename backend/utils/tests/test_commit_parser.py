import pytest
from datetime import datetime

from utils.commit_parser import CommitParser


VALID_MESSAGE = """变更类型：
□ 无配置项改动 ☑有配置项改动

更新内容：
[A为功能增加 F为BUG修复]：
1. A 移除干扰用户绑定数据采集(DA)的逻辑
2. F 信号定时开关新增清除指令并优化控制逻辑

配置项改动[详见相关软件配置文件管理]：
[System]
DeviceType=0

关联性改动[选填]：
PXX板卡硬件版本: 1.0
"""


def test_parse_valid_commit():
    result = CommitParser.parse(VALID_MESSAGE)
    assert result.is_valid is True
    assert result.change_type == "有配置项改动"
    assert len(result.updates) == 2
    assert result.updates[0]["type"] == "A"
    assert result.updates[1]["type"] == "F"
    assert result.config_changes == {"System": {"DeviceType": "0"}}
    assert result.related_changes == {"PXX板卡硬件版本": "1.0"}


def test_parse_missing_change_type():
    message = "更新内容：\n[A为功能增加 F为BUG修复]：\n1. A xxx"
    result = CommitParser.parse(message)
    assert result.is_valid is False
    assert "变更类型" in result.errors[0]


def test_parse_missing_updates():
    message = """变更类型：
□ 无配置项改动 □有配置项改动
"""
    result = CommitParser.parse(message)
    assert result.is_valid is False
    assert "更新内容" in result.errors[0]


def test_parse_config_inconsistent():
    message = """变更类型：
□ 无配置项改动 ☑有配置项改动

更新内容：
[A为功能增加 F为BUG修复]：
1. A xxx
"""
    result = CommitParser.parse(message)
    assert result.is_valid is False
    assert "配置项改动" in result.errors[0]


def test_parse_no_config_declared():
    message = """变更类型：
☑ 无配置项改动 □有配置项改动

更新内容：
[A为功能增加 F为BUG修复]：
1. A xxx
"""
    result = CommitParser.parse(message)
    assert result.is_valid is True
    assert result.change_type == "无配置项改动"
    assert result.config_changes == {}
