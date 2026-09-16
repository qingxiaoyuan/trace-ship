"""旧库缺列时仓库查询不得选出新字段。"""
import json
from io import StringIO

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.project.models import Project, ProjectMember
from apps.repository.models import Repository
from apps.repository.schema_compat import repositories


@pytest.mark.django_db
def test_repositories_defers_missing_created_by(monkeypatch):
    """模拟旧库没有 created_by_id 时，SQL 不得包含该列。"""
    from apps.repository import schema_compat

    monkeypatch.setattr(schema_compat, "missing_field_names", lambda model: ["created_by"])
    sql = str(repositories().query)
    assert "created_by" not in sql


@pytest.mark.django_db
def test_check_command_lists_duplicate_candidates(project, credential, user):
    """一致性检查在存在重复身份时输出候选，且不因新字段崩掉。"""
    other = Project.objects.create(code="OTHER", name="另一产品", leader=user, status=1)
    ProjectMember.objects.create(project=other, user=user, role="manager")
    Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="海域",
        url="http://10.129.1.100",
        external_identity="jianboyu/SituationSystem",
        credential=credential,
        created_by=user,
    )
    Repository.objects.create(
        project=other,
        repo_type="git",
        vendor="gitlab",
        name="BDSimPro",
        url="http://10.129.1.100/jianboyu/SituationSystem.git",
        external_identity="jianboyu/SituationSystem",
        credential=credential,
        created_by=user,
    )
    stdout = StringIO()
    with pytest.raises(CommandError, match="数据一致性异常"):
        call_command(
            "check_product_repository_consistency",
            "--json",
            "--strict",
            stdout=stdout,
        )
    payload = json.loads(stdout.getvalue())
    groups = payload["issues"]["duplicate_repository_identities"]
    assert len(groups) == 1
    assert groups[0]["external_identity"] == "jianboyu/SituationSystem"
    names = {item["name"] for item in groups[0]["candidates"]}
    assert names == {"海域", "BDSimPro"}
