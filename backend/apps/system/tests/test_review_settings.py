"""审查配置的权限、密钥及版本快照行为。"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User


@pytest.mark.django_db
def test_review_settings_save_keeps_prior_version_and_secret_private():
    admin = User.objects.create_superuser(username="review-admin", password="testpass")
    client = APIClient()
    client.force_authenticate(user=admin)
    endpoint = "/api/system/review-settings/"

    initial = client.get(endpoint)
    assert initial.status_code == 200
    assert initial.data["data"]["skill"]["name"] == "code-review-expert"
    response = client.put(endpoint, {
        "endpoint": "https://model.example/v1", "model": "review-model",
        "protocol": "openai", "api_key": "private-review-key",
        "skill": "code-review-expert",
    }, format="json")
    assert response.status_code == 200
    first = response.data["data"]
    assert first["model"] == "review-model"
    assert first["has_api_key"] is True
    assert "private-review-key" not in str(response.data)

    response = client.put(endpoint, {
        "endpoint": "https://other.example/v1", "model": "new-model",
        "protocol": "anthropic", "skill": "code-review-expert",
    }, format="json")
    assert response.status_code == 200
    assert response.data["data"]["version_id"] != first["version_id"]
    assert response.data["data"]["has_api_key"] is True

    from apps.system.models import ReviewSettingsVersion
    first_version = ReviewSettingsVersion.objects.get(pk=first["version_id"])
    assert first_version.model == "review-model"
    assert first_version.skill_documents["SKILL.md"]
    assert len(first_version.skill_documents) == 7
    assert "private-review-key" not in first_version.encrypted_api_key
    assert client.get(endpoint).data["data"]["model"] == "new-model"
    from apps.system.models import SystemConfig
    SystemConfig.objects.create(key="ai_model", value="packaging-model")
    assert client.get(endpoint).data["data"]["model"] == "new-model"
    assert SystemConfig.objects.get(key="ai_model").value == "packaging-model"
    response = client.put(endpoint, {
        "endpoint": "https://other.example/v1", "model": "new-model",
        "protocol": "auto", "api_key": "", "skill": "code-review-expert",
    }, format="json")
    assert response.data["data"]["has_api_key"] is False
    assert first_version.encrypted_api_key


@pytest.mark.django_db
def test_review_settings_rejects_unauthorized_reads_and_writes():
    user = User.objects.create_user(username="review-user", password="testpass")
    client = APIClient()
    client.force_authenticate(user=user)
    assert client.get("/api/system/review-settings/").status_code == 403
    assert client.put("/api/system/review-settings/", {}, format="json").status_code == 403


@pytest.mark.django_db
def test_review_model_address_cannot_contain_credentials():
    admin = User.objects.create_superuser(username="review-url-admin", password="testpass")
    client = APIClient()
    client.force_authenticate(user=admin)
    response = client.put("/api/system/review-settings/", {
        "endpoint": "https://user:secret@model.example/v1", "model": "model",
        "protocol": "openai", "skill": "code-review-expert",
    }, format="json")
    assert response.status_code == 400
