"""
凭证模块视图测试

覆盖作用域校验、类型与认证模式一致性校验和删除前引用检查。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.credential.models import Credential
from apps.project.models import Project, ProjectMember
from apps.repository.models import Repository


@pytest.fixture
def user():
    """创建测试用户"""
    return User.objects.create_user(username="credential-user", password="pass")


@pytest.fixture
def api_client(user):
    """已认证 APIClient"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(user):
    """创建测试项目并将用户设为管理员"""
    project = Project.objects.create(code="CRED", name="凭证项目", leader=user)
    ProjectMember.objects.create(project=project, user=user, role="manager")
    return project


@pytest.fixture
def credential(user, project):
    """创建测试凭证并设置加密数据"""
    cred = Credential.objects.create(
        name="GitLab Token",
        cred_type="gitlab_token",
        auth_mode="token",
        owner=user,
        scope="project",
        project=project,
    )
    cred.set_data({"token": "glpat-test"})
    cred.save()
    return cred


@pytest.mark.django_db
def test_project_scope_credential_requires_project(api_client):
    """
    测试项目级凭证必须关联项目

    期望：未传 project 时返回 400，并提示 project 字段错误
    """
    payload = {
        "name": "Project Token",
        "cred_type": "gitlab_token",
        "auth_mode": "token",
        "scope": "project",
        "data": {"token": "glpat-test"},
    }

    response = api_client.post("/api/credentials/", payload, format="json")

    assert response.status_code == 400
    assert "project" in response.data["data"]


@pytest.mark.django_db
@pytest.mark.parametrize(
    "cred_type,auth_mode,expected_error",
    [
        ("gitlab_token", "password", "auth_mode"),
        ("gitea_token", "password", "auth_mode"),
        ("svn_password", "token", "auth_mode"),
        ("ldap_password", "token", "auth_mode"),
    ],
)
def test_cred_type_auth_mode_consistency(api_client, project, cred_type, auth_mode, expected_error):
    """
    测试凭证类型与认证模式必须匹配

    Git 类 Token 凭证只能使用 token 模式；SVN/LDAP 密码类只能使用 password 模式。
    """
    payload = {
        "name": "Inconsistent Cred",
        "cred_type": cred_type,
        "auth_mode": auth_mode,
        "scope": "project",
        "project": str(project.id),
        "data": {"token": "test-token"},
    }

    response = api_client.post("/api/credentials/", payload, format="json")

    assert response.status_code == 400
    assert expected_error in response.data["data"]
    # 错误文案应使用中文友好名称
    assert "必须使用" in str(response.data["data"])


@pytest.mark.django_db
def test_delete_repository_bound_credential_is_rejected(api_client, credential, project):
    """
    测试被仓库引用的凭证不能删除

    期望：删除时返回 409，响应 code 为 40900
    """
    Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="Bound Repo",
        url="https://gitlab.example.com/test/bound.git",
        external_identity="test/bound",
        credential=credential,
        credential_mode="project",
    )

    response = api_client.delete(f"/api/credentials/{credential.id}/")

    assert response.status_code == 409
    assert response.data["code"] == 40900
