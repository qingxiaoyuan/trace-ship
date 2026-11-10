"""验证下载白名单的配置权限及请求来源边界。"""

import pytest
from pytest_django.fixtures import Settings
from rest_framework.test import APIClient

from apps.account.models import User
from apps.system.models import SystemConfig
from apps.system.serializers import DOWNLOAD_CIDRS_MAX_LENGTH
from apps.system.services import DOWNLOAD_CIDRS_KEY

pytestmark = pytest.mark.django_db
POLICY_URL = "/api/system/configs/download-policy/"
USER_INFO_URL = "/api/auth/user-info/"


@pytest.fixture
def client() -> APIClient:
    client = APIClient()
    client.force_authenticate(User.objects.create_superuser(username="download-admin", password="test"))
    return client


def test_policy_can_only_be_changed_through_managed_network(client: APIClient, settings: Settings) -> None:
    settings.DOWNLOAD_ALLOWED_CIDRS = "10.20.30.0/24"
    settings.DOWNLOAD_POLICY_ADMIN_CIDRS = "10.50.60.0/24"
    settings.DOWNLOAD_TRUSTED_PROXY_CIDRS = "172.20.0.2"
    external = {"REMOTE_ADDR": "172.20.0.2", "HTTP_X_FORWARDED_FOR": "10.50.60.7,203.0.113.8"}
    admin_network = {"REMOTE_ADDR": "172.20.0.2", "HTTP_X_FORWARDED_FOR": "10.50.60.7"}
    internal = {"REMOTE_ADDR": "10.20.30.9"}
    payload = {"allowed_cidrs": "::ffff:10.20.30.0/120, 2001:db8:abcd::/48"}

    assert client.get(POLICY_URL, **external).data["data"]["can_edit"] is False
    assert client.put(POLICY_URL, payload, format="json", **external).status_code == 403
    assert client.post(
        "/api/system/configs/", {"key": DOWNLOAD_CIDRS_KEY, "value": "0.0.0.0/0"}, format="json",
    ).status_code == 400
    invalid = client.put(POLICY_URL, {"allowed_cidrs": "10.20.30.0/99"}, format="json", **admin_network)
    assert invalid.status_code == 400
    assert not SystemConfig.objects.filter(key=DOWNLOAD_CIDRS_KEY).exists()

    saved = client.put(POLICY_URL, payload, format="json", **admin_network)
    assert saved.data["data"] == {"allowed_cidrs": "10.20.30.0/24\n2001:db8:abcd::/48", "can_edit": True}
    assert client.patch(f"/api/system/configs/{DOWNLOAD_CIDRS_KEY}/", {"value": ""}, format="json").status_code == 404
    assert client.delete(f"/api/system/configs/{DOWNLOAD_CIDRS_KEY}/").status_code == 404
    assert client.get(USER_INFO_URL, **internal).data["data"]["can_download_files"] is True

    assert client.put(POLICY_URL, {"allowed_cidrs": ""}, format="json", **admin_network).status_code == 200
    assert client.get(USER_INFO_URL, **internal).data["data"]["can_download_files"] is False
    assert client.get(POLICY_URL, **admin_network).data["data"]["can_edit"] is True

    client.force_authenticate(User.objects.create_user(username="download-reader"))
    assert client.get(POLICY_URL, **admin_network).status_code == 403
    assert client.put(POLICY_URL, payload, format="json", **admin_network).status_code == 403


def test_long_download_policy_can_be_read_and_resaved(client: APIClient, settings: Settings) -> None:
    """保留旧版能写入的长名单，回显后也能原样保存。"""
    settings.DOWNLOAD_POLICY_ADMIN_CIDRS = "127.0.0.1"
    addresses = [f"10.20.{index // 256}.{index % 256}" for index in range(640)]
    raw = "\n".join(addresses)
    normalized = "\n".join(f"{address}/32" for address in addresses)
    assert len(raw) < 8192 < len(normalized)

    assert client.put(POLICY_URL, {"allowed_cidrs": raw}, format="json").status_code == 200
    saved = client.get(POLICY_URL).data["data"]["allowed_cidrs"]
    assert saved == normalized
    repeated = client.put(POLICY_URL, {"allowed_cidrs": saved}, format="json")
    assert repeated.status_code == 200
    assert repeated.data["data"]["allowed_cidrs"] == saved

    long_input = "\n".join("::" for _ in range(DOWNLOAD_CIDRS_MAX_LENGTH // 4))
    assert len(long_input) < DOWNLOAD_CIDRS_MAX_LENGTH < len(long_input.replace("::", "::/128"))
    assert client.put(POLICY_URL, {"allowed_cidrs": long_input}, format="json").status_code == 400
    assert client.get(POLICY_URL).data["data"]["allowed_cidrs"] == saved


@pytest.mark.parametrize(("peer", "forwarded", "expected"), [
    ("10.20.30.9", "203.0.113.8", True),
    ("203.0.113.8", "10.20.30.9", False),
    ("172.20.0.2", "10.20.30.9, 10.50.60.7", True),
    ("172.20.0.2", "10.20.30.9, 203.0.113.8, 10.50.60.7", False),
    ("172.20.0.2", "", False),
    ("172.20.0.2", "10.50.60.7", False),
    ("172.20.0.2", "10.20.30.9,invalid,10.50.60.7", False),
    ("172.20.0.2", "2001:db8:abcd::9", True),
    ("172.20.0.2", "::ffff:10.20.30.9", True),
])
def test_user_info_uses_verified_client_network(
    client: APIClient, settings: Settings, peer: str, forwarded: str, expected: bool,
) -> None:
    settings.DOWNLOAD_ALLOWED_CIDRS = "10.20.30.0/24,2001:db8:abcd::/48"
    settings.DOWNLOAD_TRUSTED_PROXY_CIDRS = "172.20.0.2,10.50.60.7"
    response = client.get(USER_INFO_URL, REMOTE_ADDR=peer, HTTP_X_FORWARDED_FOR=forwarded)

    assert response.status_code == 200
    assert response.data["data"]["can_download_files"] is expected
    assert "no-store" in response["Cache-Control"]
