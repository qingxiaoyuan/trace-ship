"""SVN 推送配置测试。"""
from unittest.mock import MagicMock, patch

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.credential.models import Credential
from apps.package.models import PackageConfig
from apps.project.models import Project, ProjectMember
from apps.repository.models import Repository
from utils.provider.exceptions import AuthenticationError, ConnectionError, NotFoundError


@pytest.fixture
def user():
    return User.objects.create_user(
        username="svn_config_user",
        password="pass",
        nickname="SVN 配置用户",
    )


@pytest.fixture
def api_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(user):
    project = Project.objects.create(
        name="SVN 配置项目",
        code="SVNC",
        leader=user,
        status=1,
    )
    ProjectMember.objects.create(project=project, user=user, role="manager")
    return project


@pytest.fixture
def repository(project):
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="web",
        url="https://gitlab.example.com",
        external_identity="group/web",
        default_branch="main",
    )


@pytest.fixture
def svn_credential(user):
    cred = Credential.objects.create(
        name="SVN 凭证",
        cred_type="svn_password",
        auth_mode="password",
        owner=user,
        is_active=True,
    )
    cred.set_data({"username": "svnuser", "password": "svnpass"})
    cred.save()
    return cred


@pytest.fixture
def svn_config(project, repository, svn_credential):
    return PackageConfig.objects.create(
        project=project,
        repository=repository,
        name="SVN 推送配置",
        svn_push_enabled=True,
        svn_url="svn://svn.example.com/releases",
        svn_credential=svn_credential,
        svn_path_template="{version}",
    )


def _make_provider(entries=None, exc=None):
    mock = MagicMock()
    if exc:
        mock.list_dir.side_effect = exc
    else:
        mock.list_dir.return_value = entries or []
    return mock
def _make_provider(entries=None, exc=None):
    mock = MagicMock()
    if exc:
        mock.list_dir.side_effect = exc
    else:
        mock.list_dir.return_value = entries or []
    return mock


