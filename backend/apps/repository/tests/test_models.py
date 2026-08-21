"""
仓库模型测试

覆盖仓库创建、提交记录创建、唯一性约束以及自定义管理器过滤。
"""
import pytest

from apps.repository.models import CommitRecord


@pytest.mark.django_db
def test_repository_create(repository):
    """测试仓库创建及字符串表示"""
    assert repository.name == "后端仓库"
    assert repository.vendor == "gitlab"
    assert str(repository) == "测试项目 - 后端仓库"


@pytest.mark.django_db
def test_get_version_rule_fallback_to_project(repository, project):
    """仓库未配置版本规则时回退到项目规则（兼容历史数据）"""
    project.version_rule = {"prefix": "VA", "major": 1, "minor": 0, "patch": 0}
    project.save(update_fields=["version_rule"])

    assert repository.get_version_rule() == project.version_rule


@pytest.mark.django_db
def test_get_version_rule_prefers_repository(repository, project):
    """仓库级版本规则优先于项目规则"""
    project.version_rule = {"prefix": "VA", "major": 1, "minor": 0, "patch": 0}
    project.save(update_fields=["version_rule"])
    repository.version_rule = {"prefix": "VB", "major": 4, "minor": 1, "patch": 0}
    repository.save(update_fields=["version_rule"])

    assert repository.get_version_rule()["prefix"] == "VB"


@pytest.mark.django_db
def test_get_version_rule_empty_when_neither_configured(repository):
    """仓库与项目均未配置时返回空字典"""
    assert repository.get_version_rule() == {}


@pytest.mark.django_db
def test_commit_record_create(commit, repository):
    """测试提交记录创建"""
    assert commit.commit_hash == "abc123"
    assert commit.repository == repository
    assert commit.review_status == "pass"


@pytest.mark.django_db
def test_commit_hash_unique(commit, repository, project):
    """测试同一仓库下 commit_hash 唯一"""
    with pytest.raises(Exception):
        CommitRecord.objects.create(
            project=project,
            repository=repository,
            commit_hash="abc123",
            author="李四",
            message="duplicate",
            committed_at="2026-06-21T10:00:00+08:00",
        )


@pytest.mark.django_db
def test_commit_manager_filter(commit, repository):
    """测试 CommitRecord 自定义管理器过滤方法"""
    assert CommitRecord.objects.by_repository(repository).count() == 1
    assert CommitRecord.objects.passed().count() == 1
    assert CommitRecord.objects.illegal().count() == 0
