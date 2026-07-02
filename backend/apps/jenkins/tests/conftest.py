"""
Jenkins 集成测试夹具
"""
import pytest

from apps.account.models import User
from apps.credential.models import Credential
from apps.jenkins.models import JenkinsBuild, JenkinsBuildPreset, JenkinsJob
from apps.project.models import Project, ProjectMember
from apps.repository.models import Repository
from apps.system.models import SystemConfig


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


@pytest.fixture(autouse=True)
def jenkins_server_config():
    """系统级 Jenkins 地址配置"""
    return SystemConfig.objects.create(
        key="jenkins.server_url",
        value="https://jenkins.example.com",
        description="测试 Jenkins 地址",
        is_public=False,
    )


@pytest.fixture
def jenkins_credential(user, project):
    """测试 Jenkins 凭证（项目级）"""
    cred = Credential.objects.create(
        name="Jenkins Token",
        cred_type="jenkins_token",
        auth_mode="token",
        owner=user,
        scope="project",
        project=project,
    )
    cred.set_data({"token": "jenkins-token-test"})
    cred.save()
    return cred


@pytest.fixture
def repository(project, jenkins_credential):
    """测试仓库"""
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="后端仓库",
        url="https://gitlab.example.com/jenkins/backend.git",
        external_identity="jenkins/backend",
        default_branch="develop",
        credential=jenkins_credential,
        credential_mode="project",
    )


@pytest.fixture
def jenkins_job(project, repository, jenkins_credential):
    """测试 Jenkins 任务"""
    return JenkinsJob.objects.create(
        project=project,
        repository=repository,
        config_mode="advanced",
        build_type="web",
        name="后端打包",
        server_url="https://jenkins.example.com",
        job_name="backend-build",
        credential=jenkins_credential,
        credential_mode="project",
        params_template={"VERSION": "{version}", "BRANCH": "{branch}"},
    )


@pytest.fixture
def build_preset():
    """测试打包预设"""
    return JenkinsBuildPreset.objects.create(
        name="Web 通用镜像",
        build_type="web",
        image="trace-ship/web-builder:latest",
        script_entry="/usr/local/bin/trace-ship-build",
        default_build_path=".",
        default_output_path="dist",
    )


@pytest.fixture
def mock_jenkins_provider():
    """模拟 JenkinsProvider"""
    class MockProvider:
        def __init__(self):
            self.build_number = None
            self.status = "running"
            self.artifacts = []
            self.upserted_job = None
            self.synced_credential = None

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

        def create_or_update_username_password_credential(self, **kwargs):
            self.synced_credential = kwargs

        def create_or_update_pipeline_job(self, job_name, pipeline_script):
            self.upserted_job = {"job_name": job_name, "pipeline_script": pipeline_script}

        def job_exists(self, job_name):
            return self.upserted_job is not None

    return MockProvider()