@pytest.mark.django_db
class TestSVNConfigTestAction:
    def test_test_svn_success(self, api_client, project, svn_credential):
        with patch("apps.package.views.get_provider", return_value=_make_provider([{"name": "v1.0.0", "kind": "dir"}])):
            response = api_client.post(
                "/api/packages/configs/test-svn/",
                {
                    "project_id": str(project.id),
                    "svn_url": "svn://svn.example.com/releases",
                    "svn_credential_id": str(svn_credential.id),
                },
                format="json",
            )
        assert response.status_code == 200
        assert response.data["code"] == 0
        assert response.data["data"]["ok"] is True
        assert response.data["data"]["entries"][0]["name"] == "v1.0.0"

    def test_test_svn_with_literal_path_template(self, api_client, project, svn_credential):
        with patch(
            "apps.package.views.get_provider",
            return_value=_make_provider([{"name": "dist.zip", "kind": "file"}]),
        ) as mock_factory:
            response = api_client.post(
                "/api/packages/configs/test-svn/",
                {
                    "project_id": str(project.id),
                    "svn_url": "svn://svn.example.com/releases",
                    "svn_credential_id": str(svn_credential.id),
                    "svn_path_template": "myapp",
                },
                format="json",
            )
        assert response.status_code == 200
        assert response.data["data"]["ok"] is True
        provider = mock_factory.return_value
        provider.list_dir.assert_called_once_with("svn://svn.example.com/releases/myapp")

    def test_test_svn_authentication_error(self, api_client, project, svn_credential):
        with patch("apps.package.views.get_provider", return_value=_make_provider(exc=AuthenticationError("auth failed"))):
            response = api_client.post(
                "/api/packages/configs/test-svn/",
                {
                    "project_id": str(project.id),
                    "svn_url": "svn://svn.example.com/releases",
                    "svn_credential_id": str(svn_credential.id),
                },
                format="json",
            )
        assert response.status_code == 401
        assert response.data["code"] == 40100
        assert "账号或密码" in response.data["message"]

    def test_test_svn_not_found_error(self, api_client, project, svn_credential):
        with patch("apps.package.views.get_provider", return_value=_make_provider(exc=NotFoundError("path not found"))):
            response = api_client.post(
                "/api/packages/configs/test-svn/",
                {
                    "project_id": str(project.id),
                    "svn_url": "svn://svn.example.com/releases",
                    "svn_credential_id": str(svn_credential.id),
                    "svn_path_template": "missing",
                },
                format="json",
            )
        assert response.status_code == 404
        assert response.data["code"] == 40400
        assert "路径不存在" in response.data["message"]

    def test_test_svn_connection_error(self, api_client, project, svn_credential):
        with patch("apps.package.views.get_provider", return_value=_make_provider(exc=ConnectionError("timeout"))):
            response = api_client.post(
                "/api/packages/configs/test-svn/",
                {
                    "project_id": str(project.id),
                    "svn_url": "svn://svn.example.com/releases",
                    "svn_credential_id": str(svn_credential.id),
                },
                format="json",
            )
        assert response.status_code == 502
        assert response.data["code"] == 50200
        assert "无法连接" in response.data["message"]

    def test_test_svn_missing_fields(self, api_client, project, svn_credential):
        response = api_client.post(
            "/api/packages/configs/test-svn/",
            {"project_id": str(project.id)},
            format="json",
        )
        assert response.status_code == 400
        assert response.data["code"] == 40000

    def test_test_svn_invalid_url_scheme(self, api_client, project, svn_credential):
        response = api_client.post(
            "/api/packages/configs/test-svn/",
            {
                "project_id": str(project.id),
                "svn_url": "ftp://svn.example.com/releases",
                "svn_credential_id": str(svn_credential.id),
            },
            format="json",
        )
        assert response.status_code == 400
        assert response.data["code"] == 40000
        assert "svn://" in response.data["message"]

    def test_test_svn_forbidden_for_non_manager(self, project, svn_credential):
        dev_user = User.objects.create_user(
            username="svn_dev_user",
            password="pass",
            nickname="开发人员",
        )
        ProjectMember.objects.create(project=project, user=dev_user, role="developer")
        client = APIClient()
        client.force_authenticate(user=dev_user)
        with patch("apps.package.views.get_provider", return_value=_make_provider()):
            response = client.post(
                "/api/packages/configs/test-svn/",
                {
                    "project_id": str(project.id),
                    "svn_url": "svn://svn.example.com/releases",
                    "svn_credential_id": str(svn_credential.id),
                },
                format="json",
            )
        assert response.status_code == 403
        assert response.data["code"] == 40300
        assert response.status_code == 403
        assert response.data["code"] == 40300


@pytest.mark.django_db
class TestSVNConfigSerializerValidation:
    def test_serializer_rejects_invalid_url_scheme(self, project, repository, svn_credential, user):
        from unittest.mock import MagicMock
        from apps.package.models import PackageImage
        from apps.package.serializers import PackageConfigSerializer

        image = PackageImage.objects.create(
            name="Web 构建镜像",
            image="trace-ship/web-builder:node22",
        )
        data = {
            "project": project.id,
            "repository": repository.id,
            "name": "测试配置",
            "image": image.id,
            "svn_push_enabled": True,
            "svn_url": "ssh://svn.example.com/releases",
            "svn_credential": svn_credential.id,
            "svn_path_template": "{version}",
        }
        request = MagicMock()
        request.user = user
        serializer = PackageConfigSerializer(data=data, context={"request": request})
        assert not serializer.is_valid()
        assert "svn_url" in serializer.errors
        assert "svn://" in str(serializer.errors["svn_url"][0])
    def test_serializer_rejects_invalid_url_scheme(self, project, repository, svn_credential, user):
        from unittest.mock import MagicMock
        from apps.package.models import PackageImage
        from apps.package.serializers import PackageConfigSerializer

        image = PackageImage.objects.create(
            name="Web 构建镜像",
            image="trace-ship/web-builder:node22",
        )
        data = {
            "project": project.id,
            "repository": repository.id,
            "name": "测试配置",
            "image": image.id,
            "svn_push_enabled": True,
            "svn_url": "ssh://svn.example.com/releases",
            "svn_credential": svn_credential.id,
            "svn_path_template": "{version}",
        }
        request = MagicMock()
        request.user = user
        serializer = PackageConfigSerializer(data=data, context={"request": request})
        assert not serializer.is_valid()
        assert "svn_url" in serializer.errors
        assert "svn://" in str(serializer.errors["svn_url"][0])
