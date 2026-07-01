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

    def test_validate_branch_and_suffix_for_formal(self):
        """正式发布必须指向允许的主分支"""
        rule = {"formal_branch": "main,master"}
        version_rule = {"prefix": "VA", "suffixes": {"rc": "rc", "beta": "alpha"}}
        ReleaseValidator.validate_branch_and_suffix(
            "formal", "main", "VA.1.0.0", rule, version_rule
        )
        ReleaseValidator.validate_branch_and_suffix(
            "formal", "master", "VA.1.0.0", rule, version_rule
        )
        with pytest.raises(Exception, match="正式版本只能从 main, master"):
            ReleaseValidator.validate_branch_and_suffix(
                "formal", "develop", "VA.1.0.0", rule, version_rule
            )

    def test_validate_branch_and_suffix_for_beta(self):
        """Beta 版本 tag 必须带 alpha 后缀"""
        rule = {"formal_branch": "main"}
        version_rule = {"prefix": "VA", "suffixes": {"rc": "rc", "beta": "alpha"}}
        ReleaseValidator.validate_branch_and_suffix(
            "beta", "develop", "VA.1.0.0-alpha", rule, version_rule
        )
        with pytest.raises(Exception, match="beta 版本 tag 必须以 -alpha 结尾"):
            ReleaseValidator.validate_branch_and_suffix(
                "beta", "develop", "VA.1.0.0", rule, version_rule
            )

    def test_validate_release_cycle_allows_any_time(self, project, repository, user):
        """正式发布周期不再限制频率"""
        ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            status="released",
            publisher=user,
        )
        rule = ReleaseValidator.get_release_rule(project)
        # 不应抛异常
        ReleaseValidator.validate_release_cycle(project, "formal", rule)

