"""SVN 制品目录浏览相关测试。"""
from unittest.mock import MagicMock, patch

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.credential.models import Credential
from apps.package.models import PackageConfig
from apps.project.models import Project, ProjectMember
from apps.repository.models import Repository
from utils.provider.svn import SVNProvider


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def user():
    return User.objects.create_user(
        username="svn_browse_user",
        password="pass",
        nickname="SVN 浏览用户",
    )


@pytest.fixture
def api_client(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(user):
    project = Project.objects.create(
        name="SVN 浏览项目",
        code="SVNB",
        leader=user,
        status=1,
    )
    ProjectMember.objects.create(project=project, user=user, role="developer")
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
        name="SVN 浏览配置",
        custom_script="echo build",
        svn_push_enabled=True,
        svn_url="svn://host/releases",
        svn_credential=svn_credential,
        svn_path_template="{version}",
    )


# ---------------------------------------------------------------------------
# SVNProvider.list_dir 测试
# ---------------------------------------------------------------------------

class TestSVNProviderListDir:
    """SVNProvider.list_dir 方法测试。"""

    LIST_XML = """<?xml version="1.0" encoding="UTF-8"?>
<lists>
<list path="svn://host/releases">
  <entry kind="dir">
    <name>V1.0.0</name>
    <commit revision="42">
      <author>svnuser</author>
      <date>2026-07-20T08:00:00.000000Z</date>
    </commit>
  </entry>
  <entry kind="file">
    <name>README.txt</name>
    <size>128</size>
    <commit revision="40">
      <author>other</author>
      <date>2026-07-19T08:00:00.000000Z</date>
    </commit>
  </entry>
</list>
</lists>
"""

    def test_list_dir_parses_entries(self):
        """svn list --xml 输出正确解析为条目列表。"""
        provider = SVNProvider("svn://host/releases", {"username": "u", "password": "p"})
        with patch("utils.provider.svn.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout=self.LIST_XML, stderr="")
            entries = provider.list_dir("svn://host/releases")

        cmd = mock_run.call_args[0][0]
        assert "list" in cmd
        assert "--xml" in cmd
        assert "svn://host/releases" in cmd

        assert len(entries) == 2
        dir_entry, file_entry = entries
        assert dir_entry["name"] == "V1.0.0"
        assert dir_entry["kind"] == "dir"
        assert dir_entry["size"] == 0
        assert dir_entry["revision"] == "42"
        assert dir_entry["author"] == "svnuser"
        assert dir_entry["date"] is not None
        assert file_entry["name"] == "README.txt"
        assert file_entry["kind"] == "file"
        assert file_entry["size"] == 128

    def test_list_dir_defaults_to_repo_url(self):
        """未传 url 时列出仓库根地址。"""
        provider = SVNProvider("svn://host/releases/", {"username": "u", "password": "p"})
        with patch("utils.provider.svn.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout=self.LIST_XML, stderr="")
            provider.list_dir()

        cmd = mock_run.call_args[0][0]
        assert "svn://host/releases" in cmd

    def test_list_dir_raises_on_invalid_xml(self):
        """XML 无法解析时抛出 ProviderError。"""
        from utils.provider.exceptions import ProviderError

        provider = SVNProvider("svn://host/releases", {"username": "u", "password": "p"})
        with patch("utils.provider.svn.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0, stdout="not xml", stderr="")
            with pytest.raises(ProviderError):
                provider.list_dir("svn://host/releases")


# ---------------------------------------------------------------------------
# svn-entries 接口测试
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestSvnEntriesView:
    """PackageConfigViewSet.svn_entries 接口测试。"""

    def _url(self, config_id, path=""):
        url = f"/api/packages/configs/{config_id}/svn-entries/"
        return f"{url}?path={path}" if path else url

    def test_list_root_entries(self, api_client, svn_config):
        """列出 SVN 根目录内容。"""
        mock_provider = MagicMock()
        mock_provider.list_dir.return_value = [
            {"name": "V1.0.0", "kind": "dir", "size": 0, "revision": "42", "author": "u", "date": None},
        ]
        with patch("apps.package.views.get_provider", return_value=mock_provider):
            response = api_client.get(self._url(svn_config.id))

        assert response.status_code == 200
        data = response.data["data"]
        assert data["base_url"] == "svn://host/releases"
        assert data["path"] == ""
        assert len(data["entries"]) == 1
        mock_provider.list_dir.assert_called_once_with("svn://host/releases")

    def test_list_sub_path(self, api_client, svn_config):
        """列出子目录时拼接到 svn_url 之后。"""
        mock_provider = MagicMock()
        mock_provider.list_dir.return_value = []
        with patch("apps.package.views.get_provider", return_value=mock_provider):
            response = api_client.get(self._url(svn_config.id, "V1.0.0/docs"))

        assert response.status_code == 200
        assert response.data["data"]["path"] == "V1.0.0/docs"
        mock_provider.list_dir.assert_called_once_with("svn://host/releases/V1.0.0/docs")

    def test_reject_invalid_path(self, api_client, svn_config):
        """包含 .. 的路径被拒绝。"""
        response = api_client.get(self._url(svn_config.id, "../other"))
        assert response.status_code == 400

    def test_reject_when_svn_not_enabled(self, api_client, project, repository):
        """未启用 SVN 推送的配置返回 400。"""
        config = PackageConfig.objects.create(
            project=project, repository=repository, name="普通配置",
        )
        response = api_client.get(self._url(config.id))
        assert response.status_code == 400

    def test_reject_when_credential_inactive(self, api_client, svn_config, svn_credential):
        """SVN 凭证停用时返回 400。"""
        svn_credential.is_active = False
        svn_credential.save()
        response = api_client.get(self._url(svn_config.id))
        assert response.status_code == 400

    def test_svn_failure_returns_502(self, api_client, svn_config):
        """SVN 服务不可达时返回 502。"""
        from utils.provider.exceptions import ConnectionError as ProviderConnectionError

        mock_provider = MagicMock()
        mock_provider.list_dir.side_effect = ProviderConnectionError("SVN 命令执行超时")
        with patch("apps.package.views.get_provider", return_value=mock_provider):
            response = api_client.get(self._url(svn_config.id))
        assert response.status_code == 502

    def test_non_member_cannot_browse(self, api_client, svn_config, user, project):
        """与项目无关联（非成员且非 leader）的用户无法浏览（queryset 过滤后返回 404）。"""
        ProjectMember.objects.filter(project=project, user=user).delete()
        # leader 视同隐含成员，需将项目 leader 换为他人才能构造「无关联」场景
        project.leader = User.objects.create_user(username="svn_browse_leader", password="pass")
        project.save(update_fields=["leader"])
        response = api_client.get(self._url(svn_config.id))
        assert response.status_code == 404
