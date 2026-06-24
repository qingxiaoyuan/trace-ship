"""
发布管理接口集成测试
"""
import pytest
from unittest.mock import MagicMock

from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord


pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client(user):
    """已认证测试客户端"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def patched_provider(monkeypatch, mock_git_provider):
    """将 release 服务中的 Provider 替换为模拟对象"""
    from apps.release import services
    from utils.provider import credential_resolver

    def fake_resolve_credential(source, request_user=None):
        return {"token": "test"}

    def fake_get_provider(vendor, server_url, credential_data):
        return mock_git_provider

    monkeypatch.setattr(credential_resolver, "resolve_credential", fake_resolve_credential)
    monkeypatch.setattr(services, "get_provider", fake_get_provider)
    return mock_git_provider


class TestReleaseViews:
    """Release API 测试类"""

    def test_create_formal_release_success(self, api_client, project, repository, patched_provider):
        """创建正式发布申请成功"""
        response = api_client.post(
            "/api/releases/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "release_type": "formal",
                "source_branch": "develop",
                "target_branch": "main",
            },
            format="json",
        )
        assert response.status_code == 201
        assert response.data["code"] == 0
        data = response.data["data"]
        assert data["version"] == "VA.1.0.0"
        assert data["tag_name"] == "VA.1.0.0"
        assert data["status"] == "draft"

    def test_create_formal_release_rejects_non_main_branch(self, api_client, project, repository, patched_provider):
        """正式版本非主分支被拒绝"""
        response = api_client.post(
            "/api/releases/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "release_type": "formal",
                "source_branch": "develop",
                "target_branch": "develop",
            },
            format="json",
        )
        assert response.status_code == 400
        assert response.data["code"] == 40002

    def test_generate_doc(self, api_client, project, repository, commit, patched_provider):
        """生成发布说明"""
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            source_branch="develop",
            target_branch="main",
            release_type="formal",
            publisher=api_client.handler._force_user,
        )
        response = api_client.post(
            f"/api/releases/{release.id}/generate-doc/",
            {"merge_similar": True},
            format="json",
        )
        assert response.status_code == 200
        assert response.data["code"] == 0
        assert response.data["data"]["change_type"] == "无配置项改动"

    def test_submit_audit(self, api_client, project, repository, commit, patched_provider):
        """提交审批"""
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            source_branch="develop",
            target_branch="main",
            release_type="formal",
            publisher=api_client.handler._force_user,
            release_doc={"updates": []},
        )
        response = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
        assert response.status_code == 200
        assert response.data["data"]["status"] == "pending"

    def test_push_tag(self, api_client, project, repository, patched_provider):
        """推 tag"""
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            source_branch="develop",
            target_branch="main",
            release_type="formal",
            status="auditing",
            git_hash="targethead001",
            publisher=api_client.handler._force_user,
        )
        response = api_client.post(f"/api/releases/{release.id}/push-tag/", format="json")
        assert response.status_code == 200
        assert response.data["code"] == 0
        assert response.data["data"]["tag_name"] == "VA.1.0.0"
        release.refresh_from_db()
        assert release.status == "released"

    def test_list_releases(self, api_client, project, repository):
        """查询发布列表"""
        ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            source_branch="develop",
            target_branch="main",
            release_type="formal",
            publisher=api_client.handler._force_user,
        )
        response = api_client.get("/api/releases/")
        assert response.status_code == 200
        assert response.data["data"]["total"] == 1
