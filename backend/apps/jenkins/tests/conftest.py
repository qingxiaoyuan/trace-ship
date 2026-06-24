"""
Jenkins 集成测试夹具
"""
import pytest

from apps.account.models import User
from apps.jenkins.models import JenkinsBuild, JenkinsJob
from apps.project.models import Project, ProjectMember
from apps.repository.models import Repository


@pytest.fixture
def user():
    """测试用户"""
    return User.objects.create_user(
        username="jenkinsuser",
        password="testpass",
        nickname="Jenkins 测试用户",
    )


@pytest.fixture
def project(user):
    """测试项目"""
    project = Project.objects.create(
        code="JENKINS",
        name="Jenkins 测试项目",
        leader=user,
        status=1,
    )
    ProjectMember.objects.create(project=project, user=user, role="manager")
    return project


@pytest.fixture
def repository(project):
    """测试仓库"""
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="后端仓库",
        url="https://gitlab.example.com/jenkins/backend.git",
        external_identity="jenkins/backend",
        default_branch="develop",
        credential_mode="global",
    )


@pytest.fixture
def jenkins_job(project):
    """测试 Jenkins 任务"""
    return JenkinsJob.objects.create(
        project=project,
        name="后端打包",
        server_url="https://jenkins.example.com",
        job_name="backend-build",
        credential_mode="global",
        params_template={"VERSION": "{version}", "BRANCH": "{branch}"},
    )


@pytest.fixture
def mock_jenkins_provider():
    """模拟 JenkinsProvider"""
    class MockProvider:
        def __init__(self):
            self.build_number = None
            self.status = "running"
            self.artifacts = []

        def trigger_build(self, job_name, params=None):
            return {"queue_id": 123}

        def get_build_number(self, job_name, queue_id):
            return self.build_number

        def get_build_info(self, job_name, build_number):
            return {
                "build_number": build_number,
                "status": self.status,
                "url": f"https://jenkins.example.com/job/{job_name}/{build_number}/",
                "duration": 60000,
                "artifacts": self.artifacts,
            }

        def get_build_log(self, job_name, build_number):
            return "Started by user...\nFinished: SUCCESS"

    return MockProvider()
