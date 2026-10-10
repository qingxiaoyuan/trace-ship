"""通过发布 API 验证正式草稿的 RC 来源身份。"""

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord
from utils.provider.base import TagInfo

pytestmark = pytest.mark.django_db
SHA = "a" * 40


@pytest.fixture
def client(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def remote(monkeypatch, mock_git_provider):
    # 仅替换 GitLab 外部边界，保留真实凭证/权限解析。
    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: mock_git_provider)
    return mock_git_provider


@pytest.fixture
def rc(project, repository, user, remote):
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=user,
        release_type="rc", status="released", branch="develop",
        version="VA.9.0.0", tag_name="VA.9.0.0-rc", git_hash=SHA,
        released_at=timezone.now(),
    )
    remote.tags = [TagInfo(name=release.tag_name, commit_hash=SHA)]
    return release


def test_formal_draft_uses_rc_snapshot_instead_of_branch_head(client, rc):
    response = client.post("/api/releases/", {
        "project": str(rc.project_id), "repository": str(rc.repository_id),
        "release_type": "formal", "source_rc": str(rc.id),
        "branch": "forged", "git_hash": "b" * 40,
    }, format="json")
    assert response.status_code == 201, response.data
    release = client.get(f"/api/releases/{response.data['data']['id']}/").data["data"]
    assert release["branch"] == "develop"
    assert release["git_hash"] == SHA
    assert release["source_rc"] == str(rc.id)
    assert release["source_rc_version"] == "VA.9.0.0"
    assert release["source_rc_tag"] == "VA.9.0.0-rc"
    assert release["source_rc_git_hash"] == SHA
    assert release["version"] == "VA.1.0.0"


def test_draft_reselection_clears_old_changes_and_plain_edit_keeps_sha(client, rc, remote):
    draft = client.post("/api/releases/", {
        "project": str(rc.project_id), "repository": str(rc.repository_id),
        "release_type": "formal", "source_rc": str(rc.id),
        "updates": [{"type": "A", "content": "旧来源内容"}],
    }, format="json").data["data"]
    url = f"/api/releases/{draft['id']}/"
    assert client.patch(url, {"branch": "moved"}, format="json").status_code == 200
    assert client.get(url).data["data"]["git_hash"] == SHA
    replacement = ReleaseRecord.objects.create(
        project=rc.project, repository=rc.repository, publisher=rc.publisher,
        release_type="rc", status="released", version="VA.9.0.1",
        tag_name="VA.9.0.1-rc", branch="test", git_hash="b" * 40,
    )
    remote.tags.append(TagInfo(name=replacement.tag_name, commit_hash=replacement.git_hash))
    result = client.patch(url, {"source_rc": str(replacement.id)}, format="json")
    assert result.status_code == 200, result.data
    data = client.get(url).data["data"]
    assert data["git_hash"] == "b" * 40
    assert data["branch"] == "test"
    assert data["updates"] == []
    assert data["release_doc"] == ""


def test_candidates_show_remote_availability_and_support_paging(client, rc, remote):
    params = {"project": str(rc.project_id), "repository": str(rc.repository_id), "page_size": 1}
    response = client.get("/api/releases/rc-candidates/", params)
    assert response.status_code == 200, response.data
    data = response.data["data"]
    assert data["total"] == 1
    assert data["results"][0]["available"] is True
    assert data["results"][0]["git_hash"] == SHA
    remote.tags = []
    unavailable = client.get("/api/releases/rc-candidates/", params).data["data"]["results"][0]
    assert unavailable["available"] is False
    assert "不存在" in unavailable["unavailable_reason"]
    assert client.get("/api/releases/rc-candidates/", {**params, "search": "no-match"}).data["data"]["total"] == 0


