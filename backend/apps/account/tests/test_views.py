"""
账号模块视图测试

覆盖本地用户登录、密码错误场景以及已认证用户信息获取。
"""
import pytest
from rest_framework.test import APIClient
from apps.account.models import User


@pytest.mark.django_db
def test_local_user_login():
    """
    测试本地用户登录成功并返回 JWT Token

    期望：HTTP 200，响应 code 为 0，data 中包含 access_token
    """
    user = User.objects.create_user(
        username="testuser",
        password="testpass123",
        source="local",
        is_active=True,
    )
    client = APIClient()
    response = client.post("/api/auth/login/", {
        "username": "testuser",
        "password": "testpass123",
    })
    assert response.status_code == 200
    assert response.data["code"] == 0
    assert "access_token" in response.data["data"]


@pytest.mark.django_db
def test_login_wrong_password():
    """
    测试使用错误密码登录失败

    期望：HTTP 401，响应 code 为 40100
    """
    User.objects.create_user(
        username="testuser",
        password="testpass123",
        source="local",
        is_active=True,
    )
    client = APIClient()
    response = client.post("/api/auth/login/", {
        "username": "testuser",
        "password": "wrongpass",
    })
    assert response.status_code == 401
    assert response.data["code"] == 40100


@pytest.mark.django_db
def test_user_info():
    """
    测试获取当前登录用户信息

    期望：HTTP 200，返回的用户名与登录用户一致
    """
    user = User.objects.create_user(
        username="testuser",
        password="testpass123",
        source="local",
        is_active=True,
    )
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/auth/user-info/")
    assert response.status_code == 200
    assert response.data["data"]["username"] == "testuser"
