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
        return {"format": "VA.{major}.{minor}.{patch}", "initial": "VA.1.0.0"}

    def test_calculate_initial_version_when_no_tags(self, rule):
        """无 tag 时使用初始版本号"""
        calculator = VersionCalculator(rule)
        version, tag_name = calculator.calculate([], release_type="formal")
        assert version == "VA.1.0.0"
        assert tag_name == "VA.1.0.0"

    def test_calculate_increments_patch(self, rule):
        """默认递增 patch 版本号"""
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
        """忽略不符合 version_rule 的 tag"""
        calculator = VersionCalculator(rule)
        tags = [
            TagInfo(name="v1.0.0", commit_hash="a"),
            TagInfo(name="VA.1.2.3", commit_hash="b"),
        ]
        version, tag_name = calculator.calculate(tags, release_type="formal")
        assert version == "VA.1.2.4"

    def test_calculate_beta_version_adds_prefix(self, rule):
        """Beta 版本自动添加 beta 前缀"""
        calculator = VersionCalculator(rule)
        tags = [TagInfo(name="VA.1.0.0", commit_hash="a")]
        version, tag_name = calculator.calculate(tags, release_type="beta", prefixes={"beta": "beta"})
        assert version == "VA.1.0.1"
        assert tag_name == "beta-VA.1.0.1"
