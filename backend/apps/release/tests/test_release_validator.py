"""
发布校验器单元测试
"""
import pytest
from datetime import timedelta

from django.utils import timezone

from apps.project.models import Project
from apps.release.models import ReleaseRecord
from apps.release.services import ReleaseValidator


pytestmark = pytest.mark.django_db


class TestReleaseValidator:
    """ReleaseValidator 测试类"""

    def test_validate_project_status_rejects_inactive(self, project):
        """停用项目禁止创建发布"""
        project.status = 0
        project.save(update_fields=["status"])
        with pytest.raises(Exception, match="项目已停用"):
            ReleaseValidator.validate_project_status(project)

    def test_validate_branch_and_prefix_for_formal(self):
        """正式发布必须指向主分支"""
        rule = {"formal_branch": "main", "test_prefix": "test"}
        ReleaseValidator.validate_branch_and_prefix(
            "formal", "main", "VA.1.0.0", rule
        )
        with pytest.raises(Exception, match="正式版本只能从 main"):
            ReleaseValidator.validate_branch_and_prefix(
                "formal", "develop", "VA.1.0.0", rule
            )

    def test_validate_branch_and_prefix_for_beta(self):
        """Beta 版本 tag 必须带 beta 前缀"""
        rule = {"formal_branch": "main", "tag_prefixes": {"beta": "beta"}}
        ReleaseValidator.validate_branch_and_prefix(
            "beta", "develop", "beta-VA.1.0.0", rule
        )
        with pytest.raises(Exception, match="beta 版本 tag 必须以 beta 开头"):
            ReleaseValidator.validate_branch_and_prefix(
                "beta", "develop", "VA.1.0.0", rule
            )

    def test_validate_release_cycle_rejects_too_frequent(self, project, repository, user):
        """正式版本未达到发布周期被拒绝"""
        ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            source_branch="develop",
            target_branch="main",
            release_type="formal",
            status="released",
            publisher=user,
        )
        rule = ReleaseValidator.get_release_rule(project)
        with pytest.raises(Exception, match="正式版本每"):
            ReleaseValidator.validate_release_cycle(project, "formal", rule)

    def test_validate_release_cycle_allows_after_interval(self, project, repository, user):
        """超过发布周期后允许新的正式发布"""
        old_release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            source_branch="develop",
            target_branch="main",
            release_type="formal",
            status="released",
            publisher=user,
        )
        old_release.created_at = timezone.now() - timedelta(days=4)
        old_release.save(update_fields=["created_at"])
        rule = ReleaseValidator.get_release_rule(project)
        # 不应抛异常
        ReleaseValidator.validate_release_cycle(project, "formal", rule)
