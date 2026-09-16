"""产品组件回填需覆盖迁移前已归并的跨产品仓库。"""
import importlib.util
from pathlib import Path

import pytest
from django.apps import apps
from django.db import connection

from apps.account.models import User
from apps.credential.models import Credential
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository


def _load_migration():
    path = Path(__file__).resolve().parents[1] / "migrations" / "0005_productcomponent.py"
    spec = importlib.util.spec_from_file_location("productcomponent_0005", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Schema:
    connection = connection


@pytest.mark.django_db
def test_collect_legacy_pairs_includes_other_product_releases():
    """主仓库挂在产品 A 时，产品 B 的发布单仍应生成 B-主仓库 组件对。"""
    user = User.objects.create_user(username="backfill-user", password="pass")
    project = Project.objects.create(code="MAIN", name="主产品", leader=user, status=1)
    other = Project.objects.create(code="OTHER", name="另一产品", leader=user, status=1)
    ProjectMember.objects.create(project=project, user=user, role="manager")
    ProjectMember.objects.create(project=other, user=user, role="manager")
    credential = Credential.objects.create(
        name="GitLab Token",
        cred_type="gitlab_token",
        auth_mode="token",
        owner=user,
    )
    repository = Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="RP",
        url="http://10.129.1.100",
        external_identity="zzy/RP",
        default_branch="develop",
        credential=credential,
        created_by=user,
    )
    ReleaseRecord.objects.create(
        project=other,
        repository=repository,
        version="V1.0.0",
        tag_name="V1.0.0",
        branch="develop",
        release_type="formal",
        status="released",
        publisher=user,
    )
    pairs, repo_map = _load_migration()._collect_legacy_pairs(apps, _Schema())
    assert repository.id in repo_map
    assert (project.id, repository.id) in pairs
    assert (other.id, repository.id) in pairs
