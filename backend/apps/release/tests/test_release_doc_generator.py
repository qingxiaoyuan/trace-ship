"""
发布说明生成器单元测试
"""
import pytest
from datetime import datetime, timezone as tz

from apps.release.services import ReleaseDocGenerator
from utils.provider.base import CommitInfo


class MockProvider:
    """用于发布说明生成的模拟 GitProvider"""

    def __init__(self, commits=None, tags=None):
        self.commits = commits or []
        self.tags = tags or []

    def list_tags(self, repo_identity: str):
        return self.tags

    def list_commits(self, repo_identity: str, branch: str, since=None, until=None, per_page=100):
        return self.commits

    def compare_commits(self, repo_identity: str, base: str, head: str):
        return self.commits


@pytest.mark.django_db
class TestReleaseDocGenerator:
    """ReleaseDocGenerator 测试类"""

    @pytest.fixture
    def release(self, project, repository, user):
        """测试发布记录"""
        from apps.release.models import ReleaseRecord
        return ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            source_branch="develop",
            target_branch="main",
            release_type="formal",
            publisher=user,
        )

    def test_aggregate_updates_and_config(self, release):
        """聚合更新内容与配置项改动"""
        commits = [
            CommitInfo(
                hash="h1",
                author="张三",
                author_email="",
                message="变更类型：\n□ 无配置项改动 ☑有配置项改动\n\n更新内容：\n1. A 功能1\n\n配置项改动：\n[System]\nKey=Value1",
                committed_at=datetime(2026, 6, 20, 10, 0, 0, tzinfo=tz.utc),
            ),
            CommitInfo(
                hash="h2",
                author="李四",
                author_email="",
                message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. F 修复 bug",
                committed_at=datetime(2026, 6, 21, 10, 0, 0, tzinfo=tz.utc),
            ),
        ]
        provider = MockProvider(commits=commits)
        generator = ReleaseDocGenerator(release, provider)
        doc = generator.generate()

        assert doc["change_type"] == "有配置项改动"
        assert len(doc["updates"]) == 2
        assert doc["config_changes"] == {"System": {"Key": "Value1"}}

    def test_merge_similar_updates(self, release):
        """合并相同 type+content 的更新项"""
        commits = [
            CommitInfo(
                hash="h1",
                author="张三",
                author_email="",
                message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A 相同功能",
                committed_at=datetime(2026, 6, 20, 10, 0, 0, tzinfo=tz.utc),
            ),
            CommitInfo(
                hash="h2",
                author="李四",
                author_email="",
                message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A 相同功能",
                committed_at=datetime(2026, 6, 21, 10, 0, 0, tzinfo=tz.utc),
            ),
        ]
        provider = MockProvider(commits=commits)
        generator = ReleaseDocGenerator(release, provider)
        doc = generator.generate(merge_similar=True)
        assert len(doc["updates"]) == 1

    def test_regenerate_doc_updates_existing_release_commits(self, release):
        """重复生成发布说明时更新已有 ReleaseCommit 关联"""
        commits = [
            CommitInfo(
                hash="h1",
                author="张三",
                author_email="",
                message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A 功能1",
                committed_at=datetime(2026, 6, 20, 10, 0, 0, tzinfo=tz.utc),
            ),
            CommitInfo(
                hash="h2",
                author="李四",
                author_email="",
                message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. F 修复 bug",
                committed_at=datetime(2026, 6, 21, 10, 0, 0, tzinfo=tz.utc),
            ),
        ]
        provider = MockProvider(commits=commits)
        generator = ReleaseDocGenerator(release, provider)

        generator.generate()
        commit_ids = [
            str(release.release_commits.get(commit__commit_hash="h1").commit_id),
        ]
        generator.generate(commit_ids=commit_ids)

        assert release.release_commits.get(commit__commit_hash="h1").is_included is True
        assert release.release_commits.get(commit__commit_hash="h2").is_included is False

    def test_filter_illegal_commits(self, release, project, repository):
        """生成发布说明时排除非法提交"""
        from apps.repository.models import CommitRecord
        CommitRecord.objects.create(
            project=project,
            repository=repository,
            commit_hash="illegal001",
            author="张三",
            message="bad message",
            committed_at="2026-06-20T10:00:00+08:00",
            branch="develop",
            review_status="illegal",
        )
        commits = [
            CommitInfo(
                hash="illegal001",
                author="张三",
                author_email="",
                message="bad message",
                committed_at=datetime(2026, 6, 20, 10, 0, 0, tzinfo=tz.utc),
            ),
            CommitInfo(
                hash="pass001",
                author="李四",
                author_email="",
                message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A 合法功能",
                committed_at=datetime(2026, 6, 21, 10, 0, 0, tzinfo=tz.utc),
            ),
        ]
        provider = MockProvider(commits=commits)
        generator = ReleaseDocGenerator(release, provider)
        doc = generator.generate()
        assert len(doc["updates"]) == 1
        assert doc["updates"][0]["content"] == "合法功能"
