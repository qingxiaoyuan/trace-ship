import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from apps.account.models import User


@pytest.mark.django_db
def test_local_user_login():
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
