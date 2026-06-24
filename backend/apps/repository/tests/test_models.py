"""
仓库模型测试

覆盖仓库创建、提交记录创建、唯一性约束以及自定义管理器过滤。
"""
import pytest

from apps.repository.models import CommitRecord, Repository


@pytest.mark.django_db
def test_repository_create(repository):
    """测试仓库创建及字符串表示"""
    assert repository.name == "后端仓库"
    assert repository.vendor == "gitlab"
    assert str(repository) == "测试项目 - 后端仓库"


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
