"""共享模型整组保存，提审不得捕获半份配置。"""
from concurrent.futures import ThreadPoolExecutor
from threading import Event, current_thread

import pytest
from django.db import close_old_connections, connection
from rest_framework.test import APIClient

from apps.account.models import User
from apps.system.ai_config import model_config
from apps.system.models import SystemConfig
from apps.system.review_settings import capture_review_settings
from utils.crypto import decrypt_credential

URL = "/api/system/ai-settings/"
OLD = {"endpoint": "https://old.example/v1", "api_key": "old-private", "model": "old-model", "protocol": "openai"}
NEW = {"endpoint": "https://new.example/v1", "api_key": "new-private", "model": "new-model", "protocol": "anthropic"}


@pytest.fixture
def ai_client():
    client = APIClient()
    client.force_authenticate(User.objects.create_superuser(username="ai-settings-admin", password="testpass"))
    for field, value in OLD.items():
        SystemConfig.objects.create(key=f"ai_{field}", value=value)
    return client


@pytest.mark.django_db
def test_save_shared_model_as_one_configuration_and_keep_previous_snapshot(ai_client):
    previous = capture_review_settings()
    result = ai_client.put(URL, {**NEW, "max_tokens": "8192"}, format="json")
    assert result.status_code == 200, getattr(result, "data", None)
    assert "new-private" not in str(result.data)
    assert model_config() == NEW
    assert SystemConfig.objects.get(key="ai_max_tokens").value == "8192"
    current = capture_review_settings()
    previous.refresh_from_db()
    assert (current.endpoint, current.model, current.protocol) == (NEW["endpoint"], NEW["model"], NEW["protocol"])
    assert decrypt_credential(current.encrypted_api_key)["api_key"] == NEW["api_key"]
    assert previous.endpoint == OLD["endpoint"]
    assert decrypt_credential(previous.encrypted_api_key)["api_key"] == OLD["api_key"]


@pytest.mark.django_db
def test_shared_model_failure_rolls_back_every_field(ai_client, monkeypatch):
    original = SystemConfig.save

    def fail_on_model(config, *args, **kwargs):
        if config.key == "ai_model":
            raise RuntimeError("模拟保存失败")
        return original(config, *args, **kwargs)

    monkeypatch.setattr(SystemConfig, "save", fail_on_model)
    assert ai_client.put(URL, NEW, format="json").status_code == 500
    assert model_config() == OLD


@pytest.mark.django_db
def test_shared_model_omitted_key_is_preserved_and_blank_clears_it(ai_client):
    payload = {field: value for field, value in NEW.items() if field != "api_key"}
    assert ai_client.put(URL, payload, format="json").status_code == 200
    assert model_config()["api_key"] == OLD["api_key"]
    assert ai_client.put(URL, {**payload, "api_key": ""}, format="json").status_code == 200
    assert not capture_review_settings().encrypted_api_key
    assert not SystemConfig.objects.filter(key="ai_api_key").exists()


@pytest.mark.django_db
@pytest.mark.parametrize("invalid", [{"protocol": "bad"}, {"endpoint": "https://user:secret@new.example/v1"}, {"model": "x" * 201}])
def test_invalid_shared_settings_do_not_partially_save(ai_client, invalid):
    response = ai_client.put(URL, {**NEW, **invalid}, format="json")
    assert response.status_code == 400
    assert model_config() == OLD


@pytest.mark.django_db
def test_shared_model_requires_config_permission(ai_client):
    ai_client.force_authenticate(User.objects.create_user(username="ai-settings-viewer"))
    assert ai_client.put(URL, NEW, format="json").status_code == 403
    assert model_config() == OLD


@pytest.mark.django_db
@pytest.mark.parametrize("field", ["endpoint", "api_key", "model", "protocol"])
def test_generic_config_routes_cannot_modify_model_fields(ai_client, field):
    """通用参数表和旧客户端不能逐键写入、改名或删除共享模型。"""
    url = f"/api/system/configs/ai_{field}/"
    assert ai_client.patch(url, {"value": NEW[field]}, format="json").status_code == 400
    assert ai_client.put(url, {"key": f"ai_{field}", "value": NEW[field]}, format="json").status_code == 400
    assert ai_client.patch(url, {"key": "renamed_model"}, format="json").status_code == 400
    assert ai_client.delete(url).status_code == 400
    assert model_config() == OLD
    SystemConfig.objects.create(key="other_setting", value="unchanged")
    assert ai_client.patch("/api/system/configs/other_setting/", {"key": f"ai_{field}", "value": NEW[field]}, format="json").status_code == 400
    SystemConfig.objects.filter(key=f"ai_{field}").delete()
    assert ai_client.post("/api/system/configs/", {"key": f"ai_{field}", "value": NEW[field]}, format="json").status_code == 400
    assert not SystemConfig.objects.filter(key=f"ai_{field}").exists()
    assert SystemConfig.objects.get(key="other_setting").value == "unchanged"


@pytest.mark.django_db(transaction=True)
def test_postgresql_review_snapshot_waits_for_complete_model_save(ai_client, monkeypatch):
    """在首字段写入时暂停真实事务，另一连接的提审只能读完整的新模型。"""
    if connection.vendor != "postgresql":
        pytest.skip("需要 PostgreSQL 真实行锁")
    previous = capture_review_settings()
    first_written, resume, capture_started, capture_finished = Event(), Event(), Event(), Event()
    original = SystemConfig.save

    def pause_after_endpoint(config, *args, **kwargs):
        result = original(config, *args, **kwargs)
        if current_thread().name.startswith("ai-save") and config.key == "ai_endpoint":
            first_written.set()
            assert resume.wait(10), "等待放行保存超时"
        return result

    monkeypatch.setattr(SystemConfig, "save", pause_after_endpoint)

    def save():
        close_old_connections()
        try:
            return ai_client.put(URL, NEW, format="json").status_code
        finally:
            close_old_connections()

    def capture():
        close_old_connections()
        try:
            capture_started.set()
            result = capture_review_settings()
            capture_finished.set()
            return result
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="ai-save") as writers, ThreadPoolExecutor(max_workers=1) as readers:
        saving = writers.submit(save)
        try:
            assert first_written.wait(10)
            # 脚本生成的一次查询仍读到提交前的完整配置。
            assert model_config() == OLD
            capturing = readers.submit(capture)
            assert capture_started.wait(10)
            assert not capture_finished.wait(0.2)
        finally:
            resume.set()
        assert saving.result(timeout=10) == 200
        captured = capturing.result(timeout=10)
    assert (captured.endpoint, captured.model, captured.protocol) == (NEW["endpoint"], NEW["model"], NEW["protocol"])
    assert decrypt_credential(captured.encrypted_api_key)["api_key"] == NEW["api_key"]
    previous.refresh_from_db()
    assert previous.endpoint == OLD["endpoint"]
