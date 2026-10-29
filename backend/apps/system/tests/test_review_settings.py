"""审查复用共享模型，技能与历史快照保持独立。"""
import pytest
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.account.models import User
from apps.system.models import ReviewSettingsVersion, SystemConfig
from apps.system.review_settings import capture_review_settings, save_settings, settings_response
from utils.crypto import decrypt_credential


def admin_client():
    admin = User.objects.create_superuser(username="review-admin", password="testpass")
    client = APIClient()
    client.force_authenticate(admin)
    return client


def set_model(**values):
    for key, value in values.items():
        SystemConfig.objects.update_or_create(key=f"ai_{key}", defaults={"value": value})


@pytest.mark.django_db
def test_review_reuses_shared_model_and_freezes_previous_version():
    client = admin_client()
    url = "/api/system/review-settings/"
    set_model(endpoint="https://model.example/v1", model="packaging-model", protocol="openai", api_key="private-shared-key")
    initial = client.get(url).data["data"]
    assert initial["model"] == "packaging-model" and initial["has_api_key"]
    assert initial["skill"]["name"] == "code-review-expert"
    assert "private-shared-key" not in str(initial)
    saved = client.put(url, {"skill": "code-review-expert"}, format="json")
    assert saved.status_code == 200
    first = capture_review_settings()
    assert first.model == "packaging-model"
    assert decrypt_credential(first.encrypted_api_key)["api_key"] == "private-shared-key"
    assert "private-shared-key" not in first.encrypted_api_key
    assert len(first.skill_documents) == 7
    set_model(endpoint="https://other.example/v1", model="next-model", protocol="anthropic", api_key="new-secret")
    assert client.get(url).data["data"]["model"] == "next-model"
    second = capture_review_settings()
    assert second.id != first.id and second.model == "next-model" and second.protocol == "anthropic"
    first.refresh_from_db()
    assert first.model == "packaging-model"
    assert decrypt_credential(first.encrypted_api_key)["api_key"] == "private-shared-key"
    assert second.skill_documents == first.skill_documents
    set_model(api_key="")
    assert not capture_review_settings().encrypted_api_key
    assert not client.get(url).data["data"]["has_api_key"]


@pytest.mark.django_db
def test_shared_model_works_without_resaving_review_settings():
    set_model(endpoint="https://model.example/v1", model="shared", protocol="auto")
    version = capture_review_settings()
    assert version.model == "shared" and version.skill_name == "code-review-expert"
    assert version.protocol == "auto" and not version.encrypted_api_key


@pytest.mark.django_db
def test_legacy_review_model_is_not_a_fallback_for_missing_shared_model():
    previous = ReviewSettingsVersion.objects.create(endpoint="https://legacy.example/v1", model="legacy", protocol="openai",
        skill_name="code-review-expert", skill_revision="old", skill_documents={"SKILL.md": "历史规则"})
    from apps.system.models import ReviewSettings
    ReviewSettings.objects.create(pk=1, current_version=previous)
    assert settings_response(previous)["endpoint"] == ""
    with pytest.raises(ValidationError, match="AI 模型服务"):
        capture_review_settings()
    previous.refresh_from_db()
    assert previous.model == "legacy"


@pytest.mark.django_db
def test_review_skill_endpoint_cannot_write_shared_model_or_secret():
    client = admin_client()
    set_model(model="shared", api_key="private")
    response = client.put("/api/system/review-settings/", {
        "skill": "code-review-expert", "model": "other", "api_key": "leaked",
    }, format="json")
    assert response.status_code == 400
    assert SystemConfig.objects.get(key="ai_model").value == "shared"
    assert SystemConfig.objects.get(key="ai_api_key").value == "private"


@pytest.mark.django_db
def test_review_settings_rejects_unauthorized_reads_and_writes():
    client = APIClient()
    client.force_authenticate(User.objects.create_user(username="review-user", password="testpass"))
    assert client.get("/api/system/review-settings/").status_code == 403
    assert client.put("/api/system/review-settings/", {}, format="json").status_code == 403


@pytest.mark.django_db
def test_shared_model_address_cannot_contain_credentials_in_review_snapshot():
    set_model(endpoint="https://user:secret@model.example/v1", model="model")
    save_settings({"skill": "code-review-expert"})
    with pytest.raises(ValidationError, match="AI 模型服务"):
        capture_review_settings()
