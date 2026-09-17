"""
凭证模块视图测试

覆盖可见性规则（个人凭证 + SVN 系统共享）、类型与认证模式一致性校验和删除前引用检查。
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
def other_user():
    """创建另一个测试用户"""
    return User.objects.create_user(username="credential-other", password="pass")


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
def credential(user):
    """创建个人测试凭证并设置加密数据"""
    cred = Credential.objects.create(
        name="GitLab Token",
        cred_type="gitlab_token",
        auth_mode="token",
        owner=user,
    )
    cred.set_data({"token": "glpat-test"})
    cred.save()
    return cred


@pytest.mark.django_db
def test_personal_credential_invisible_to_others(api_client, credential, other_user):
    """
    测试个人凭证仅归属人可见

    期望：其他用户列表中不包含该凭证
    """
    client = APIClient()
    client.force_authenticate(user=other_user)

    response = client.get("/api/credentials/")

    assert response.status_code == 200
    ids = [item["id"] for item in response.data["data"]["results"]]
    assert str(credential.id) not in ids


@pytest.mark.django_db
def test_svn_credential_shared_to_all_users(api_client, user, other_user):
    """
    测试 SVN 凭证全系统共享

    期望：SVN 凭证对其他用户可见，且 is_system_shared 为 true
    """
    svn_cred = Credential.objects.create(
        name="SVN 共享",
        cred_type="svn_password",
        auth_mode="password",
        owner=user,
    )
    svn_cred.set_data({"username": "svn", "password": "secret"})
    svn_cred.save()

    client = APIClient()
    client.force_authenticate(user=other_user)
    response = client.get("/api/credentials/")

    assert response.status_code == 200
    results = response.data["data"]["results"]
    shared = [item for item in results if item["id"] == str(svn_cred.id)]
    assert len(shared) == 1
    assert shared[0]["is_system_shared"] is True


@pytest.mark.django_db
@pytest.mark.parametrize(
    "cred_type,auth_mode,expected_error",
    [
        ("gitlab_token", "password", "auth_mode"),
        ("svn_password", "token", "auth_mode"),
        ("ldap_password", "token", "auth_mode"),
    ],
)
def test_cred_type_auth_mode_consistency(api_client, cred_type, auth_mode, expected_error):
    """
    测试凭证类型与认证模式必须匹配

    Git 类 Token 凭证只能使用 token 模式；SVN/LDAP 密码类只能使用 password 模式。
    """
    payload = {
        "name": "Inconsistent Cred",
        "cred_type": cred_type,
        "auth_mode": auth_mode,
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


@pytest.mark.django_db
def test_credential_types_route_remains_on_credential_viewset(api_client):
    """新增借用路由后，原凭证类型枚举入口仍保持兼容。"""
    response = api_client.get("/api/credentials/types/")

    assert response.status_code == 200
    values = {item["value"] for item in response.data["data"]["cred_types"]}
    assert "gitlab_token" in values


@pytest.mark.django_db
def test_gitlab_credential_test_without_server_url_returns_guidance(api_client, credential):
    """GitLab 凭证未指定地址且无引用仓库时，返回引导提示而非假装成功。"""
    response = api_client.post(f"/api/credentials/{credential.id}/test/", {}, format="json")

    assert response.status_code == 200
    assert response.data["data"]["valid"] is False
    assert "server_url" in response.data["data"]["detail"]


@pytest.mark.django_db
def test_gitlab_credential_test_calls_provider(api_client, credential, monkeypatch):
    """GitLab 凭证指定 server_url 时调用 Provider 做真实连接测试。"""
    called = {}

    class FakeProvider:
        def __init__(self, server_url, credential_data):
            called["server_url"] = server_url
            called["credential_data"] = credential_data

        def test_connection(self):
            return True

    # services 内部为函数内局部导入，直接 patch 工厂即可生效
    monkeypatch.setattr(
        "utils.provider.factory.get_provider",
        lambda vendor, url, data: FakeProvider(url, data),
    )
    response = api_client.post(
        f"/api/credentials/{credential.id}/test/",
        {"server_url": "https://gitlab.example.com"},
        format="json",
    )

    assert response.status_code == 200
    assert response.data["data"]["valid"] is True
    assert called["server_url"] == "https://gitlab.example.com"
    assert called["credential_data"] == {"token": "glpat-test"}


@pytest.mark.django_db
def test_gitlab_credential_test_falls_back_to_repository_url(api_client, credential, project, monkeypatch):
    """GitLab 凭证未指定地址时，回退使用引用仓库的服务器地址。"""
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
    called = {}

    class FakeProvider:
        def __init__(self, server_url, credential_data):
            called["server_url"] = server_url

        def test_connection(self):
            return True

    monkeypatch.setattr(
        "utils.provider.factory.get_provider",
        lambda vendor, url, data: FakeProvider(url, data),
    )

    response = api_client.post(f"/api/credentials/{credential.id}/test/", {}, format="json")

    assert response.status_code == 200
    assert response.data["data"]["valid"] is True
    assert called["server_url"] == "https://gitlab.example.com"


@pytest.mark.django_db
def test_ldap_credential_test_uses_bind_verify(api_client, user, monkeypatch):
    """LDAP 凭证走系统 LDAP 配置做绑定验证。"""
    cred = Credential.objects.create(
        name="LDAP",
        cred_type="ldap_password",
        auth_mode="password",
        owner=user,
        username="ldap-user",
    )
    cred.set_data({"username": "ldap-user", "password": "secret"})
    cred.save()
    called = {}

    def fake_verify(username, password):
        called["username"] = username
        called["password"] = password
        return "LDAP 绑定验证通过"

    monkeypatch.setattr("apps.account.ldap_config.verify_ldap_credential", fake_verify)

    response = api_client.post(f"/api/credentials/{cred.id}/test/", {}, format="json")

    assert response.status_code == 200
    assert response.data["data"]["valid"] is True
    assert called == {"username": "ldap-user", "password": "secret"}


@pytest.mark.django_db
def test_node_password_credential_test_returns_guidance(api_client, user):
    """Windows/SSH 密码依附于具体节点，返回引导提示。"""
    cred = Credential.objects.create(
        name="SSH",
        cred_type="ssh_password",
        auth_mode="password",
        owner=user,
    )
    cred.set_data({"username": "root", "password": "secret"})
    cred.save()

    response = api_client.post(f"/api/credentials/{cred.id}/test/", {}, format="json")

    assert response.status_code == 200
    assert response.data["data"]["valid"] is False
    assert "打包节点" in response.data["data"]["detail"]
