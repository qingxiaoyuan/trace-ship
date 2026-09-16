"""
发布管理接口集成测试
"""

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.project.models import ProductComponent, Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.workflow.models import WorkflowDefinition
from utils.provider.base import TagInfo

TODAY = timezone.now().strftime("%Y%m%d")


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

    def fake_resolve_credential(source, request_user=None, **_kwargs):
        return {"token": "test"}

    def fake_get_provider(vendor, server_url, credential_data):
        return mock_git_provider

    monkeypatch.setattr(credential_resolver, "resolve_credential", fake_resolve_credential)
    monkeypatch.setattr(services, "resolve_credential", fake_resolve_credential)
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
                "redmine_url": "https://redmine.example.com/issues/12345",
            },
            format="json",
        )
        assert response.status_code == 201
        assert response.data["code"] == 0
        data = response.data["data"]
        assert data["version"] == "VA.1.0.0"
        assert data["tag_name"] == f"VA.1.0.0_{TODAY}"
        assert data["status"] == "draft"
        assert data["redmine_url"] == "https://redmine.example.com/issues/12345"
        assert ReleaseRecord.objects.get(id=data["id"]).redmine_url == data["redmine_url"]

    def test_create_release_rejects_invalid_redmine_url(
        self, api_client, project, repository, patched_provider
    ):
        """Redmine 任务地址填写后必须是完整 URL。"""
        response = api_client.post(
            "/api/releases/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "release_type": "formal",
                "branch": "main",
                "redmine_url": "redmine/issues/12345",
            },
            format="json",
        )

        assert response.status_code == 400
        assert ReleaseRecord.objects.count() == 0

    def test_create_release_accepts_reused_product_component(
        self, api_client, user, repository, patched_provider
    ):
        """仓库通过产品组件复用后，可继续使用兼容的单仓库发布入口。"""
        target = Project.objects.create(
            code="SDK",
            name="SDK 产品",
            leader=user,
            status=1,
            version_rule={"prefix": "VA", "major": 1, "minor": 0, "patch": 0},
        )
        ProjectMember.objects.create(project=target, user=user, role="manager")
        ProductComponent.objects.create(
            project=target,
            repository=repository,
            component_code="middleware",
            display_name="中台组件",
            default_branch="main",
        )

        response = api_client.post(
            "/api/releases/",
            {
                "project": str(target.id),
                "repository": str(repository.id),
                "release_type": "formal",
                "branch": "main",
            },
            format="json",
        )

        assert response.status_code == 201
        assert str(response.data["data"]["project"]) == str(target.id)
        assert str(response.data["data"]["repository"]) == str(repository.id)

    def test_create_formal_release_allows_non_main_branch(self, api_client, project, repository, patched_provider):
        """正式版本不限制发布分支"""
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
        assert response.status_code == 201
        assert response.data["code"] == 0
        assert response.data["data"]["branch"] == "develop"

    def test_update_draft_rejects_existing_tag(self, api_client, project, repository, patched_provider):
        """草稿编辑版本时校验远端 tag 已存在。"""
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            status="draft",
            publisher=api_client.handler._force_user,
        )
        patched_provider.tags = [TagInfo(name=f"VA.1.0.1_{TODAY}", commit_hash="old")]

        response = api_client.patch(
            f"/api/releases/{release.id}/",
            {"version": "VA.1.0.1"},
            format="json",
        )

        assert response.status_code == 400
        assert response.data["code"] == 40002
        assert "Tag 已存在" in response.data["message"]

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

    def test_submit_audit_with_empty_node_config_pushes_tag(
        self, api_client, project, repository, commit, patched_provider, user
    ):
        """无中间审批节点时提交后直接推 tag 发布"""
        WorkflowDefinition.objects.create(
            project=project,
            name="发布审批",
            biz_type="release",
            release_type="formal",
            is_active=True,
            node_config=[],
            graph_data={"nodes": [], "edges": []},
            created_by=user,
        )
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="develop",
            release_type="formal",
            publisher=api_client.handler._force_user,
            release_doc="| 项目 | 内容 |\n|------|------|\n| 变更类型 | 无配置项改动 |",
            git_hash="head001",
        )
        response = api_client.post(f"/api/releases/{release.id}/submit-audit/", format="json")
        assert response.status_code == 200
        assert response.data["data"]["status"] == "released"
        assert response.data["data"]["workflow_instance_id"] is None

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

    def test_delete_released_tag_success(self, api_client, project, repository, patched_provider):
        """管理员输入正确 tag 名称后删除已发布版本（远端 tag + 本地记录）"""
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0_20260814",
            branch="main",
            release_type="formal",
            status="released",
            released_at=timezone.now(),
            publisher=api_client.handler._force_user,
        )
        response = api_client.post(
            f"/api/releases/{release.id}/delete-released/",
            {"tag_name": "VA.1.0.0_20260814"},
            format="json",
        )
        assert response.status_code == 200
        assert response.data["code"] == 0
        assert response.data["data"]["tag_name"] == "VA.1.0.0_20260814"
        assert response.data["data"]["remote_deleted"] is True
        assert not ReleaseRecord.objects.filter(id=release.id).exists()

    def test_delete_released_tag_mismatch(self, api_client, project, repository, patched_provider):
        """输入的 tag 名称与发布记录不一致时拒绝删除"""
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0_20260814",
            branch="main",
            release_type="formal",
            status="released",
            released_at=timezone.now(),
            publisher=api_client.handler._force_user,
        )
        response = api_client.post(
            f"/api/releases/{release.id}/delete-released/",
            {"tag_name": "VA.9.9.9_99999999"},
            format="json",
        )
        assert response.status_code == 400
        assert "不一致" in response.data["message"]
        assert ReleaseRecord.objects.filter(id=release.id).exists()

    def test_delete_released_tag_rejects_not_released(self, api_client, project, repository, patched_provider):
        """非已发布状态不允许删除版本"""
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0_20260814",
            branch="main",
            release_type="formal",
            status="pending",
            publisher=api_client.handler._force_user,
        )
        response = api_client.post(
            f"/api/releases/{release.id}/delete-released/",
            {"tag_name": "VA.1.0.0_20260814"},
            format="json",
        )
        assert response.status_code == 400
        assert "仅已发布状态" in response.data["message"]
        assert ReleaseRecord.objects.filter(id=release.id).exists()

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

    def test_list_releases_exposes_open_review_count(self, api_client, project, repository):
        """列表接口返回待整改（open）整改意见数，用于列表「待整改」徽标"""
        from apps.release.models import ReleaseReviewIssue

        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            status="released",
            publisher=api_client.handler._force_user,
        )
        user = api_client.handler._force_user
        ReleaseReviewIssue.objects.create(release=release, author=user, content="待整改项一", status="open")
        ReleaseReviewIssue.objects.create(release=release, author=user, content="待整改项二", status="open")
        ReleaseReviewIssue.objects.create(release=release, author=user, content="已通过项", status="resolved")

        response = api_client.get("/api/releases/")
        assert response.status_code == 200
        row = response.data["data"]["results"][0]
        assert row["open_review_count"] == 2

    def test_release_commits_endpoint(self, api_client, project, repository, commit):
        """发布关联提交接口正常返回（回归：视图集 filterset 模型不匹配导致 500）"""
        from apps.release.models import ReleaseCommit

        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            publisher=api_client.handler._force_user,
        )
        ReleaseCommit.objects.create(release=release, commit=commit)

        response = api_client.get(f"/api/releases/{release.id}/commits/")
        assert response.status_code == 200
        assert response.data["data"]["total"] == 1
        assert response.data["data"]["results"][0]["commit_hash"] == "abc123def"

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


