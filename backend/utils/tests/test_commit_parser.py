"""
CommitParser 单元测试

覆盖标准提交信息、缺少变更类型、缺少更新内容、配置项不一致等场景。
"""
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
    """测试标准提交信息解析"""
    result = CommitParser.parse(VALID_MESSAGE)
    assert result.is_valid is True
    assert result.change_type == "有配置项改动"
    assert len(result.updates) == 2
    assert result.updates[0]["type"] == "A"
    assert result.updates[1]["type"] == "F"
    assert result.config_changes == {"System": {"DeviceType": "0"}}
    assert result.related_changes == {"PXX板卡硬件版本": "1.0"}


def test_parse_missing_change_type_but_has_updates():
    """测试缺少变更类型但有 A/F 更新内容时视为合法"""
    message = "更新内容：\n[A为功能增加 F为BUG修复]：\n1. A xxx\nF yyy"
    result = CommitParser.parse(message)
    assert result.is_valid is True
    assert result.change_type == "无配置项改动"
    assert len(result.updates) == 2


def test_parse_missing_updates():
    """测试缺少更新内容"""
    message = """变更类型：
□ 无配置项改动 □有配置项改动
"""
    result = CommitParser.parse(message)
    assert result.is_valid is False
    assert "更新内容" in result.errors[0]


def test_parse_config_inconsistent():
    """测试声明有配置项改动但未提供"""
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
    """测试声明无配置项改动"""
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


@pytest.mark.parametrize(
    ("message", "update_type", "content"),
    [
        ("fix: 修复登录问题", "F", "修复登录问题"),
        ("FEAT(ui): 新增发布看板", "A", "新增发布看板"),
        ("<fix> 修复 SVN 推送", "F", "修复 SVN 推送"),
        ("<FeAt>: 新增扫描规则", "A", "新增扫描规则"),
    ],
)
def test_parse_fix_feat_prefix_as_updates(message, update_type, content):
    """兼容 fix/feat 与尖括号前缀，映射为 F/A 更新内容。"""
    result = CommitParser.parse(message)

    assert result.is_valid is True
    assert result.updates == [{"type": update_type, "content": content}]


def test_parse_multiline_fix_prefix_as_multiple_updates():
    """多行 fix/feat 提交的每个非空行继承同一更新类型。"""
    result = CommitParser.parse("fix: 修复登录问题\n\n修复超时提示\n补充错误日志")

    assert result.is_valid is True
    assert result.updates == [
        {"type": "F", "content": "修复登录问题"},
        {"type": "F", "content": "修复超时提示"},
        {"type": "F", "content": "补充错误日志"},
    ]


def test_parse_explicit_af_takes_priority_over_fix_feat_prefix():
    """已有 A/F 格式时不再按 fix/feat 拆分，保持原有解析结果。"""
    result = CommitParser.parse("feat: 发布模块\nF 修复版本号计算")

    assert result.updates == [{"type": "F", "content": "修复版本号计算"}]


def test_parse_plain_commit_with_embedded_a_or_f_is_not_auto_detected():
    """普通中文提交中的 A/F 字母不应触发自动解析，应留给发布页面人工确认。"""
    result = CommitParser.parse("提交A功能")

    assert result.updates == []
    assert result.is_valid is False


def test_parse_prefix_content_strips_leading_af_marker():
    """fix/feat 前缀路径下 content 不残留 A/F 标记。"""
    result = CommitParser.parse("feat: A 新增扫描规则")

    assert result.updates == [{"type": "A", "content": "新增扫描规则"}]

    result = CommitParser.parse("<fix> F 修复版本号计算")

    assert result.updates == [{"type": "F", "content": "修复版本号计算"}]


def test_parse_angle_prefix_block_in_template_middle():
    """<feat> 块位于模板中段（前面有 变更类型/更新内容 段落）也能解析。"""
    message = """变更类型：
☑ 无配置项改动 □有配置项改动

更新内容：
<feat>
新增导出 PDF
新增导出 Word
"""
    result = CommitParser.parse(message)

    assert result.is_valid is True
    assert result.updates == [
        {"type": "A", "content": "新增导出 PDF"},
        {"type": "A", "content": "新增导出 Word"},
    ]


def test_parse_angle_prefix_block_strips_leading_index():
    """<feat> 块内带序号的内容行剥离序号。"""
    message = "<feat>\n1. 功能一\n2、功能二"

    result = CommitParser.parse(message)

    assert result.updates == [
        {"type": "A", "content": "功能一"},
        {"type": "A", "content": "功能二"},
    ]


def test_parse_multiple_prefix_blocks_have_independent_types():
    """多个 <feat>/<fix> 块混合时各块类型独立。"""
    message = """<feat>
新增打包配置

<fix>
修复推送失败
"""
    result = CommitParser.parse(message)

    assert result.updates == [
        {"type": "A", "content": "新增打包配置"},
        {"type": "F", "content": "修复推送失败"},
    ]


def test_parse_prefix_block_stops_at_section_header():
    """前缀块遇到后续段落标题即截止，标题内容不混入更新条目。"""
    message = """<feat> 新增扫描规则

配置项改动[详见相关软件配置文件管理]：
[System]
DeviceType=0
"""
    result = CommitParser.parse(message)

    assert result.updates == [{"type": "A", "content": "新增扫描规则"}]
