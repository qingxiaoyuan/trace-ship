"""
发布文档审查整改闭环接口测试

覆盖：审查员发起整改意见、发布人回复、审查员通过/驳回、多轮整改、通知触发、
聚合计数与基线 tag 持久化。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import Permission, Role, RolePermission, UserRole
from apps.notification.models import Notification
from apps.project.models import ProjectMember
from apps.release.models import ReleaseRecord, ReleaseReviewIssue
from utils.provider.base import TagInfo

pytestmark = pytest.mark.django_db


@pytest.fixture
def reviewer():
    """拥有 release.audit 权限的系统审查员用户"""
    from apps.account.models import User

    user = User.objects.create_user(
        username="reviewer", password="testpass", nickname="审查员"
    )
    perm, _ = Permission.objects.get_or_create(
        code="release.audit", defaults={"name": "审批发布", "module": "release"}
    )
    role, _ = Role.objects.get_or_create(code="auditor", defaults={"name": "审核人"})
    RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role)
    return user


@pytest.fixture
def publisher_client(user):
    """发布人测试客户端（user 为项目负责人/manager）"""
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def reviewer_client(reviewer, project):
    """审查员测试客户端；审查员需先加入产品才具备数据可见性。"""
    ProjectMember.objects.get_or_create(
        project=project,
        user=reviewer,
        defaults={"role": "auditor"},
    )
    client = APIClient()
    client.force_authenticate(user=reviewer)
    return client


@pytest.fixture
def patched_provider(monkeypatch, mock_git_provider):
    """将 release 服务中的 Provider 替换为模拟对象（generate-doc 等场景）"""
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


@pytest.fixture
def released_release(project, repository, user):
    """已发布的发布记录"""
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        publisher=user,
    )


def _review_notifications(user) -> list[Notification]:
    return list(Notification.objects.filter(user=user, notification_type="review").order_by("created_at"))


class TestCreateIssue:
    def test_rejects_non_released(self, reviewer_client, project, repository, user):
        """非已发布状态不能发起整改"""
        draft = ReleaseRecord.objects.create(
            project=project, repository=repository, version="VA.1.1.0",
            tag_name="VA.1.1.0", branch="main", release_type="formal",
            status="draft", publisher=user,
        )
        resp = reviewer_client.post(
            f"/api/releases/{draft.id}/review-issues/",
            {"content": "文档缺少版本说明"},
            format="json",
        )
        assert resp.status_code == 400
        assert resp.data["code"] == 40002

    def test_rejects_non_reviewer(self, publisher_client, released_release):
        """普通开发人员不能发起整改"""
        resp = publisher_client.post(
            f"/api/releases/{released_release.id}/review-issues/",
            {"content": "文档缺少版本说明"},
            format="json",
        )
        assert resp.status_code == 400
        assert resp.data["code"] == 40002

    def test_rejects_empty_content(self, reviewer_client, released_release):
        """空内容不能发起整改"""
        resp = reviewer_client.post(
            f"/api/releases/{released_release.id}/review-issues/",
            {"content": "   "},
            format="json",
        )
        assert resp.status_code == 400
        assert resp.data["code"] == 40002

    def test_create_success_notifies_publisher(self, reviewer_client, publisher_client, released_release):
        """审查员发起整改成功，且通知发布人"""
        resp = reviewer_client.post(
            f"/api/releases/{released_release.id}/review-issues/",
            {"content": "发布说明缺少环境要求描述"},
            format="json",
        )
        assert resp.status_code == 201
        assert resp.data["code"] == 0
        issue_id = resp.data["data"]["id"]
        issue = ReleaseReviewIssue.objects.get(id=issue_id)
        assert issue.status == "open"
        assert issue.author_id
        # 通知发布人
        notifications = _review_notifications(released_release.publisher)
        assert len(notifications) == 1
        assert "整改意见" in notifications[0].title


class TestReplyIssue:
    def test_rejects_non_publisher(self, reviewer_client, released_release):
        """非发布人不能回复（审查员自己也回复不了）"""
        issue = ReleaseReviewIssue.objects.create(
            release=released_release, author=reviewer_client.handler._force_user,
            content="请补充", status="open",
        )
        resp = reviewer_client.post(
            f"/api/releases/{released_release.id}/review-issues/{issue.id}/reply/",
            {"content": "已修改"},
            format="json",
        )
        assert resp.status_code == 400
        assert resp.data["code"] == 40002

    def test_reply_success_moves_to_replied_and_notifies_reviewer(
        self, reviewer_client, publisher_client, released_release
    ):
        """发布人回复后状态 open->replied，且通知审查员"""
        issue = ReleaseReviewIssue.objects.create(
            release=released_release, author=reviewer_client.handler._force_user,
            content="请补充环境要求", status="open",
        )
        resp = publisher_client.post(
            f"/api/releases/{released_release.id}/review-issues/{issue.id}/reply/",
            {"content": "已补充环境要求说明"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["data"]["status"] == "replied"
        issue.refresh_from_db()
        assert issue.status == "replied"
        assert issue.replies.count() == 1
        # 通知审查员
        notifications = _review_notifications(reviewer_client.handler._force_user)
        assert len(notifications) == 1
        assert "已回复" in notifications[0].title

    def test_reply_rejected_when_not_open(self, reviewer_client, publisher_client, released_release):
        """待复核（replied）状态下发布人不能再回复"""
        issue = ReleaseReviewIssue.objects.create(
            release=released_release, author=reviewer_client.handler._force_user,
            content="请补充", status="replied",
        )
        resp = publisher_client.post(
            f"/api/releases/{released_release.id}/review-issues/{issue.id}/reply/",
            {"content": "再次回复"},
            format="json",
        )
        assert resp.status_code == 400
        assert resp.data["code"] == 40002


class TestJudgeIssue:
    def _make_replied_issue(self, reviewer_client, released_release):
        reviewer = reviewer_client.handler._force_user
        issue = ReleaseReviewIssue.objects.create(
            release=released_release, author=reviewer,
            content="请补充环境要求", status="replied",
        )
        return issue

    def test_resolve_rejects_non_author(self, reviewer_client, publisher_client, released_release):
        """非意见发起人（发布人）不能判定通过"""
        issue = self._make_replied_issue(reviewer_client, released_release)
        resp = publisher_client.post(
            f"/api/releases/{released_release.id}/review-issues/{issue.id}/resolve/",
            {},
            format="json",
        )
        assert resp.status_code == 400
        assert resp.data["code"] == 40002

    def test_resolve_success(self, reviewer_client, publisher_client, released_release):
        """审查员通过：replied->resolved，通知发布人"""
        issue = self._make_replied_issue(reviewer_client, released_release)
        resp = reviewer_client.post(
            f"/api/releases/{released_release.id}/review-issues/{issue.id}/resolve/",
            {},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["data"]["status"] == "resolved"
        issue.refresh_from_db()
        assert issue.status == "resolved"
        assert issue.resolved_at is not None
        notifications = _review_notifications(released_release.publisher)
        assert len(notifications) == 1
        assert "已通过" in notifications[0].title

    def test_reject_reopens_and_allows_multiple_rounds(
        self, reviewer_client, publisher_client, released_release
    ):
        """驳回后回到 open，发布人可再次回复，再通过即完成"""
        reviewer = reviewer_client.handler._force_user
        issue = ReleaseReviewIssue.objects.create(
            release=released_release, author=reviewer,
            content="请补充环境要求", status="open",
        )
        # 第一轮回复
        resp = publisher_client.post(
            f"/api/releases/{released_release.id}/review-issues/{issue.id}/reply/",
            {"content": "已补充"}, format="json",
        )
        assert resp.status_code == 200, resp.data
        issue.refresh_from_db()
        assert issue.status == "replied"
        # 审查员驳回（带备注）
        resp = reviewer_client.post(
            f"/api/releases/{released_release.id}/review-issues/{issue.id}/reject/",
            {"comment": "环境要求描述不完整"}, format="json",
        )
        assert resp.status_code == 200
        issue.refresh_from_db()
        assert issue.status == "open"
        assert issue.replies.count() == 2  # 发布人回复 + 审查员驳回备注
        # 发布人再次回复
        resp = publisher_client.post(
            f"/api/releases/{released_release.id}/review-issues/{issue.id}/reply/",
            {"content": "已按备注补充完整"}, format="json",
        )
        assert resp.status_code == 200
        issue.refresh_from_db()
        assert issue.status == "replied"
        # 审查员通过
        resp = reviewer_client.post(
            f"/api/releases/{released_release.id}/review-issues/{issue.id}/resolve/",
            {}, format="json",
        )
        assert resp.status_code == 200
        issue.refresh_from_db()
        assert issue.status == "resolved"


class TestAggregateAndBaseTag:
    def test_release_detail_returns_counts_and_flags(
        self, reviewer_client, publisher_client, released_release
    ):
        """发布详情返回 review_issue_counts 与 can_review/can_reply 权限标记"""
        ReleaseReviewIssue.objects.create(
            release=released_release, author=reviewer_client.handler._force_user,
            content="意见1", status="open",
        )
        resp = publisher_client.get(f"/api/releases/{released_release.id}/")
        assert resp.status_code == 200
        data = resp.data["data"]
        assert data["review_issue_counts"]["total"] == 1
        assert data["review_issue_counts"]["open"] == 1
        assert data["can_review"] is False
        assert data["can_reply"] is True

        # 审查员视角 can_review=True
        resp2 = reviewer_client.get(f"/api/releases/{released_release.id}/")
        assert resp2.status_code == 200
        assert resp2.data["data"]["can_review"] is True

    def test_generate_doc_persists_base_tag(
        self, publisher_client, released_release, patched_provider
    ):
        """生成发布说明时持久化基线 tag 快照"""
        released_release.status = "draft"
        released_release.save(update_fields=["status"])
        patched_provider.tags = [
            TagInfo(name="VA.1.0.0", commit_hash="base0001"),
        ]
        resp = publisher_client.post(
            f"/api/releases/{released_release.id}/generate-doc/", {}, format="json"
        )
        assert resp.status_code == 200
        released_release.refresh_from_db()
        assert released_release.base_tag == "VA.1.0.0"

    def test_review_issues_list(
        self, reviewer_client, publisher_client, released_release
    ):
        """GET review-issues 返回意见及回复时间线"""
        issue = ReleaseReviewIssue.objects.create(
            release=released_release, author=reviewer_client.handler._force_user,
            content="请补充环境要求", status="replied",
        )
        from apps.release.models import ReleaseReviewReply

        ReleaseReviewReply.objects.create(
            issue=issue, author=released_release.publisher, content="已补充"
        )
        resp = reviewer_client.get(f"/api/releases/{released_release.id}/review-issues/")
        assert resp.status_code == 200
        data = resp.data["data"]
        assert len(data) == 1
        assert data[0]["replies"][0]["content"] == "已补充"
        assert data[0]["can_judge"] is True

    def test_release_list_returns_open_and_replied_counts(
        self, reviewer_client, publisher_client, released_release
    ):
        """发布列表注记待整改（open）与待复核（replied）意见数，两者可共存"""
        author = reviewer_client.handler._force_user
        ReleaseReviewIssue.objects.create(
            release=released_release, author=author, content="待整改意见", status="open",
        )
        ReleaseReviewIssue.objects.create(
            release=released_release, author=author, content="待复核意见", status="replied",
        )
        ReleaseReviewIssue.objects.create(
            release=released_release, author=author, content="已通过意见", status="resolved",
        )
        resp = publisher_client.get("/api/releases/")
        assert resp.status_code == 200
        row = next(r for r in resp.data["data"]["results"] if r["id"] == str(released_release.id))
        assert row["open_review_count"] == 1
        assert row["replied_review_count"] == 1


class TestReviewStatusFilter:
    """发布列表按整改意见状态（review_status）过滤"""

    @pytest.fixture
    def filter_releases(self, project, repository, user, reviewer):
        """三条已发布记录：待整改 / 待复核 / 无意见"""

        def make(version):
            return ReleaseRecord.objects.create(
                project=project, repository=repository, version=version,
                tag_name=version, branch="main", release_type="formal",
                status="released", publisher=user,
            )

        open_rel = make("VA.2.0.0")
        replied_rel = make("VA.2.1.0")
        clean_rel = make("VA.2.2.0")
        ReleaseReviewIssue.objects.create(
            release=open_rel, author=reviewer, content="待整改意见", status="open",
        )
        ReleaseReviewIssue.objects.create(
            release=replied_rel, author=reviewer, content="待复核意见", status="replied",
        )
        return {"open": open_rel, "replied": replied_rel, "clean": clean_rel}

    @staticmethod
    def _ids(resp):
        return {r["id"] for r in resp.data["data"]["results"]}

    def test_filter_open(self, publisher_client, filter_releases):
        """review_status=open 只返回有待整改意见的发布"""
        resp = publisher_client.get("/api/releases/?review_status=open")
        assert resp.status_code == 200
        assert self._ids(resp) == {str(filter_releases["open"].id)}

    def test_filter_replied(self, publisher_client, filter_releases):
        """review_status=replied 只返回有待复核意见的发布"""
        resp = publisher_client.get("/api/releases/?review_status=replied")
        assert resp.status_code == 200
        assert self._ids(resp) == {str(filter_releases["replied"].id)}

    def test_invalid_value_not_filtered(self, publisher_client, filter_releases):
        """非法值不过滤，返回全部"""
        resp = publisher_client.get("/api/releases/?review_status=resolved")
        assert resp.status_code == 200
        assert len(self._ids(resp)) == 3

    def test_multiple_issues_no_duplicate_rows(self, publisher_client, filter_releases, reviewer):
        """同一发布有多条待整改意见时结果不重复"""
        ReleaseReviewIssue.objects.create(
            release=filter_releases["open"], author=reviewer, content="第二条意见", status="open",
        )
        resp = publisher_client.get("/api/releases/?review_status=open")
        assert resp.status_code == 200
        assert len(resp.data["data"]["results"]) == 1


class TestInvalidIssueId:
    def test_reply_invalid_uuid_returns_404(self, reviewer_client, released_release):
        """非法 UUID 的意见 id 应返回 404 而非 500"""
        resp = reviewer_client.post(
            f"/api/releases/{released_release.id}/review-issues/not-a-uuid/reply/",
            {"content": "x"},
            format="json",
        )
        assert resp.status_code == 404
        assert resp.data["code"] == 40400

    def test_resolve_invalid_uuid_returns_404(self, reviewer_client, released_release):
        """非法 UUID 的通过操作应返回 404"""
        resp = reviewer_client.post(
            f"/api/releases/{released_release.id}/review-issues/not-a-uuid/resolve/",
            {},
            format="json",
        )
        assert resp.status_code == 404
