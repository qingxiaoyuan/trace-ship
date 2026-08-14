"""
发布模块 Celery 任务测试
"""
import pytest
from django.utils import timezone

from apps.release.models import ReleaseRecord
from apps.release.tasks import cleanup_draft_releases


pytestmark = pytest.mark.django_db


class TestReleaseTasks:
    """发布任务测试类"""

    def test_cleanup_draft_releases_deletes_all_expired_drafts(self, project, repository, user):
        """cleanup_draft_releases 删除所有超期草稿（无论是否有内容），保留新草稿和其他状态"""
        expired_empty = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            status="draft",
            publisher=user,
        )
        ReleaseRecord.objects.filter(id=expired_empty.id).update(
            created_at=timezone.now() - timezone.timedelta(hours=2)
        )
        fresh_empty = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.3",
            tag_name="VA.1.0.3",
            branch="main",
            release_type="formal",
            status="draft",
            publisher=user,
        )
        expired_with_doc = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.4",
            tag_name="VA.1.0.4",
            branch="main",
            release_type="formal",
            status="draft",
            release_doc="| 项目 | 内容 |\n|------|------|\n| 变更类型 | 无配置项改动 |",
            publisher=user,
        )
        ReleaseRecord.objects.filter(id=expired_with_doc.id).update(
            created_at=timezone.now() - timezone.timedelta(hours=2)
        )
        pending = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.1",
            tag_name="VA.1.0.1",
            branch="main",
            release_type="formal",
            status="pending",
            publisher=user,
        )
        released = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.2",
            tag_name="VA.1.0.2",
            branch="main",
            release_type="formal",
            status="released",
            publisher=user,
        )

        result = cleanup_draft_releases()

        assert result["deleted"] >= 2
        assert not ReleaseRecord.objects.filter(id=expired_empty.id).exists()
        # 有内容的超期草稿同样被清理
        assert not ReleaseRecord.objects.filter(id=expired_with_doc.id).exists()
        # 创建未满 1 小时的新草稿保留
        assert ReleaseRecord.objects.filter(id=fresh_empty.id).exists()
        assert ReleaseRecord.objects.filter(id=pending.id).exists()
        assert ReleaseRecord.objects.filter(id=released.id).exists()

    def test_cleanup_draft_releases_returns_zero_when_no_drafts(self, project, repository, user):
        """无草稿时返回 deleted=0"""
        ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            status="pending",
            publisher=user,
        )
        result = cleanup_draft_releases()
        assert result["deleted"] == 0
