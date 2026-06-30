"""
Jenkins 服务单元测试
"""
import pytest
from unittest.mock import MagicMock

from types import SimpleNamespace

from apps.jenkins.models import JenkinsBuild
from apps.jenkins.services import JenkinsService
from apps.release.models import ReleaseRecord


pytestmark = pytest.mark.django_db


@pytest.fixture
def patched_jenkins(monkeypatch, mock_jenkins_provider, jenkins_job):
    """替换 Jenkins Provider 与凭证解析"""
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


class TestJenkinsService:
    """JenkinsService 测试类"""

    def test_render_params(self, jenkins_job):
        """参数模板渲染"""
        params = JenkinsService._render_params(
            jenkins_job.params_template,
            {"version": "VA.1.0.0", "branch": "main", "git_hash": "abc"},
        )
        assert params["VERSION"] == "VA.1.0.0"
        assert params["BRANCH"] == "main"

    def test_trigger_build_creates_build(self, jenkins_job, patched_jenkins):
        """触发构建创建 JenkinsBuild 记录"""
        release = SimpleNamespace(
            id=None,
            version="VA.1.0.0",
            branch="main",
            git_hash="abc",
        )
        build = JenkinsService.trigger_build(
            jenkins_job,
            release,
        )
        assert build.status == "queue"
        assert build.queue_id == "123"

    def test_refresh_build_status_success_updates_release(self, project, repository, jenkins_job, patched_jenkins, user):
        """构建成功后发布记录标记为已发布"""
        build = JenkinsBuild.objects.create(
            job=jenkins_job,
            queue_id="123",
            build_number=1,
            status="running",
        )
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            status="pending",
            publisher=user,
            jenkins_build=build,
        )
        patched_jenkins.status = "success"
        JenkinsService.refresh_build_status(build)
        build.refresh_from_db()
        release.refresh_from_db()
        assert build.status == "success"
        assert release.status == "released"

    def test_refresh_build_status_failure_rejects_release(self, project, repository, jenkins_job, patched_jenkins, user):
        """构建失败后驳回 ReleaseRecord"""
        build = JenkinsBuild.objects.create(
            job=jenkins_job,
            queue_id="123",
            build_number=1,
            status="building",
        )
        release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="VA.1.0.0",
            tag_name="VA.1.0.0",
            branch="main",
            release_type="formal",
            status="building",
            publisher=user,
            jenkins_build=build,
        )
        patched_jenkins.status = "failure"
        JenkinsService.refresh_build_status(build)
        release.refresh_from_db()
        assert release.status == "rejected"
