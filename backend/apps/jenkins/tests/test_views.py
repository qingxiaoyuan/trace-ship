"""
Jenkins 接口集成测试
"""
import pytest
from rest_framework.test import APIClient
from unittest.mock import MagicMock

from apps.account.models import User
from apps.project.models import ProjectMember


pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client(user):
    """已认证测试客户端"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def patched_jenkins_views(monkeypatch, mock_jenkins_provider):
    """替换视图层的 Jenkins Provider"""
    from apps.jenkins import services
    from utils.provider import credential_resolver

    def fake_resolve_credential(source, request_user=None):
        return {"token": "test"}

    def fake_get_provider(vendor, server_url, credential_data):
        return mock_jenkins_provider

    monkeypatch.setattr(services, "resolve_credential", fake_resolve_credential)
    monkeypatch.setattr(services, "get_provider", fake_get_provider)
    monkeypatch.setattr("apps.jenkins.tasks.poll_jenkins_build.delay", MagicMock())
    return mock_jenkins_provider


class TestJenkinsViews:
    """Jenkins API 测试类"""

    def test_create_job(self, api_client, project, jenkins_credential):
        """创建 Jenkins 任务"""
        response = api_client.post(
            "/api/jenkins/jobs/",
            {
                "project": str(project.id),
                "name": "后端打包",
                "server_url": "https://jenkins.example.com",
                "job_name": "backend-build",
                "credential": str(jenkins_credential.id),
                "credential_mode": "project",
                "params_template": {"VERSION": "{version}"},
            },
            format="json",
        )
        assert response.status_code == 201
        assert response.data["code"] == 0
        assert response.data["data"]["job_name"] == "backend-build"

    def test_create_job_rejects_non_manager(self, project):
        """非项目管理员不能创建 Jenkins 任务"""
        developer = User.objects.create_user(
            username="jenkinsdeveloper",
            password="testpass",
            nickname="Jenkins 开发者",
        )
        ProjectMember.objects.create(project=project, user=developer, role="developer")
        client = APIClient()
        client.force_authenticate(user=developer)

        response = client.post(
            "/api/jenkins/jobs/",
            {
                "project": str(project.id),
                "name": "后端打包",
                "server_url": "https://jenkins.example.com",
                "job_name": "backend-build",
                "credential_mode": "project",
                "params_template": {"VERSION": "{version}"},
            },
            format="json",
        )

        assert response.status_code == 400
        assert "只有项目管理员" in str(response.data)

    def test_trigger_build(self, api_client, jenkins_job, patched_jenkins_views):
        """触发构建"""
        response = api_client.post(
            f"/api/jenkins/jobs/{jenkins_job.id}/trigger/",
            {"version": "VA.1.0.0", "branch": "main", "git_hash": "abc"},
            format="json",
        )
        assert response.status_code == 201
        assert response.data["code"] == 0
        assert response.data["data"]["status"] == "queue"

    def test_build_detail(self, api_client, jenkins_job):
        """查询构建详情"""
        from apps.jenkins.models import JenkinsBuild
        build = JenkinsBuild.objects.create(
            job=jenkins_job,
            queue_id="123",
            build_number=1,
            status="success",
        )
        response = api_client.get(f"/api/jenkins/builds/{build.id}/")
        assert response.status_code == 200
        assert response.data["data"]["build_number"] == 1

    def test_build_log(self, api_client, jenkins_job, patched_jenkins_views):
        """查询构建日志"""
        from apps.jenkins.models import JenkinsBuild
        build = JenkinsBuild.objects.create(
            job=jenkins_job,
            queue_id="123",
            build_number=1,
            status="success",
        )
        response = api_client.get(f"/api/jenkins/builds/{build.id}/log/")
        assert response.status_code == 200
        assert "Finished: SUCCESS" in response.data["data"]["content"]
