import pytest

from apps.repository.models import CommitRecord, Repository


@pytest.mark.django_db
def test_repository_create(repository):
    assert repository.name == "后端仓库"
    assert repository.vendor == "gitlab"
    assert str(repository) == "测试项目 - 后端仓库"


@pytest.mark.django_db
def test_commit_record_create(commit, repository):
    assert commit.commit_hash == "abc123"
    assert commit.repository == repository
    assert commit.review_status == "pass"


@pytest.mark.django_db
def test_commit_hash_unique(commit, repository, project):
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
    assert CommitRecord.objects.by_repository(repository).count() == 1
    assert CommitRecord.objects.passed().count() == 1
    assert CommitRecord.objects.illegal().count() == 0
