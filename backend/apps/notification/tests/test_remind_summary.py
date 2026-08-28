"""
强提醒聚合接口测试

覆盖 GET /api/notifications/remind-summary/：
我的待审批任务（严格待办口径，超管不放开）与我的待整改意见。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.project.models import Project
from apps.release.models import ReleaseRecord, ReleaseReviewIssue
from apps.repository.models import Repository
from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask


@pytest.fixture
def user(db):
    """测试用户"""
    return User.objects.create_user(username="reminduser", password="testpass", nickname="提醒用户")


@pytest.fixture
def other_user(db):
    """另一个测试用户"""
    return User.objects.create_user(username="remindother", password="testpass", nickname="其他用户")


@pytest.fixture
def api_client(user):
    """已认证客户端"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def project(user):
    """测试项目"""
    return Project.objects.create(
        code="REMIND",
        name="强提醒测试项目",
        leader=user,
        status=1,
        version_rule={"prefix": "V", "major": 1, "minor": 0, "patch": 0},
        release_rule={"release_cycle_days": 3},
    )


@pytest.fixture
def repository(project):
    """测试仓库"""
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="后端仓库",
        url="https://gitlab.example.com/remind/backend.git",
        external_identity="remind/backend",
        default_branch="main",
    )


@pytest.fixture
def release(project, repository, user):
    """user 发布的发布记录"""
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="V1.0.0",
        tag_name="V1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        publisher=user,
    )


@pytest.fixture
def definition(project, user):
    """测试流程定义"""
    return WorkflowDefinition.objects.create(
        project=project,
        name="发布审批流程",
        biz_type="release",
        node_config=[
            {"node_id": "approval_1", "node_name": "负责人审批", "mode": "any", "approvers": []},
        ],
        graph_data={"nodes": [], "edges": []},
        is_active=True,
        created_by=user,
    )


def _make_instance(definition, user, biz_id):
    """创建流程实例"""
    return WorkflowInstance.objects.create(
        definition=definition,
        biz_type="release",
        biz_id=str(biz_id),
        status="running",
        current_node_id="approval_1",
        node_status={"approval_1": "running"},
        graph_data={"nodes": [], "edges": []},
        created_by=user,
    )


def _make_task(instance, approver, status="pending"):
    """创建审批任务"""
    return WorkflowTask.objects.create(
        instance=instance,
        node_id="approval_1",
        node_name="负责人审批",
        approver=approver,
        status=status,
    )


REMIND_URL = "/api/notifications/remind-summary/"


@pytest.mark.django_db
class TestRemindSummary:
    """强提醒聚合接口"""

    def test_empty_when_no_todo(self, api_client):
        """无待办时返回全 0"""
        response = api_client.get(REMIND_URL)
        assert response.status_code == 200
        data = response.json()["data"]
        assert data["todo_task_count"] == 0
        assert data["todo_tasks"] == []
        assert data["open_issue_count"] == 0
        assert data["open_issues"] == []

    def test_counts_my_pending_tasks(self, api_client, user, definition, release):
        """统计我的 pending 审批任务并返回展示字段"""
        instance = _make_instance(definition, user, release.id)
        task = _make_task(instance, user)
        response = api_client.get(REMIND_URL)
        data = response.json()["data"]
        assert data["todo_task_count"] == 1
        item = data["todo_tasks"][0]
        assert item["id"] == str(task.id)
        assert item["title"] == f"审批发布 {release.version}"
        assert item["version"] == release.version
        assert item["project_name"] == release.project.name

    def test_excludes_others_and_non_pending(self, api_client, user, other_user, definition, release):
        """他人任务与已处理任务不计入"""
        instance = _make_instance(definition, user, release.id)
        _make_task(instance, other_user)  # 他人待办
        _make_task(instance, user, status="approved")  # 我的已办
        response = api_client.get(REMIND_URL)
        data = response.json()["data"]
        assert data["todo_task_count"] == 0
        assert data["todo_tasks"] == []

    def test_superuser_only_sees_own_tasks(self, user, other_user, definition, release):
        """超管同样只统计 approver=自己 的任务（不放开全量）"""
        user.is_superuser = True
        user.save()
        instance = _make_instance(definition, user, release.id)
        _make_task(instance, other_user)
        client = APIClient()
        client.force_authenticate(user=user)
        response = client.get(REMIND_URL)
        data = response.json()["data"]
        assert data["todo_task_count"] == 0

    def test_counts_my_open_issues(self, api_client, user, release):
        """统计我发布的 open 整改意见"""
        issue = ReleaseReviewIssue.objects.create(
            release=release, author=None, content="发布说明缺少回滚方案", status="open"
        )
        response = api_client.get(REMIND_URL)
        data = response.json()["data"]
        assert data["open_issue_count"] == 1
        item = data["open_issues"][0]
        assert item["id"] == str(issue.id)
        assert item["release_id"] == str(release.id)
        assert item["version"] == release.version
        assert "回滚方案" in item["content"]

    def test_excludes_non_open_and_others_issues(
        self, api_client, user, other_user, project, repository, release
    ):
        """replied/resolved 与他人发布的 issue 不计入"""
        ReleaseReviewIssue.objects.create(release=release, content="待复核", status="replied")
        ReleaseReviewIssue.objects.create(release=release, content="已通过", status="resolved")
        other_release = ReleaseRecord.objects.create(
            project=project,
            repository=repository,
            version="V1.0.1",
            tag_name="V1.0.1",
            branch="main",
            release_type="formal",
            status="released",
            publisher=other_user,
        )
        ReleaseReviewIssue.objects.create(release=other_release, content="他人的待整改", status="open")
        response = api_client.get(REMIND_URL)
        data = response.json()["data"]
        assert data["open_issue_count"] == 0
        assert data["open_issues"] == []

    def test_limits_items_to_five(self, api_client, user, definition, release):
        """条目最多返回 5 条，count 为总数"""
        for _ in range(7):
            instance = _make_instance(definition, user, release.id)
            _make_task(instance, user)
        response = api_client.get(REMIND_URL)
        data = response.json()["data"]
        assert data["todo_task_count"] == 7
        assert len(data["todo_tasks"]) == 5


    def test_task_without_release_falls_back(self, api_client, user, definition, project):
        """biz_id 对应发布不存在时退化为节点名 + 定义所属项目名"""
        instance = _make_instance(definition, user, "00000000-0000-0000-0000-0000000000ff")
        task = _make_task(instance, user)
        response = api_client.get(REMIND_URL)
        data = response.json()["data"]
        assert data["todo_task_count"] == 1
        item = data["todo_tasks"][0]
        assert item["id"] == str(task.id)
        assert item["title"] == task.node_name
        assert item["version"] == ""
        assert item["project_name"] == project.name
