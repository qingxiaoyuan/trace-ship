"""
CommitReviewer 单元测试

覆盖通过、非法、警告以及 suggest 建议场景。
"""
import pytest

from utils.commit_reviewer import CommitReviewer


VALID_MESSAGE = """变更类型：
□ 无配置项改动 ☑有配置项改动

更新内容：
[A为功能增加 F为BUG修复]：
1. A 移除干扰用户绑定数据采集(DA)的逻辑
2. F 信号定时开关新增清除指令并优化控制逻辑

配置项改动[详见相关软件配置文件管理]：
[System]
DeviceType=0
"""


def test_review_pass():
    """测试符合规范的提交"""
    status, reason, parsed = CommitReviewer.review(VALID_MESSAGE)
    assert status == "pass"
    assert reason == ""
    assert parsed["change_type"] == "有配置项改动"


def test_review_illegal_missing_change_type():
    """测试缺少变更类型"""
    status, reason, parsed = CommitReviewer.review("fix bug")
    assert status == "illegal"
    assert "变更类型" in reason


def test_review_warning_bad_update_type():
    """测试更新类型不规范"""
    message = """变更类型：
☑ 无配置项改动 □有配置项改动

更新内容：
1. X 修复登录异常
"""
    status, reason, parsed = CommitReviewer.review(message)
    assert status == "warning"
    assert "A 或 F" in reason


def test_review_suggest():
    """测试建议输出"""
    suggestion = CommitReviewer.suggest(VALID_MESSAGE)
    assert "符合规范" in suggestion

    suggestion = CommitReviewer.suggest("bad message")
    assert suggestion != ""
