"""
发布说明生成器单元测试
"""
import pytest
from datetime import datetime, timezone as tz

from apps.release.services import ReleaseDocGenerator
from utils.provider.base import CommitInfo


class MockProvider:
    """用于发布说明生成的模拟 GitProvider"""

    def __init__(self, commits=None, tags=None, merge_requests=None):
        self.commits = commits or []
        self.tags = tags or []
        self.merge_requests = merge_requests or []

    def list_tags(self, repo_identity: str):
        return self.tags

    def list_commits(self, repo_identity: str, branch: str, since=None, until=None, per_page=100):
        return self.commits

    def compare_commits(self, repo_identity: str, base: str, head: str):
        return self.commits

    def list_merge_requests(self, repo_identity: str, target_branch: str, since=None):
        return self.merge_requests


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
            branch="main",
            release_type="formal",
            publisher=user,
            updates=[{"type": "A", "content": "新增功能", "source": "commit", "source_ref": "h1"}],
            has_config_changes=True,
            config_change_doc="[System]\nKey=Value1",
            impact_other=False,
            self_test_passed=True,
            retest_passed=False,
        )

    def test_generate_markdown_doc(self, release):
        """生成 Markdown 发布说明文档"""
        commits = [
            CommitInfo(
                hash="h1",
                author="张三",
                author_email="",
                message="A 新增功能",
                committed_at=datetime(2026, 6, 20, 10, 0, 0, tzinfo=tz.utc),
            ),
        ]
        provider = MockProvider(commits=commits)
        generator = ReleaseDocGenerator(release, provider)
        md = generator.generate()

        assert isinstance(md, str)
        assert "| 项目 | 内容 |" in md
        assert "变更类型" in md
        assert "有配置项改动" in md
        assert "新增功能" in md
        assert "配置项改动" in md
        assert "自测试通过" in md

    def test_generate_without_config_changes(self, release):
        """无配置项改动时配置项改动行值为无"""
        release.has_config_changes = False
        release.save()
        commits = [
            CommitInfo(
                hash="h1",
                author="张三",
                author_email="",
                message="A 新增功能",
                committed_at=datetime(2026, 6, 20, 10, 0, 0, tzinfo=tz.utc),
            ),
        ]
        provider = MockProvider(commits=commits)
        generator = ReleaseDocGenerator(release, provider)
        md = generator.generate()

        assert "无配置项改动" in md
        # 配置项改动行始终存在，无改动时值为「无」
        assert "| 配置项改动 | 无 |" in md

    def test_persist_release_commits(self, release):
        """生成时持久化 ReleaseCommit 关联"""
        commits = [
            CommitInfo(
                hash="h1",
                author="张三",
                author_email="",
                message="A 新增功能",
                committed_at=datetime(2026, 6, 20, 10, 0, 0, tzinfo=tz.utc),
            ),
            CommitInfo(
                hash="h2",
                author="李四",
                author_email="",
                message="F 修复 bug",
                committed_at=datetime(2026, 6, 21, 10, 0, 0, tzinfo=tz.utc),
            ),
        ]
        provider = MockProvider(commits=commits)
        generator = ReleaseDocGenerator(release, provider)
        generator.generate()

        assert release.release_commits.count() == 2
        assert release.release_commits.get(commit__commit_hash="h1").is_included is True

    def test_regenerate_updates_existing_release_commits(self, release):
        """重复生成时更新已有 ReleaseCommit 关联"""
        commits = [
            CommitInfo(
                hash="h1",
                author="张三",
                author_email="",
                message="A 功能1",
                committed_at=datetime(2026, 6, 20, 10, 0, 0, tzinfo=tz.utc),
            ),
            CommitInfo(
                hash="h2",
                author="李四",
                author_email="",
                message="F 修复 bug",
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
                message="A 合法功能",
                committed_at=datetime(2026, 6, 21, 10, 0, 0, tzinfo=tz.utc),
            ),
        ]
        provider = MockProvider(commits=commits)
        generator = ReleaseDocGenerator(release, provider)
        md = generator.generate()

        # 非法提交应被过滤，不创建 ReleaseCommit
        assert not release.release_commits.filter(commit__commit_hash="illegal001").exists()
        assert release.release_commits.filter(commit__commit_hash="pass001").exists()