def test_referenced_rc_cannot_be_deleted(client, rc, remote):
    draft = client.post("/api/releases/", {
        "project": str(rc.project_id), "repository": str(rc.repository_id),
        "release_type": "formal", "source_rc": str(rc.id),
    }, format="json")
    assert draft.status_code == 201
    response = client.post(f"/api/releases/{rc.id}/delete-released/", {"tag_name": rc.tag_name}, format="json")
    assert response.status_code == 400, response.data
    assert "引用" in response.data["message"]
    assert client.get(f"/api/releases/{rc.id}/").status_code == 200
    assert remote.tags[0].name == rc.tag_name


@pytest.mark.parametrize("invalid", ["missing", "beta", "draft", "other_project", "other_repository", "tag_missing", "tag_changed", "short_hash"])
def test_invalid_source_is_rejected(client, rc, remote, invalid):
    from apps.project.models import Project
    from apps.repository.models import Repository

    source_id = str(rc.id)
    if invalid == "missing":
        source_id = None
    elif invalid == "beta":
        rc.release_type = "beta"
    elif invalid == "draft":
        rc.status = "draft"
    elif invalid == "other_project":
        rc.project = Project.objects.create(code="OTHER", name="不可见项目", leader=rc.publisher)
    elif invalid == "other_repository":
        rc.repository = Repository.objects.create(name="其他仓库", url="https://gitlab.example.com/other.git", external_identity="other", vendor="gitlab")
    elif invalid == "tag_missing":
        remote.tags = []
    elif invalid == "tag_changed":
        remote.tags = [TagInfo(name=rc.tag_name, commit_hash="c" * 40)]
    elif invalid == "short_hash":
        rc.git_hash = "a" * 7
    original = ReleaseRecord.objects.get(pk=rc.pk)
    rc.save()
    response = client.post("/api/releases/", {
        "project": str(original.project_id), "repository": str(original.repository_id),
        "release_type": "formal", "source_rc": source_id,
    }, format="json")
    assert response.status_code == 400, response.data


def test_pending_source_is_immutable_and_rc_creation_stays_branch_based(client, rc):
    formal = ReleaseRecord.objects.create(
        project=rc.project, repository=rc.repository, publisher=rc.publisher,
        release_type="formal", status="pending", version="VA.1.0.0", branch="develop",
        source_rc=rc, source_rc_git_hash=SHA, git_hash=SHA,
    )
    result = client.patch(f"/api/releases/{formal.id}/", {"source_rc": None}, format="json")
    assert result.status_code == 400
    assert client.get(f"/api/releases/{formal.id}/").data["data"]["source_rc"] == str(rc.id)
    payload = {"project": str(rc.project_id), "repository": str(rc.repository_id), "release_type": "rc", "branch": "develop"}
    denied = client.post("/api/releases/", {**payload, "source_rc": str(rc.id)}, format="json")
    assert denied.status_code == 400
    created = client.post("/api/releases/", payload, format="json")
    assert created.status_code == 201, created.data
    assert created.data["data"]["git_hash"] == "targethead001"
    assert created.data["data"]["source_rc"] is None


@pytest.mark.parametrize("blocked", ["inactive_project", "inactive_component", "owner_left", "outsider"])
def test_source_context_checks_are_applied_to_candidates_and_create(client, rc, blocked):
    from apps.account.models import User
    from apps.project.models import ProjectMember

    if blocked == "inactive_project":
        rc.project.status = 0
        rc.project.save()
    elif blocked == "inactive_component":
        rc.project.project_components.update(is_active=False)
    elif blocked == "owner_left":
        other = User.objects.create_user(username="developer")
        ProjectMember.objects.create(project=rc.project, user=other, role="developer")
        ProjectMember.objects.filter(project=rc.project, user=rc.publisher).delete()
        client.force_authenticate(other)
    else:
        client.force_authenticate(User.objects.create_user(username="outsider"))
    params = {"project": str(rc.project_id), "repository": str(rc.repository_id)}
    assert client.get("/api/releases/rc-candidates/", params).status_code in (400, 403, 404)
    result = client.post("/api/releases/", {**params, "release_type": "formal", "source_rc": str(rc.id)}, format="json")
    assert result.status_code in (400, 403, 404)


