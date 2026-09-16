"""重复物理仓库归并命令测试。"""
import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.project.models import ProductComponent, Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import CommitRecord, Repository, RepositoryBranch


def _repo(project, credential, *, name, url, identity):
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name=name,
        url=url,
        external_identity=identity,
        default_branch="develop",
        credential=credential,
        created_by=project.leader,
    )


def _release(project, repository, version):
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version=version,
        tag_name=version,
        branch="develop",
        release_type="formal",
        status="released",
        publisher=project.leader,
    )


@pytest.mark.django_db
def test_list_duplicate_groups(project, credential, user):
    """规范化后身份相同的仓库会出现在 --list 结果中。"""
    other = Project.objects.create(code="OTHER", name="另一产品", leader=user, status=1)
    ProjectMember.objects.create(project=other, user=user, role="manager")
    primary = _repo(
        project, credential,
        name="态势系统",
        url="http://10.129.1.100",
        identity="jianboyu/SituationSystem",
    )
    duplicate = _repo(
        other, credential,
        name="态势系统副本",
        url="http://10.129.1.100/jianboyu/SituationSystem.git",
        identity="jianboyu/SituationSystem",
    )
    stdout = StringIO()
    call_command("merge_duplicate_repositories", "--list", stdout=stdout)
    payload = json.loads(stdout.getvalue())
    assert payload["group_count"] == 1
    group = payload["duplicate_groups"][0]
    assert group["external_identity"] == "jianboyu/SituationSystem"
    ids = {item["id"] for item in group["candidates"]}
    assert str(primary.id) in ids
    assert str(duplicate.id) in ids


@pytest.mark.django_db
def test_dry_run_does_not_delete(project, credential, user):
    """默认 dry-run 只输出报告，不删仓库。"""
    other = Project.objects.create(code="OTHER", name="另一产品", leader=user, status=1)
    primary = _repo(
        project, credential,
        name="RP",
        url="http://10.129.1.100",
        identity="zzy/RP",
    )
    duplicate = _repo(
        other, credential,
        name="RP-2",
        url="http://10.129.1.100/zzy/RP.git",
        identity="zzy/RP",
    )
    stdout = StringIO()
    call_command(
        "merge_duplicate_repositories",
        "--primary", str(primary.id),
        "--duplicate", str(duplicate.id),
        stdout=stdout,
    )
    assert Repository.objects.filter(id=duplicate.id).exists()
    assert "dry-run" in stdout.getvalue()


@pytest.mark.django_db
def test_apply_moves_releases_and_keeps_other_product(project, credential, user):
    """归并后重复仓删除，另一产品的发布仍指向主仓库。"""
    other = Project.objects.create(code="OTHER", name="另一产品", leader=user, status=1)
    ProjectMember.objects.create(project=other, user=user, role="manager")
    from apps.project.services import ensure_repository_component

    primary = _repo(
        project, credential,
        name="RP",
        url="http://10.129.1.100",
        identity="zzy/RP",
    )
    duplicate = _repo(
        other, credential,
        name="RP-2",
        url="http://10.129.1.100/zzy/RP.git",
        identity="zzy/RP",
    )
    ensure_repository_component(primary, project)
    ensure_repository_component(duplicate, other)
    kept = _release(project, primary, "V1.0.0")
    moved = _release(other, duplicate, "V1.0.1")
    CommitRecord.objects.create(
        project=other,
        repository=duplicate,
        commit_hash="abc123",
        author="张三",
        message="A 功能",
        committed_at="2026-06-20T10:00:00+08:00",
        branch="develop",
    )
    RepositoryBranch.objects.create(repository=duplicate, name="develop", last_commit_hash="abc123")
    stdout = StringIO()
    call_command(
        "merge_duplicate_repositories",
        "--primary", str(primary.id),
        "--duplicate", str(duplicate.id),
        "--apply",
        stdout=stdout,
    )
    assert not Repository.objects.filter(id=duplicate.id).exists()
    kept.refresh_from_db()
    moved.refresh_from_db()
    assert kept.repository_id == primary.id
    assert moved.repository_id == primary.id
    assert moved.project_id == other.id
    assert CommitRecord.objects.filter(repository=primary, commit_hash="abc123").exists()
    assert ProductComponent.objects.filter(project=project, repository=primary).exists()
    assert ProductComponent.objects.filter(project=other, repository=primary).exists()


@pytest.mark.django_db
def test_identity_mismatch_is_conflict(project, credential, user):
    """身份不同的仓库拒绝归并。"""
    other = Project.objects.create(code="OTHER", name="另一产品", leader=user, status=1)
    primary = _repo(
        project, credential,
        name="A",
        url="http://10.129.1.100",
        identity="group/a",
    )
    other_repo = _repo(
        other, credential,
        name="B",
        url="http://10.129.1.100",
        identity="group/b",
    )
    with pytest.raises(CommandError, match="存在冲突"):
        call_command(
            "merge_duplicate_repositories",
            "--primary", str(primary.id),
            "--duplicate", str(other_repo.id),
            "--apply",
        )
    assert Repository.objects.filter(id=other_repo.id).exists()
