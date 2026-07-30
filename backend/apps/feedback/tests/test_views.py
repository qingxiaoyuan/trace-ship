"""
使用反馈模块视图测试

覆盖反馈提交、列表可见性、点赞切换与删除权限。
"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.feedback.models import Feedback


def _make_user(username: str, **kwargs) -> User:
    """创建测试用户"""
    return User.objects.create_user(
        username=username,
        password="testpass123",
        source="local",
        is_active=True,
        **kwargs,
    )


@pytest.mark.django_db
def test_create_feedback():
    """
    测试登录用户提交反馈

    期望：HTTP 200，响应 code 为 0，提交人为当前用户
    """
    user = _make_user("fb_user1")
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.post("/api/feedback/", {
        "title": "建议支持暗黑模式",
        "content": "希望平台支持暗黑主题切换。",
        "category": "suggestion",
    })
    assert response.status_code == 200
    assert response.data["code"] == 0
    feedback = Feedback.objects.get(title="建议支持暗黑模式")
    assert feedback.created_by == user
    assert feedback.category == "suggestion"


@pytest.mark.django_db
def test_create_feedback_requires_login():
    """
    测试未登录用户无法提交反馈

    期望：HTTP 401
    """
    client = APIClient()
    response = client.post("/api/feedback/", {
        "title": "匿名反馈",
        "content": "内容",
        "category": "other",
    })
    assert response.status_code == 401


@pytest.mark.django_db
def test_list_feedback_visible_to_all_users():
    """
    测试其他用户可以看到他人提交的反馈

    期望：HTTP 200，列表中包含他人反馈，且包含提交人显示名与点赞字段
    """
    author = _make_user("fb_author")
    viewer = _make_user("fb_viewer")
    Feedback.objects.create(
        title="打包日志加载慢",
        content="大日志页面卡顿。",
        category="bug",
        created_by=author,
    )
    client = APIClient()
    client.force_authenticate(user=viewer)
    response = client.get("/api/feedback/")
    assert response.status_code == 200
    results = response.data["data"]["results"]
    assert len(results) == 1
    assert results[0]["title"] == "打包日志加载慢"
    assert results[0]["created_by_name"]
    assert results[0]["like_count"] == 0
    assert results[0]["liked"] is False


@pytest.mark.django_db
def test_like_toggle():
    """
    测试点赞切换接口

    期望：首次调用点赞成功，再次调用取消点赞
    """
    author = _make_user("fb_like_author")
    user = _make_user("fb_like_user")
    feedback = Feedback.objects.create(
        title="体验优化建议",
        content="内容",
        category="experience",
        created_by=author,
    )
    client = APIClient()
    client.force_authenticate(user=user)

    response = client.post(f"/api/feedback/{feedback.id}/like/")
    assert response.status_code == 200
    assert response.data["data"]["liked"] is True
    assert response.data["data"]["like_count"] == 1

    response = client.post(f"/api/feedback/{feedback.id}/like/")
    assert response.status_code == 200
    assert response.data["data"]["liked"] is False
    assert response.data["data"]["like_count"] == 0


@pytest.mark.django_db
def test_delete_only_owner_or_superuser():
    """
    测试删除权限：他人不可删除，本人与超管可删除

    期望：他人删除返回 40301，本人删除成功；超管可删除任意反馈
    """
    author = _make_user("fb_del_author")
    other = _make_user("fb_del_other")
    admin = _make_user("fb_del_admin", is_superuser=True)
    feedback = Feedback.objects.create(
        title="待删除反馈",
        content="内容",
        category="other",
        created_by=author,
    )

    client = APIClient()
    client.force_authenticate(user=other)
    response = client.delete(f"/api/feedback/{feedback.id}/")
    assert response.status_code == 400
    assert response.data["code"] == 40301
    assert Feedback.objects.filter(id=feedback.id).exists()

    client.force_authenticate(user=admin)
    response = client.delete(f"/api/feedback/{feedback.id}/")
    assert response.status_code == 200
    assert response.data["code"] == 0
    assert not Feedback.objects.filter(id=feedback.id).exists()


@pytest.mark.django_db
def test_filter_by_category():
    """
    测试按分类筛选反馈

    期望：仅返回指定分类的反馈
    """
    user = _make_user("fb_filter_user")
    Feedback.objects.create(title="建议一", content="内容", category="suggestion", created_by=user)
    Feedback.objects.create(title="问题一", content="内容", category="bug", created_by=user)
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/feedback/", {"category": "bug"})
    assert response.status_code == 200
    results = response.data["data"]["results"]
    assert len(results) == 1
    assert results[0]["category"] == "bug"


@pytest.mark.django_db
def test_process_feedback_only_superuser():
    """
    测试标记已处理权限：普通用户不可操作，超管可标记并记录处理人

    期望：普通用户返回 40301；超管标记成功后状态、处理人、处理时间落库
    """
    author = _make_user("fb_proc_author")
    admin = _make_user("fb_proc_admin", is_superuser=True)
    feedback = Feedback.objects.create(
        title="待处理反馈",
        content="内容",
        category="bug",
        created_by=author,
    )

    client = APIClient()
    client.force_authenticate(user=author)
    response = client.post(f"/api/feedback/{feedback.id}/process/")
    assert response.status_code == 400
    assert response.data["code"] == 40301

    client.force_authenticate(user=admin)
    response = client.post(f"/api/feedback/{feedback.id}/process/")
    assert response.status_code == 200
    assert response.data["code"] == 0
    feedback.refresh_from_db()
    assert feedback.status == "processed"
    assert feedback.processed_by == admin
    assert feedback.processed_at is not None


@pytest.mark.django_db
def test_process_feedback_already_processed():
    """
    测试重复标记已处理返回业务错误

    期望：HTTP 400，code 为 40001
    """
    admin = _make_user("fb_proc_admin2", is_superuser=True)
    feedback = Feedback.objects.create(
        title="已处理反馈",
        content="内容",
        category="other",
        created_by=admin,
        status="processed",
    )
    client = APIClient()
    client.force_authenticate(user=admin)
    response = client.post(f"/api/feedback/{feedback.id}/process/")
    assert response.status_code == 400
    assert response.data["code"] == 40001
