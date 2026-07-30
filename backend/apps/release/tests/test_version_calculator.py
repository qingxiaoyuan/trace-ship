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
        """忽略不符合版本规则的 tag（缺日期段、错前缀均不匹配）"""
        calculator = VersionCalculator(rule)
        tags = [
            _tag("v1.0.0_20251014"),
            _tag("VA.1.2.3"),
            _tag("VA.1.2.3_20251014", "b"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="formal")
        assert version == "VA.1.2.4"

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

    def test_rc_returns_latest_rc_suffixed(self, rule, mixed_tags):
        """rc 仅取 -rc 后缀的最新 tag"""
        calculator = VersionCalculator(rule)
        latest = calculator.find_latest_tag_by_type(mixed_tags, "rc")
        assert latest == "VA.1.0.8-rc_20260816"

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
        """扫描正则拒绝缺日期段、错前缀、未知后缀的 tag"""
        calculator = VersionCalculator({"prefix": "VB", "suffixes": {"rc": "rc", "beta": "beta"}})
        regex = calculator.build_scan_regex()
        assert not regex.match("VB.1.1.1")
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
