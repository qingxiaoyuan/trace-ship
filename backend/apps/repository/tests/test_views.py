"""
仓库视图测试

覆盖仓库列表、创建、vendor 校验、commit 同步以及提交复核接口。
"""
from datetime import UTC
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from apps.project.models import ProductComponent, ProjectMember
from apps.repository.models import CommitRecord, Repository, default_version_rule


@pytest.fixture
def api_client(user):
    """已认证 APIClient"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_list_repositories(api_client, repository):
    """测试仓库列表接口"""
    response = api_client.get("/api/repositories/")
    assert response.status_code == 200
    assert response.data["code"] == 0
    assert response.data["data"]["total"] == 1


@pytest.mark.django_db
def test_repository_creator_can_see_unbound_repository(user, credential):
    """用户可以看到自己创建、但尚未关联产品的仓库。"""
    repository = Repository.objects.create(
        repo_type="git",
        vendor="gitlab",
        name="我的独立仓库",
        url="https://gitlab.example.com/test/owned.git",
        external_identity="test/owned",
        credential=credential,
        created_by=user,
    )

    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/repositories/")

    assert response.status_code == 200
    ids = {item["id"] for item in response.data["data"]["results"]}
    assert str(repository.id) in ids


@pytest.mark.django_db
def test_repository_creator_cannot_see_hidden_product_metadata(api_client, user, repository):
    """仓库创建者退出产品后仍可见仓库，但不可看到该产品的任何关联元数据。"""
    ProjectMember.objects.filter(project=repository.project, user=user).delete()

    response = api_client.get(f"/api/repositories/{repository.id}/")

    assert response.status_code == 200
    data = response.data["data"]
    assert data["project"] is None
    assert data["project_name"] == ""
    assert data["product_count"] == 0
    assert data["used_by_products"] == []


@pytest.mark.django_db
def test_repository_only_exposes_visible_product_associations(
    api_client, repository,
):
    """共享仓库只返回当前用户所属产品的关联信息。"""
    from apps.project.models import Project

    hidden_project = Project.objects.create(
        code="HIDDEN", name="隐藏产品", leader=None, status=1,
    )
    ProductComponent.objects.create(
        project=hidden_project,
        repository=repository,
        component_code="hidden-component",
        display_name="隐藏组件",
        is_active=True,
    )

    response = api_client.get(f"/api/repositories/{repository.id}/")

    assert response.status_code == 200
    data = response.data["data"]
    assert data["product_count"] == 1
    assert {item["product_id"] for item in data["used_by_products"]} == {
        str(repository.project_id)
    }
    assert all(item["product_name"] != "隐藏产品" for item in data["used_by_products"])


@pytest.mark.django_db
def test_project_member_can_see_linked_repository(repository):
    """产品成员可以看到该产品已关联的仓库。"""
    from apps.account.models import User

    member = User.objects.create_user(username="repo_member", password="pass")
    ProjectMember.objects.create(project=repository.project, user=member, role="viewer")
    client = APIClient()
    client.force_authenticate(user=member)

    response = client.get("/api/repositories/")

    assert response.status_code == 200
    ids = {item["id"] for item in response.data["data"]["results"]}
    assert str(repository.id) in ids


@pytest.mark.django_db
def test_non_member_cannot_see_repository_created_by_other_user(repository):
    """非创建者且不属于关联产品的用户看不到仓库。"""
    from apps.account.models import User

    outsider = User.objects.create_user(username="repo_outsider", password="pass")
    client = APIClient()
    client.force_authenticate(user=outsider)

    response = client.get("/api/repositories/")

    assert response.status_code == 200
    ids = {item["id"] for item in response.data["data"]["results"]}
    assert str(repository.id) not in ids


@pytest.mark.django_db
def test_repository_manager_permission_does_not_bypass_visibility(repository):
    """repository.manage 只授予操作能力，不扩大仓库数据范围。"""
    from apps.account.models import Permission, Role, User, UserRole

    manager = User.objects.create_user(username="global_repo_manager", password="pass")
    permission = Permission.objects.create(
        name="管理仓库", code="repository.manage", module="repository"
    )
    role = Role.objects.create(name="仓库管理员", code="repository_manager")
    role.permissions.add(permission)
    UserRole.objects.create(user=manager, role=role)
    client = APIClient()
    client.force_authenticate(user=manager)

    response = client.get("/api/repositories/")

    assert response.status_code == 200
    ids = {item["id"] for item in response.data["data"]["results"]}
    assert str(repository.id) not in ids


@pytest.mark.django_db
def test_create_repository(api_client, user, project, credential):
    """测试创建仓库"""
    payload = {
        "project": str(project.id),
        "repo_type": "git",
        "vendor": "gitlab",
        "name": "前端仓库",
        "url": "https://gitlab.example.com/test/frontend.git",
        "external_identity": "test/frontend",
        "default_branch": "main",
        "credential": str(credential.id),
        "credential_mode": "project",
    }
    response = api_client.post("/api/repositories/", payload, format="json")
    assert response.status_code == 201, response.data
    assert response.data["code"] == 0
    assert response.data["data"]["name"] == "前端仓库"
    assert response.data["data"]["version_rule"] == default_version_rule()
    assert str(response.data["data"]["created_by"]) == str(user.id)
    from apps.workflow.models import WorkflowDefinition

    assert WorkflowDefinition.objects.filter(
        repository_id=response.data["data"]["id"], biz_type="release"
    ).count() == 3


@pytest.mark.django_db
def test_create_global_repository_without_project(user, credential):
    """全局仓库管理员可独立登记物理仓库，不自动绑定产品。"""
    user.is_superuser = True
    user.save(update_fields=["is_superuser"])
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post(
        "/api/repositories/",
        {
            "repo_type": "git",
            "vendor": "gitlab",
            "name": "共享中台仓库",
            "url": "https://gitlab.example.com/platform/core.git",
            "default_branch": "main",
            "credential": str(credential.id),
            "credential_mode": "personal",
        },
        format="json",
    )

    assert response.status_code == 201, response.data
    repository = Repository.objects.get(id=response.data["data"]["id"])
    assert repository.project_id is None
    assert repository.version_rule == default_version_rule()
    assert not ProductComponent.objects.filter(repository=repository).exists()


@pytest.mark.django_db
def test_project_manager_cannot_create_unbound_global_repository(api_client, project, credential):
    """只有项目内权限的管理员不能绕过产品上下文维护全局仓库目录。"""
    response = api_client.post(
        "/api/repositories/",
        {
            "repo_type": "git",
            "vendor": "gitlab",
            "name": "越权共享仓库",
            "url": "https://gitlab.example.com/platform/forbidden.git",
            "default_branch": "main",
            "credential": str(credential.id),
            "credential_mode": "personal",
        },
        format="json",
    )

    assert response.status_code == 403
    assert not Repository.objects.filter(name="越权共享仓库").exists()


@pytest.mark.django_db
def test_update_version_rule_by_non_credential_owner(repository):
    """
    测试非凭证持有人（项目负责人）可修改仓库版本规则

    修改 version_rule 不触发凭证归属校验，软件负责人与项目负责人均可改
    """
    from apps.account.models import User
    from apps.project.models import ProjectMember

    # 另一个用户作为项目负责人，但不持有仓库绑定的凭证
    manager = User.objects.create_user(username="repo_mgr", password="pass", nickname="项目管理员")
    ProjectMember.objects.create(project=repository.project, user=manager, role="manager")

    client = APIClient()
    client.force_authenticate(user=manager)
    response = client.patch(
        f"/api/repositories/{repository.id}/",
        {"version_rule": {"prefix": "VB", "major": 2, "minor": 0, "patch": 0, "with_date": False}},
        format="json",
    )
    assert response.status_code == 200
    repository.refresh_from_db()
    assert repository.version_rule["prefix"] == "VB"
    assert repository.version_rule["with_date"] is False


@pytest.mark.django_db
def test_create_repository_rejects_invalid_vendor(api_client, project, credential):
    """测试 Git 仓库拒绝 SVN vendor"""
    payload = {
        "project": str(project.id),
        "repo_type": "git",
        "vendor": "svn",
        "name": "错误仓库",
        "url": "https://gitlab.example.com/test/wrong.git",
        "external_identity": "test/wrong",
        "default_branch": "main",
        "credential": str(credential.id),
        "credential_mode": "project",
    }

    response = api_client.post("/api/repositories/", payload, format="json")

    assert response.status_code == 400
    assert "vendor" in response.data["data"]


@pytest.mark.django_db
def test_sync_commits(api_client, repository):
    """测试手动同步 commits"""
    fake_commit = type("CommitInfo", (), {
        "hash": "def456",
        "author": "李四",
        "author_email": "",
        "message": "变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A yyy",
        "committed_at": None,
    })()
    with patch("apps.repository.services.RepositoryService.list_commits", return_value=[fake_commit]):
        response = api_client.post(
            f"/api/repositories/{repository.id}/sync-commits/",
            {"branch": "develop"},
            format="json",
        )
    assert response.status_code == 200
    assert response.data["code"] == 0
    assert response.data["data"]["synced_count"] == 1
    assert CommitRecord.objects.filter(commit_hash="def456").exists()


@pytest.mark.django_db
def test_commit_review(api_client, commit):
    """测试提交复核"""
    response = api_client.post(
        f"/api/commits/{commit.id}/review/",
        {"review_status": "illegal", "reason": "测试标记"},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["code"] == 0
    assert response.data["data"]["review_status"] == "illegal"


@pytest.mark.django_db
def test_repository_commits_returns_data(api_client, repository, commit):
    """测试仓库详情 commits 接口返回该仓库的提交记录"""
    response = api_client.get(f"/api/repositories/{repository.id}/commits/")
    assert response.status_code == 200
    assert response.data["code"] == 0
    results = response.data["data"]["results"]
    assert len(results) == 1
    assert results[0]["commit_hash"] == commit.commit_hash


@pytest.mark.django_db
def test_repository_commits_filter_by_branch(api_client, repository, project):
    """测试仓库详情 commits 接口支持按分支筛选"""
    CommitRecord.objects.create(
        project=project,
        repository=repository,
        commit_hash="main-001",
        author="张三",
        message="feat: main",
        committed_at="2026-06-22T10:00:00+08:00",
        branch="main",
    )
    CommitRecord.objects.create(
        project=project,
        repository=repository,
        commit_hash="dev-001",
        author="李四",
        message="feat: dev",
        committed_at="2026-06-21T10:00:00+08:00",
        branch="develop",
    )
    response = api_client.get(f"/api/repositories/{repository.id}/commits/?branch=main")
    assert response.status_code == 200
    assert response.data["code"] == 0
    results = response.data["data"]["results"]
    assert len(results) == 1
    assert results[0]["commit_hash"] == "main-001"
    assert results[0]["branch"] == "main"


@pytest.mark.django_db
def test_unauthorized_access_other_project(api_client):
    """测试未参与项目时仓库列表为空"""
    # api_client 用户没有 project 2 的权限
    response = api_client.get("/api/repositories/")
    assert response.status_code == 200
    assert response.data["data"]["total"] == 0


@pytest.mark.django_db
def test_review_range_returns_audited_commits(api_client, repository):
    """测试按 Tag 区间拉取并审查提交（不落库）"""
    from datetime import datetime
    from unittest.mock import MagicMock

    from utils.provider.base import CommitInfo, TagInfo

    fake_tags = [
        TagInfo(name="v1.1.0", commit_hash="h2", created_at=datetime(2026, 6, 20, 12, 0, 0)),
        TagInfo(name="v1.0.0", commit_hash="h1", created_at=datetime(2026, 6, 10, 12, 0, 0)),
    ]
    fake_commits = [
        CommitInfo(
            hash="c1",
            author="张三",
            author_email="",
            message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A 新增功能",
            committed_at=datetime(2026, 6, 18, 10, 0, 0),
        ),
        CommitInfo(
            hash="c2",
            author="李四",
            author_email="",
            message="修复登录页样式问题",
            committed_at=datetime(2026, 6, 19, 10, 0, 0),
        ),
    ]
    mock_provider = MagicMock()
    mock_provider.list_tags.return_value = fake_tags
    mock_provider.compare_commits.return_value = fake_commits
    mock_provider.list_merge_requests.return_value = []

    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        response = api_client.get(f"/api/repositories/{repository.id}/review-range/?tag=v1.1.0")

    assert response.status_code == 200
    assert response.data["code"] == 0
    data = response.data["data"]
    # 选 v1.1.0 时，base 应为上一个 tag v1.0.0
    assert data["base"] == "v1.0.0"
    assert data["head"] == "v1.1.0"
    commits = data["commits"]
    assert len(commits) == 2
    # 第一条合规
    assert commits[0]["review_status"] == "pass"
    # 第二条不合规（缺变更类型），归为非法
    assert commits[1]["review_status"] == "illegal"
    # 统计：pass=1, warning=1（illegal 计入 warning）
    assert data["stats"]["pass"] == 1
    assert data["stats"]["warning"] == 1


@pytest.mark.django_db
def test_review_range_latest_uses_branch_head(api_client, repository):
    """测试 tag=latest 时 base 为最新 tag、head 为默认分支"""
    from datetime import datetime
    from unittest.mock import MagicMock

    from utils.provider.base import TagInfo

    fake_tags = [
        TagInfo(name="v1.1.0", commit_hash="h2", created_at=datetime(2026, 6, 20, 12, 0, 0)),
        TagInfo(name="v1.0.0", commit_hash="h1", created_at=datetime(2026, 6, 10, 12, 0, 0)),
    ]
    mock_provider = MagicMock()
    mock_provider.list_tags.return_value = fake_tags
    mock_provider.compare_commits.return_value = []
    mock_provider.list_merge_requests.return_value = []

    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        response = api_client.get(f"/api/repositories/{repository.id}/review-range/")

    assert response.status_code == 200
    data = response.data["data"]
    assert data["base"] == "v1.1.0"
    assert data["head"] == repository.default_branch


@pytest.mark.django_db
def test_review_range_explicit_base_head(api_client, repository):
    """测试显式指定 base/head 双 tag 区间"""
    from datetime import datetime
    from unittest.mock import MagicMock

    from utils.provider.base import CommitInfo, TagInfo

    fake_tags = [
        TagInfo(name="v1.2.0", commit_hash="h3", created_at=datetime(2026, 6, 25, 12, 0, 0)),
        TagInfo(name="v1.1.0", commit_hash="h2", created_at=datetime(2026, 6, 20, 12, 0, 0)),
        TagInfo(name="v1.0.0", commit_hash="h1", created_at=datetime(2026, 6, 10, 12, 0, 0)),
    ]
    fake_commits = [
        CommitInfo(
            hash="c1",
            author="张三",
            author_email="",
            message="变更类型：\n☑ 无配置项改动 □有配置项改动\n\n更新内容：\n1. A 新增功能",
            committed_at=datetime(2026, 6, 22, 10, 0, 0),
        ),
    ]
    mock_provider = MagicMock()
    mock_provider.list_tags.return_value = fake_tags
    mock_provider.compare_commits.return_value = fake_commits
    mock_provider.list_merge_requests.return_value = []

    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        response = api_client.get(
            f"/api/repositories/{repository.id}/review-range/?base=v1.0.0&head=v1.2.0"
        )

    assert response.status_code == 200
    data = response.data["data"]
    assert data["base"] == "v1.0.0"
    assert data["head"] == "v1.2.0"
    assert len(data["commits"]) == 1


@pytest.mark.django_db
def test_test_connection_success_logs_operation_log(api_client, repository):
    """连接测试成功时写入 success 操作日志"""
    from unittest.mock import MagicMock

    from apps.system.models import OperationLog

    mock_provider = MagicMock()
    mock_provider.test_connection.return_value = True

    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        response = api_client.post(f"/api/repositories/{repository.id}/test/")

    assert response.status_code == 200
    assert response.data["code"] == 0
    assert response.data["data"]["connected"] is True

    log = OperationLog.objects.filter(
        module="代码仓库", action="连接测试", resource_id=str(repository.id)
    ).first()
    assert log is not None
    assert log.result == "success"
    assert repository.name in log.description


@pytest.mark.django_db
def test_changes_preview_uses_release_type_baseline(api_client, repository):
    """changes-preview 按 release_type 参数取对应类型的最新 tag 作为基线"""
    from datetime import datetime
    from unittest.mock import MagicMock

    from django.core.cache import cache

    from utils.provider.base import CommitInfo, TagInfo

    repository.version_rule = {
        "prefix": "VA", "major": 1, "minor": 0, "patch": 0,
        "suffixes": {"rc": "rc", "beta": "beta"},
    }
    repository.save(update_fields=["version_rule"])
    # tag 列表走短缓存，先清理避免其他测试残留
    cache.clear()

    af_msg = "变更类型：\n☑ 无配置项改动\n\n更新内容：\n1. A 新增功能"
    fake_tags = [
        TagInfo(name="VA.1.0.0_20260101", commit_hash="formalhash",
                created_at=datetime(2026, 1, 1, tzinfo=UTC)),
        TagInfo(name="VA.1.0.5-rc_20260601", commit_hash="rchash",
                created_at=datetime(2026, 6, 1, tzinfo=UTC)),
    ]
    fake_commits = [
        CommitInfo(hash="new1", author="张三", author_email="", message=af_msg,
                   committed_at=datetime(2026, 6, 20, tzinfo=UTC)),
        CommitInfo(hash="rchash", author="李四", author_email="", message=af_msg,
                   committed_at=datetime(2026, 6, 1, tzinfo=UTC)),
    ]
    mock_provider = MagicMock()
    mock_provider.server_url = "https://gitlab.example.com"
    mock_provider.list_tags.return_value = fake_tags
    mock_provider.list_commits.return_value = fake_commits
    mock_provider.list_merge_requests.return_value = []

    with patch("apps.release.services.ReleaseService._get_provider", return_value=mock_provider):
        resp_formal = api_client.get(
            f"/api/repositories/{repository.id}/changes-preview/?branch=develop"
        )
        resp_rc = api_client.get(
            f"/api/repositories/{repository.id}/changes-preview/?branch=develop&release_type=rc"
        )

    assert resp_formal.status_code == 200
    assert resp_formal.data["code"] == 0
    # 默认 formal：以最新正式 tag 为基线
    assert resp_formal.data["data"]["last_tag"] == "VA.1.0.0_20260101"
    assert resp_rc.status_code == 200
    # rc：以最新 -rc tag 为基线，且只包含 rchash 之后的提交
    assert resp_rc.data["data"]["last_tag"] == "VA.1.0.5-rc_20260601"
    rc_hashes = [c["hash"] for c in resp_rc.data["data"]["commits"]]
    assert "new1" in rc_hashes
    assert "rchash" not in rc_hashes


@pytest.mark.django_db
def test_changes_preview_rejects_invalid_release_type(api_client, repository):
    """changes-preview 拒绝非法 release_type 参数"""
    response = api_client.get(
        f"/api/repositories/{repository.id}/changes-preview/?branch=develop&release_type=alpha"
    )
    assert response.status_code == 400
    assert response.data["code"] == 40001


@pytest.mark.django_db
def test_test_connection_failure_logs_operation_log(api_client, repository):
    """连接测试失败（token 过期等）时写入 failure 操作日志并记录错误原因与诊断信息"""
    from unittest.mock import MagicMock

    from apps.system.models import OperationLog
    from utils.provider.exceptions import AuthenticationError

    mock_provider = MagicMock()
    exc = AuthenticationError("GitLab Token 无效或已过期")
    exc.diagnostic = {
        "url": "https://gitlab.example.com/api/v4/user",
        "token_preview": "glpa...test",
        "status_code": 401,
        "response_body": '{"message":"401 Unauthorized"}',
    }
    mock_provider.test_connection.side_effect = exc

    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        response = api_client.post(f"/api/repositories/{repository.id}/test/")

    assert response.status_code == 200
    assert response.data["data"]["connected"] is False
    assert "过期" in response.data["data"]["detail"]

    log = OperationLog.objects.filter(
        module="代码仓库", action="连接测试", resource_id=str(repository.id)
    ).first()
    assert log is not None
    assert log.result == "failure"
    assert "失败" in log.description
    assert log.detail.get("error") == "GitLab Token 无效或已过期"
    assert log.detail["diagnostic"]["status_code"] == 401
    assert log.detail["diagnostic"]["token_preview"] == "glpa...test"


@pytest.mark.django_db
def test_auditor_cannot_see_non_member_project_commits(repository, commit):
    """审查员不是产品成员时，不能看到该产品仓库的提交记录。"""
    from apps.account.models import Permission, Role, User, UserRole

    auditor = User.objects.create_user(username="auditor", password="pass", nickname="审查员")
    perm, _ = Permission.objects.get_or_create(
        code="release.audit",
        defaults={"name": "审批发布", "module": "release"},
    )
    role = Role.objects.create(name="审查员", code="auditor_role")
    role.permissions.add(perm)
    UserRole.objects.create(user=auditor, role=role)

    client = APIClient()
    client.force_authenticate(user=auditor)
    response = client.get("/api/commits/")

    assert response.status_code == 200
    hashes = [c["commit_hash"] for c in response.data["data"]["results"]]
    assert commit.commit_hash not in hashes


@pytest.mark.django_db
def test_delete_tag_success(api_client, repository):
    """删除标签：调用远端删除并清理本地 RepositoryTag 缓存"""
    from unittest.mock import MagicMock

    from apps.repository.models import RepositoryTag

    RepositoryTag.objects.create(repository=repository, name="VA.1.0.0", commit_hash="abc123")
    mock_provider = MagicMock()
    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        response = api_client.post(
            f"/api/repositories/{repository.id}/delete-tag/",
            {"tag_name": "VA.1.0.0"},
            format="json",
        )

    assert response.status_code == 200
    assert response.data["code"] == 0
    assert response.data["data"]["remote_deleted"] is True
    mock_provider.delete_tag.assert_called_once_with("test/backend", "VA.1.0.0")
    assert not RepositoryTag.objects.filter(repository=repository, name="VA.1.0.0").exists()


@pytest.mark.django_db
def test_delete_tag_tolerates_missing_remote_tag(api_client, repository):
    """远端 tag 已不存在时幂等成功并标记 remote_deleted=False"""
    from unittest.mock import MagicMock

    from utils.provider.exceptions import NotFoundError

    mock_provider = MagicMock()
    mock_provider.delete_tag.side_effect = NotFoundError("tag 不存在")
    with patch("apps.repository.services.get_provider", return_value=mock_provider):
        response = api_client.post(
            f"/api/repositories/{repository.id}/delete-tag/",
            {"tag_name": "VA.1.0.0"},
            format="json",
        )

    assert response.status_code == 200
    assert response.data["data"]["remote_deleted"] is False


@pytest.mark.django_db
def test_delete_tag_requires_tag_name(api_client, repository):
    """缺少 tag_name 时返回参数错误"""
    response = api_client.post(
        f"/api/repositories/{repository.id}/delete-tag/",
        {},
        format="json",
    )

    assert response.data["code"] == 40001


@pytest.mark.django_db
def test_delete_tag_rejects_svn_repository(api_client, project, credential):
    """SVN 仓库不支持标签删除"""
    from apps.repository.models import Repository

    svn_repo = Repository.objects.create(
        project=project,
        repo_type="svn",
        vendor="svn",
        name="SVN 仓库",
        url="svn://svn.example.com/repo",
        external_identity="repo",
        credential=credential,
        credential_mode="project",
    )
    response = api_client.post(
        f"/api/repositories/{svn_repo.id}/delete-tag/",
        {"tag_name": "v1.0.0"},
        format="json",
    )

    assert response.data["code"] == 40001


@pytest.mark.django_db
def test_delete_tag_forbidden_for_non_manager(repository):
    """非项目管理员（开发人员）不允许删除标签"""
    from apps.account.models import User
    from apps.project.models import ProjectMember

    developer = User.objects.create_user(username="dev", password="pass", nickname="开发")
    ProjectMember.objects.create(project=repository.project, user=developer, role="developer")
    client = APIClient()
    client.force_authenticate(user=developer)

    response = client.post(
        f"/api/repositories/{repository.id}/delete-tag/",
        {"tag_name": "VA.1.0.0"},
        format="json",
    )

    assert response.status_code == 403
