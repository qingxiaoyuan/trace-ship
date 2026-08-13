"""
版本号计算器单元测试
"""
import pytest
from django.utils import timezone

from apps.release.services import VersionCalculator
from utils.provider.base import TagInfo

TODAY = timezone.now().strftime("%Y%m%d")


def _tag(name: str, commit_hash: str = "a") -> TagInfo:
    """构造 TagInfo"""
    return TagInfo(name=name, commit_hash=commit_hash)


class TestVersionCalculator:
    """VersionCalculator 测试类"""

    @pytest.fixture
    def rule(self):
        """版本号规则"""
        return {"prefix": "VA", "major": 1, "minor": 0, "patch": 0, "suffixes": {"rc": "rc", "beta": "beta"}}

    def test_calculate_initial_version_when_no_tags(self, rule):
        """无 tag 时使用初始版本号并拼接当天日期段"""
        calculator = VersionCalculator(rule)
        version, tag_name = calculator.calculate([], release_type="formal")
        assert version == "VA.1.0.0"
        assert tag_name == f"VA.1.0.0_{TODAY}"

    def test_calculate_increments_patch(self, rule):
        """默认递增修订号"""
        calculator = VersionCalculator(rule)
        tags = [
            _tag("VA.1.0.0_20251014"),
            _tag("VA.1.0.5_20251014", "b"),
            _tag("VA.1.0.10_20251014", "c"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="formal")
        assert version == "VA.1.0.11"
        assert tag_name == f"VA.1.0.11_{TODAY}"

    def test_calculate_ignores_non_matching_tags(self, rule):
        """忽略不符合版本规则的 tag（错前缀不匹配；无日期段的历史 tag 正常参与）"""
        calculator = VersionCalculator(rule)
        tags = [
            _tag("v1.0.0_20251014"),
            _tag("VA.1.2.4"),
            _tag("VA.1.2.3_20251014", "b"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="formal")
        assert version == "VA.1.2.5"

    def test_calculate_considers_legacy_tags_before_system_introduced(self):
        """系统接入前仓库已有的历史 tag 参与计算（如 VB.4.1.5_20250715）"""
        rule = {"prefix": "VB", "major": 1, "minor": 0, "patch": 0, "suffixes": {"rc": "rc", "beta": "beta"}}
        calculator = VersionCalculator(rule)
        tags = [
            _tag("VB.4.1.5_20250715"),
            _tag("VB.4.1.3_20250601", "b"),
            _tag("some-random-tag", "c"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="formal")
        assert version == "VB.4.1.6"
        assert tag_name == f"VB.4.1.6_{TODAY}"

    def test_calculate_considers_legacy_tags_without_date(self):
        """无日期段的历史 tag（如 VB.4.1.5）同样参与计算，新 tag 仍拼接当天日期段"""
        rule = {"prefix": "VB", "major": 1, "minor": 0, "patch": 0, "suffixes": {"rc": "rc", "beta": "beta"}}
        calculator = VersionCalculator(rule)
        tags = [
            _tag("VB.4.1.5"),
            _tag("VB.4.1.2_20250601", "b"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="formal")
        assert version == "VB.4.1.6"
        assert tag_name == f"VB.4.1.6_{TODAY}"

    def test_calculate_rc_considers_rc_tag_without_date(self, rule):
        """无日期段的 rc 历史 tag 参与 rc 版本递增"""
        calculator = VersionCalculator(rule)
        version, tag_name = calculator.calculate([_tag("VA.1.0.8-rc")], release_type="rc")
        assert version == "VA.1.0.9"
        assert tag_name == f"VA.1.0.9-rc_{TODAY}"

    def test_calculate_beta_no_existing_returns_initial(self, rule):
        """Beta 无已有 tag 时返回初始版本"""
        calculator = VersionCalculator(rule)
        tags = [_tag("VA.1.0.0_20251014")]
        version, tag_name = calculator.calculate(tags, release_type="beta")
        assert version == "VA.1.0.0"
        assert tag_name == f"VA.1.0.0-beta_{TODAY}"

    def test_calculate_beta_increments_from_beta_tag(self, rule):
        """Beta 有已有 beta tag 时递增修订号"""
        calculator = VersionCalculator(rule)
        tags = [
            _tag("VA.1.0.0_20251014"),
            _tag("VA.1.0.3-beta_20251014", "c"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="beta")
        assert version == "VA.1.0.4"
        assert tag_name == f"VA.1.0.4-beta_{TODAY}"

    def test_calculate_rc_increments_from_rc_tag(self, rule):
        """RC 有已有 rc tag 时递增修订号"""
        calculator = VersionCalculator(rule)
        tags = [
            _tag("VA.1.0.0_20251014"),
            _tag("VA.1.0.5-rc_20260816", "b"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="rc")
        assert version == "VA.1.0.6"
        assert tag_name == f"VA.1.0.6-rc_{TODAY}"

    def test_calculate_formal_independent_from_rc_beta(self, rule):
        """formal 独立计算，不受 rc/beta tag 影响"""
        calculator = VersionCalculator(rule)
        tags = [
            _tag("VA.1.0.0_20251014"),
            _tag("VA.1.0.5-rc_20251014", "b"),
            _tag("VA.1.0.3-beta_20251014", "c"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="formal")
        assert version == "VA.1.0.1"
        assert tag_name == f"VA.1.0.1_{TODAY}"

    def test_calculate_without_prefix(self):
        """未配置前缀时 tag 不含前缀段"""
        calculator = VersionCalculator({"major": 1, "minor": 0, "patch": 0})
        version, tag_name = calculator.calculate(
            [_tag("1.0.2_20251014")], release_type="formal"
        )
        assert version == "1.0.3"
        assert tag_name == f"1.0.3_{TODAY}"


class TestFindLatestTagByType:
    """find_latest_tag_by_type 按发布类型查找最新 tag 测试类"""

    @pytest.fixture
    def rule(self):
        """版本号规则"""
        return {"prefix": "VA", "major": 1, "minor": 0, "patch": 0, "suffixes": {"rc": "rc", "beta": "beta"}}

    @pytest.fixture
    def mixed_tags(self):
        """混合三类 tag"""
        return [
            _tag("VA.1.0.0_20251014"),
            _tag("VA.1.0.5_20251014", "b"),
            _tag("VA.1.0.2-rc_20251014", "c"),
            _tag("VA.1.0.8-rc_20260816", "d"),
            _tag("VA.1.0.1-beta_20251014", "e"),
            _tag("VA.1.0.3-beta_20251014", "f"),
            _tag("v1.0.0_20251014", "g"),
        ]

    def test_formal_returns_latest_unsuffixed(self, rule, mixed_tags):
        """formal 仅取无后缀的最新 tag"""
        calculator = VersionCalculator(rule)
        latest = calculator.find_latest_tag_by_type(mixed_tags, "formal")
        assert latest == "VA.1.0.5_20251014"

    def test_find_latest_matching_tag_returns_tag_info_and_values(self, rule, mixed_tags):
        """find_latest_matching_tag 返回最新正式版 TagInfo 与版本字段"""
        calculator = VersionCalculator(rule)
        latest = calculator.find_latest_matching_tag(mixed_tags)
        assert latest is not None
        tag, values = latest
        assert tag.name == "VA.1.0.5_20251014"
        assert tag.commit_hash == "b"
        assert values == {"major": 1, "minor": 0, "patch": 5}

    def test_find_latest_matching_tag_returns_none_when_no_match(self, rule):
        """无匹配 tag 时 find_latest_matching_tag 返回 None"""
        calculator = VersionCalculator(rule)
        assert calculator.find_latest_matching_tag([_tag("v1.0.0_20251014")]) is None

    def test_rc_returns_latest_rc_suffixed(self, rule, mixed_tags):
        """rc 仅取 -rc 后缀的最新 tag"""
        calculator = VersionCalculator(rule)
        latest = calculator.find_latest_tag_by_type(mixed_tags, "rc")
        assert latest == "VA.1.0.8-rc_20260816"

    def test_find_latest_tag_info_by_type_returns_info_and_type(self, rule, mixed_tags):
        """find_latest_tag_info_by_type 按类型返回最新 TagInfo（含 commit hash）"""
        calculator = VersionCalculator(rule)
        # formal：最新无后缀 tag
        formal = calculator.find_latest_tag_info_by_type(mixed_tags, "formal")
        assert formal is not None and formal.name == "VA.1.0.5_20251014"
        assert formal.commit_hash == "b"
        # rc：最新 -rc tag
        rc = calculator.find_latest_tag_info_by_type(mixed_tags, "rc")
        assert rc is not None and rc.name == "VA.1.0.8-rc_20260816"
        assert rc.commit_hash == "d"
        # beta：最新 -beta tag
        beta = calculator.find_latest_tag_info_by_type(mixed_tags, "beta")
        assert beta is not None and beta.name == "VA.1.0.3-beta_20251014"
        assert beta.commit_hash == "f"

    def test_find_latest_tag_info_by_type_none_when_no_match(self, rule):
        """无匹配类型 tag 时 find_latest_tag_info_by_type 返回 None"""
        calculator = VersionCalculator(rule)
        tags = [_tag("v1.0.0_20251014"), _tag("VA.1.0.1-rc_20251014")]
        assert calculator.find_latest_tag_info_by_type(tags, "formal") is None
        assert calculator.find_latest_tag_info_by_type(tags, "beta") is None
        assert calculator.find_latest_tag_info_by_type(tags, "rc") is not None

    def test_find_latest_tag_info_by_type_same_version_uses_newer_date(self, rule):
        """同版本号存在多个日期 tag 时，取日期段更新的 tag"""
        calculator = VersionCalculator(rule)
        tags = [
            _tag("VA.1.0.5_20260101", "old"),
            _tag("VA.1.0.5_20260201", "new"),
            _tag("VA.1.0.5", "nodate"),
        ]
        latest = calculator.find_latest_tag_info_by_type(tags, "formal")
        assert latest is not None
        assert latest.name == "VA.1.0.5_20260201"
        assert latest.commit_hash == "new"

    def test_beta_returns_latest_beta_suffixed(self, rule, mixed_tags):
        """beta 仅取 -beta 后缀的最新 tag"""
        calculator = VersionCalculator(rule)
        latest = calculator.find_latest_tag_by_type(mixed_tags, "beta")
        assert latest == "VA.1.0.3-beta_20251014"

    def test_returns_none_when_no_matching_tag(self, rule):
        """无匹配 tag 时返回 None"""
        calculator = VersionCalculator(rule)
        tags = [_tag("v1.0.0_20251014")]
        assert calculator.find_latest_tag_by_type(tags, "formal") is None
        assert calculator.find_latest_tag_by_type(tags, "rc") is None
        assert calculator.find_latest_tag_by_type(tags, "beta") is None

    def test_returns_none_when_no_tags(self, rule):
        """空 tag 列表时返回 None"""
        calculator = VersionCalculator(rule)
        assert calculator.find_latest_tag_by_type([], "formal") is None


class TestSortTagsByRecency:
    """sort_tags_by_recency 新近度排序测试类"""

    def test_mixed_tags_untimed_first_by_version_desc(self):
        """无创建时间的 tag 按版本号降序排最前，有时间的按 created_at 倒序"""
        from datetime import datetime

        from utils.provider.base import TagInfo

        calculator = VersionCalculator({})
        tags = [
            _tag("VA.1.0.1_20260101"),
            TagInfo(name="VA.1.0.0_20260101", created_at=datetime(2026, 1, 1)),
            TagInfo(name="VA.1.0.2_20260301", created_at=datetime(2026, 3, 1)),
        ]
        ordered = calculator.sort_tags_by_recency(tags)
        assert [t.name for t in ordered] == [
            "VA.1.0.1_20260101",
            "VA.1.0.2_20260301",
            "VA.1.0.0_20260101",
        ]

    def test_untimed_tags_sorted_by_version_desc(self):
        """全部无创建时间时按版本号数值降序（非字符串排序）"""
        calculator = VersionCalculator({})
        tags = [
            _tag("VA.1.0.0_20260101"),
            _tag("VA.1.0.10_20260101"),
            _tag("VA.1.0.2_20260101"),
        ]
        ordered = calculator.sort_tags_by_recency(tags)
        assert [t.name for t in ordered] == [
            "VA.1.0.10_20260101",
            "VA.1.0.2_20260101",
            "VA.1.0.0_20260101",
        ]


class TestBuildScanRegex:
    """build_scan_regex 扫描正则测试类"""

    def test_scan_regex_matches_all_types(self):
        """扫描正则同时匹配 formal / rc / beta 三种形态"""
        calculator = VersionCalculator({"prefix": "VB", "suffixes": {"rc": "rc", "beta": "beta"}})
        regex = calculator.build_scan_regex()
        assert regex.match("VB.1.1.1_20251014")
        assert regex.match("VB.1.1.2-rc_20260816")
        assert regex.match("VB.2.0.0-beta_20260101")

    def test_scan_regex_rejects_invalid(self):
        """扫描正则拒绝错前缀、未知后缀、缺段数的 tag；无日期段的历史 tag 允许入库"""
        calculator = VersionCalculator({"prefix": "VB", "suffixes": {"rc": "rc", "beta": "beta"}})
        regex = calculator.build_scan_regex()
        # 无日期段的历史 tag 可匹配，date 分组为 None
        no_date = regex.match("VB.1.1.1")
        assert no_date and no_date.group("date") is None
        assert not regex.match("VA.1.1.1_20251014")
        assert not regex.match("VB.1.1.1-alpha_20251014")
        assert not regex.match("VB.1.1_20251014")

    def test_scan_regex_without_prefix(self):
        """未配置前缀时匹配无前缀 tag"""
        calculator = VersionCalculator({})
        regex = calculator.build_scan_regex()
        match = regex.match("1.1.1_20251014")
        assert match
        assert match.group("major") == "1"
        assert match.group("date") == "20251014"


class TestWithDateOption:
    """with_date 开关测试：控制生成的 tag 是否携带 _YYYYMMDD 日期段"""

    def test_with_date_false_omits_date_suffix(self):
        """with_date=False 时生成的 tag 不含日期段"""
        rule = {"prefix": "VA", "major": 1, "minor": 0, "patch": 0, "with_date": False}
        calculator = VersionCalculator(rule)
        version, tag_name = calculator.calculate([], release_type="formal")
        assert version == "VA.1.0.0"
        assert tag_name == "VA.1.0.0"
        assert "_" not in tag_name

    def test_with_date_false_omits_date_suffix_rc(self):
        """with_date=False 时 rc 类型 tag 也不含日期段"""
        rule = {"prefix": "VA", "major": 1, "minor": 0, "patch": 0, "with_date": False}
        calculator = VersionCalculator(rule)
        version, tag_name = calculator.calculate([_tag("VA.1.0.0-rc")], release_type="rc")
        assert tag_name == "VA.1.0.1-rc"

    def test_with_date_true_appends_date_suffix(self):
        """with_date=True（默认）时 tag 含日期段"""
        rule = {"prefix": "VA", "major": 1, "minor": 0, "patch": 0, "with_date": True}
        calculator = VersionCalculator(rule)
        version, tag_name = calculator.calculate([], release_type="formal")
        assert tag_name == f"VA.1.0.0_{TODAY}"

    def test_with_date_defaults_to_true(self):
        """未配置 with_date 时默认为 True（兼容历史数据）"""
        rule = {"prefix": "VA", "major": 1, "minor": 0, "patch": 0}
        calculator = VersionCalculator(rule)
        assert calculator.with_date is True
        _, tag_name = calculator.calculate([], release_type="formal")
        assert tag_name.endswith(f"_{TODAY}")