def test_invalid_page_preserves_standard_pagination_error(client, rc):
    result = client.get("/api/releases/rc-candidates/", {
        "project": str(rc.project_id), "repository": str(rc.repository_id), "page": 999,
    })
    assert result.status_code == 404


@pytest.mark.django_db(transaction=True)
def test_reselection_and_submission_serialize_on_postgresql(client, rc, remote, monkeypatch):
    """真实事务中重选先持锁，审批必须读到清空后的说明，不能审批旧快照。"""
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, current_thread

    from django.db import close_old_connections, connection

    from apps.workflow.models import WorkflowDefinition

    if connection.vendor != "postgresql":
        pytest.skip("来源并发保护需要 PostgreSQL 行锁")
    formal = ReleaseRecord.objects.create(
        project=rc.project, repository=rc.repository, publisher=rc.publisher,
        release_type="formal", status="draft", version="VA.1.0.0", branch=rc.branch,
        source_rc=rc, source_rc_git_hash=SHA, git_hash=SHA, release_doc="旧来源说明",
    )
    replacement = ReleaseRecord.objects.create(
        project=rc.project, repository=rc.repository, publisher=rc.publisher,
        release_type="rc", status="released", version="VA.9.0.1",
        tag_name="VA.9.0.1-rc", branch="test", git_hash="b" * 40,
    )
    remote.tags.append(TagInfo(name=replacement.tag_name, commit_hash=replacement.git_hash))
    WorkflowDefinition.objects.create(
        repository=rc.repository, project=rc.project, name="正式审批", biz_type="release",
        release_type="formal", is_active=True,
        node_config=[{"node_id": "approval", "node_name": "测试确认", "mode": "any", "approvers": [{"type": "leader"}]}],
    )
    checking_source, resume, submit_started, submit_completed = Event(), Event(), Event(), Event()
    original_list_tags = remote.list_tags

    def paused_tag_lookup(identity):
        if current_thread().name.startswith("reselect"):
            checking_source.set()
            assert resume.wait(10), "未恢复来源校验"
        return original_list_tags(identity)

    monkeypatch.setattr(remote, "list_tags", paused_tag_lookup)

    def call_api(reselect):
        close_old_connections()
        api = APIClient()
        api.force_authenticate(rc.publisher)
        try:
            if reselect:
                return api.patch(f"/api/releases/{formal.id}/", {"source_rc": str(replacement.id)}, format="json")
            submit_started.set()
            return api.post(f"/api/releases/{formal.id}/submit-audit/", {}, format="json")
        finally:
            if not reselect:
                submit_completed.set()
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="reselect") as selecting, ThreadPoolExecutor(max_workers=1) as submitting:
        changed = selecting.submit(call_api, True)
        try:
            assert checking_source.wait(10)
            submitted = submitting.submit(call_api, False)
            assert submit_started.wait(10)
            assert not submit_completed.wait(1), "审批未等待重选事务释放来源锁"
        finally:
            resume.set()
        assert changed.result(timeout=10).status_code == 200
        result = submitted.result(timeout=10)
    assert result.status_code == 400, result.data
    assert "发布说明为空" in result.data["message"]
    data = client.get(f"/api/releases/{formal.id}/").data["data"]
    assert data["status"] == "draft"
    assert data["source_rc_git_hash"] == "b" * 40


def test_cleaned_rc_remains_candidate_with_verified_formal_reference(client, rc, remote):
    ReleaseRecord.objects.create(project=rc.project, repository=rc.repository, publisher=rc.publisher,
        release_type='formal', status='released', version='VA.1.0.0', tag_name='VA.1.0.0',
        git_hash=rc.git_hash, source_rc=rc, source_rc_git_hash=rc.git_hash)
    remote.tags = [TagInfo(name='VA.1.0.0', commit_hash=rc.git_hash)]
    response = client.get('/api/releases/rc-candidates/', {'project': str(rc.project_id), 'repository': str(rc.repository_id)})
    assert response.data['data']['results'][0]['available'] is True
