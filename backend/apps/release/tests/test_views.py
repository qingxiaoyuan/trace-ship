"""
发布管理接口集成测试
"""
import pytest
from unittest.mock import MagicMock

from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord


from apps.workflow.models import WorkflowDefinition


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

    def test_create_formal_release_clears_own_empty_existing_draft(self, api_client, project, repository, patched_provider):
        """创建发布时若当前用户已有同版本空草稿，应先删除旧空草稿"""
        old = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            status="draft",
            publisher=api_client.handler._force_user,
        )
        response = api_client.post(
            "/api/releases/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "release_type": "formal",
                "branch": "main",
            },
            format="json",
        )
        assert response.status_code == 201
        assert response.data["code"] == 0
        assert not ReleaseRecord.objects.filter(id=old.id).exists()
        assert ReleaseRecord.objects.filter(
            project=project, repository=repository, version="VA.1.0.0", status="draft"
        ).count() == 1

    def test_create_formal_release_keeps_existing_draft_with_content(self, api_client, project, repository, patched_provider):
        """创建发布不会删除已有内容的同版本草稿"""
        old = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            status="draft",
            release_doc="| 项目 | 内容 |\n|------|------|\n| 变更类型 | 无配置项改动 |",
            publisher=api_client.handler._force_user,
        )
        response = api_client.post(
            "/api/releases/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "release_type": "formal",
                "branch": "main",
            },
            format="json",
        )
        assert response.status_code == 201
        assert ReleaseRecord.objects.filter(id=old.id).exists()
        assert ReleaseRecord.objects.filter(
            project=project, repository=repository, version="VA.1.0.0", status="draft"
        ).count() == 2

    def test_create_formal_release_success(self, api_client, project, repository, patched_provider):
        """创建正式发布申请成功"""
        response = api_client.post(
            "/api/releases/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "release_type": "formal",
                "branch": "main",
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
                "branch": "develop",
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
            branch="main",
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
        # generate_doc 返回 Markdown 字符串
        assert isinstance(response.data["data"], str)
        assert "| 项目 | 内容 |" in response.data["data"]

    def test_submit_audit(self, api_client, project, repository, commit, patched_provider, user):
        """提交审批"""
        WorkflowDefinition.objects.create(
            project=project,
            name="发布审批",
            biz_type="release",
            is_active=True,
            node_config=[
                {
                    "node_id": "approval",
                    "node_name": "审批",
                    "approvers": [{"type": "leader"}],
                    "mode": "any",
                }
            ],
            graph_data={
                "nodes": [
                    {"id": "start", "type": "start-node", "x": 100, "y": 200, "text": "开始"},
                    {"id": "approval", "type": "approval-node", "x": 300, "y": 200, "text": "审批", "properties": {"approver_type": "leader"}},
                    {"id": "end", "type": "end-node", "x": 500, "y": 200, "text": "结束"},
                ],
                "edges": [
                    {"id": "e1", "sourceNodeId": "start", "targetNodeId": "approval"},
                    {"id": "e2", "sourceNodeId": "approval", "targetNodeId": "end"},
                ],
            },
            created_by=user,
        )
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            publisher=api_client.handler._force_user,
            release_doc="| 项目 | 内容 |\n|------|------|\n| 变更类型 | 无配置项改动 |",
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
            branch="main",
            release_type="formal",
            status="pending",
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
            branch="main",
            release_type="formal",
            publisher=api_client.handler._force_user,
        )
        response = api_client.get("/api/releases/")
        assert response.status_code == 200
        assert response.data["data"]["total"] == 1

    def test_retrieve_returns_package_tasks(self, api_client, project, repository):
        """详情接口展开关联打包任务概要"""
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            publisher=api_client.handler._force_user,
        )
        from apps.package.models import PackageTask

        PackageTask.objects.create(
            release=release,
            project=project,
            repository=repository,
            name="打包任务",
            mode="simple",
            build_type="web",
            tag_name=release.tag_name,
            version=release.version,
            status="success",
            artifact_info=[{"id": "a", "path": "dist/app.zip"}],
        )
        response = api_client.get(f"/api/releases/{release.id}/")
        assert response.status_code == 200
        tasks = response.data["data"]["package_tasks"]
        assert len(tasks) == 1
        assert tasks[0]["status"] == "success"
        assert tasks[0]["artifact_count"] == 1

    def test_retrieve_package_tasks_empty_when_no_task(self, api_client, project, repository):
        """未关联打包任务时 package_tasks 为空列表"""
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            publisher=api_client.handler._force_user,
        )
        response = api_client.get(f"/api/releases/{release.id}/")
        assert response.status_code == 200
        assert response.data["data"]["package_tasks"] == []