class TestReleasePackageConfigSelection:
    """发布创建时勾选「发布后自动打包」配置的接口测试"""

    def test_create_release_with_selected_package_configs(
        self, api_client, project, repository, patched_provider
    ):
        """创建发布时传入勾选配置：响应与记录仅保留该仓库启用了自动打包的合法 id"""
        from apps.package.models import PackageConfig, PackageImage

        image = PackageImage.objects.create(name="Web 镜像", image="trace-ship/web:latest")
        config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="Web 打包",
            image=image,
            auto_package_on_release=True,
        )
        other_config = PackageConfig.objects.create(
            project=project,
            repository=repository,
            name="普通打包",
            image=image,
            auto_package_on_release=False,
        )
        response = api_client.post(
            "/api/releases/",
            {
                "project": str(project.id),
                "repository": str(repository.id),
                "release_type": "formal",
                "branch": "main",
                "package_config_ids": [
                    str(config.id),
                    str(other_config.id),
                    "00000000-0000-0000-0000-000000000000",
                ],
            },
            format="json",
        )
        assert response.status_code == 201
        assert response.data["code"] == 0
        data = response.data["data"]
        assert data["package_config_ids"] == [str(config.id)]

        record = ReleaseRecord.objects.get(id=data["id"])
        assert list(record.package_config_ids) == [str(config.id)]

    def test_create_release_without_selection_keeps_none(
        self, api_client, project, repository, patched_provider
    ):
        """创建发布未勾选打包配置时 package_config_ids 为 None（保留历史全量语义）"""
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
        data = response.data["data"]
        assert data["package_config_ids"] is None
