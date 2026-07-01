"""
版本号计算器单元测试
"""
import pytest
from datetime import datetime, timezone as tz

from apps.release.services import VersionCalculator
from utils.provider.base import TagInfo


class TestVersionCalculator:
    """VersionCalculator 测试类"""

    @pytest.fixture
    def rule(self):
        """版本号规则"""
        return {"prefix": "VA", "major": 1, "minor": 0, "patch": 0, "suffixes": {"rc": "rc", "beta": "beta"}}

    def test_calculate_initial_version_when_no_tags(self, rule):
        """无 tag 时使用初始版本号"""
        calculator = VersionCalculator(rule)
        version, tag_name = calculator.calculate([], release_type="formal")
        assert version == "VA.1.0.0"
        assert tag_name == "VA.1.0.0"

    def test_calculate_increments_patch(self, rule):
        """默认递增修订号"""
        calculator = VersionCalculator(rule)
        tags = [
            TagInfo(name="VA.1.0.0", commit_hash="a"),
            TagInfo(name="VA.1.0.5", commit_hash="b"),
            TagInfo(name="VA.1.0.10", commit_hash="c"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="formal")
        assert version == "VA.1.0.11"
        assert tag_name == "VA.1.0.11"

    def test_calculate_ignores_non_matching_tags(self, rule):
        """忽略不符合版本规则的 tag"""
        calculator = VersionCalculator(rule)
        tags = [
            TagInfo(name="v1.0.0", commit_hash="a"),
            TagInfo(name="VA.1.2.3", commit_hash="b"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="formal")
        assert version == "VA.1.2.4"

    def test_calculate_beta_no_existing_returns_initial(self, rule):
        """Beta 无已有 tag 时返回初始版本"""
        calculator = VersionCalculator(rule)
        tags = [TagInfo(name="VA.1.0.0", commit_hash="a")]
        version, tag_name = calculator.calculate(tags, release_type="beta")
        assert version == "VA.1.0.0"
        assert tag_name == "VA.1.0.0-beta"

    def test_calculate_beta_increments_from_beta_tag(self, rule):
        """Beta 有已有 beta tag 时递增修订号"""
        calculator = VersionCalculator(rule)
        tags = [
            TagInfo(name="VA.1.0.0", commit_hash="a"),
            TagInfo(name="VA.1.0.3-beta", commit_hash="c"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="beta")
        assert version == "VA.1.0.4"
        assert tag_name == "VA.1.0.4-beta"

    def test_calculate_rc_no_existing_returns_initial(self, rule):
        """RC 无已有 tag 时返回初始版本"""
        calculator = VersionCalculator(rule)
        tags = [TagInfo(name="VA.1.0.0", commit_hash="a")]
        version, tag_name = calculator.calculate(tags, release_type="rc")
        assert version == "VA.1.0.0"
        assert tag_name == "VA.1.0.0-rc"

    def test_calculate_rc_increments_from_old_prefix_tag(self, rule):
        """RC 兼容旧前缀格式 rc-1.0.0 并递增"""
        calculator = VersionCalculator(rule)
        tags = [
            TagInfo(name="VA.1.0.0", commit_hash="a"),
            TagInfo(name="rc-VA.1.0.5", commit_hash="b"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="rc")
        assert version == "VA.1.0.6"
        assert tag_name == "VA.1.0.6-rc"

    def test_calculate_formal_independent_from_rc_beta(self, rule):
        """formal 独立计算，不受 rc/beta tag 影响"""
        calculator = VersionCalculator(rule)
        tags = [
            TagInfo(name="VA.1.0.0", commit_hash="a"),
            TagInfo(name="VA.1.0.5-rc", commit_hash="b"),
            TagInfo(name="VA.1.0.3-beta", commit_hash="c"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="formal")
        assert version == "VA.1.0.1"
        assert tag_name == "VA.1.0.1"


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
            TagInfo(name="VA.1.0.0", commit_hash="a"),
            TagInfo(name="VA.1.0.5", commit_hash="b"),
            TagInfo(name="VA.1.0.2-rc", commit_hash="c"),
            TagInfo(name="VA.1.0.8-rc", commit_hash="d"),
            TagInfo(name="VA.1.0.1-beta", commit_hash="e"),
            TagInfo(name="VA.1.0.3-beta", commit_hash="f"),
            TagInfo(name="v1.0.0", commit_hash="g"),
        ]

    def test_formal_returns_latest_unsuffixed(self, rule, mixed_tags):
        """formal 仅取无后缀的最新 tag"""
        calculator = VersionCalculator(rule)
        latest = calculator.find_latest_tag_by_type(mixed_tags, "formal")
        assert latest == "VA.1.0.5"

    def test_rc_returns_latest_rc_suffixed(self, rule, mixed_tags):
        """rc 仅取 -rc 后缀的最新 tag"""
        calculator = VersionCalculator(rule)
        latest = calculator.find_latest_tag_by_type(mixed_tags, "rc")
        assert latest == "VA.1.0.8-rc"

    def test_beta_returns_latest_beta_suffixed(self, rule, mixed_tags):
        """beta 仅取 -beta 后缀的最新 tag"""
        calculator = VersionCalculator(rule)
        latest = calculator.find_latest_tag_by_type(mixed_tags, "beta")
        assert latest == "VA.1.0.3-beta"

    def test_returns_none_when_no_matching_tag(self, rule):
        """无匹配 tag 时返回 None"""
        calculator = VersionCalculator(rule)
        tags = [TagInfo(name="v1.0.0", commit_hash="a")]
        assert calculator.find_latest_tag_by_type(tags, "formal") is None
        assert calculator.find_latest_tag_by_type(tags, "rc") is None
        assert calculator.find_latest_tag_by_type(tags, "beta") is None

    def test_returns_none_when_no_tags(self, rule):
        """空 tag 列表时返回 None"""
        calculator = VersionCalculator(rule)
        assert calculator.find_latest_tag_by_type([], "formal") is None
