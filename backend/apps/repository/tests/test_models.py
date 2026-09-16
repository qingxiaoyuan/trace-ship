"""
仓库模型测试

覆盖仓库创建、提交记录创建、唯一性约束以及自定义管理器过滤。
"""
import pytest

from apps.repository.models import CommitRecord, Repository, default_version_rule


@pytest.mark.django_db
def test_repository_create(repository):
    """测试仓库创建及字符串表示"""
    assert repository.name == "后端仓库"
    assert repository.vendor == "gitlab"
    assert str(repository) == "测试项目 - 后端仓库"


@pytest.mark.django_db
def test_version_rule_copied_once_when_repository_created(project, credential):
    """登记仓库时复制产品版本规则，此后不再动态依赖产品。"""
    project.version_rule = {"prefix": "VA", "major": 1, "minor": 0, "patch": 0}
    project.save(update_fields=["version_rule"])
    repository = Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="新仓库",
        url="https://gitlab.example.com",
        external_identity="test/copied-version-rule",
        credential=credential,
    )

    assert repository.get_version_rule() == project.version_rule

    project.version_rule = {"prefix": "VB", "major": 9, "minor": 0, "patch": 0}
    project.save(update_fields=["version_rule"])
    repository.refresh_from_db()
    assert repository.get_version_rule()["prefix"] == "VA"


@pytest.mark.django_db
def test_get_version_rule_prefers_repository(repository, project):
    """仓库级版本规则优先于项目规则"""
    project.version_rule = {"prefix": "VA", "major": 1, "minor": 0, "patch": 0}
    project.save(update_fields=["version_rule"])
    repository.version_rule = {"prefix": "VB", "major": 4, "minor": 1, "patch": 0}
    repository.save(update_fields=["version_rule"])

    assert repository.get_version_rule()["prefix"] == "VB"


@pytest.mark.django_db
def test_create_repository_applies_default_version_rule(project, credential):
    """产品未配置版本规则时，新建仓库写入系统默认规则并立即生效。"""
    repository = Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="默认规则仓库",
        url="https://gitlab.example.com",
        external_identity="test/default-version-rule",
        credential=credential,
    )

    assert repository.version_rule == default_version_rule()
    assert repository.get_version_rule()["prefix"] == "V"
    assert repository.get_version_rule()["suffixes"] == {"rc": "rc", "beta": "beta"}
    assert repository.get_version_rule()["with_date"] is False


@pytest.mark.django_db
def test_create_unbound_repository_applies_default_version_rule(credential):
    """不绑定产品时，新建仓库同样写入系统默认版本规则。"""
    repository = Repository.objects.create(
        repo_type="git",
        vendor="gitlab",
        name="独立仓库",
        url="https://gitlab.example.com",
        external_identity="test/unbound-version-rule",
        credential=credential,
    )

    assert repository.project_id is None
    assert repository.version_rule == default_version_rule()


@pytest.mark.django_db
def test_get_version_rule_falls_back_to_system_default(repository):
    """存量仓库未落库版本规则时，读取系统默认规则。"""
    repository.version_rule = {}
    repository.save(update_fields=["version_rule"])
    assert repository.get_version_rule() == default_version_rule()


@pytest.mark.django_db
def test_physical_identity_is_unique_without_git_suffix(project, credential):
    """无 .git 的 HTTP 地址与规范化后的 server+path 视为同一物理仓库。"""
    from django.db import IntegrityError

    Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="a",
        url="https://gitlab.example.com",
        external_identity="group/same-repo",
        credential=credential,
    )
    with pytest.raises(IntegrityError):
        Repository.objects.create(
            project=project,
            repo_type="git",
            vendor="gitlab",
            name="b",
            url="https://gitlab.example.com",
            external_identity="group/same-repo",
            credential=credential,
        )


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
