"""OA 归档配置通过独立 REST 边界维护。"""
import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.system.tests.test_views import _grant_permission

pytestmark = pytest.mark.django_db
URL = "/api/system/configs/oa-archive/"


def test_归档接口由配置维护者保存完整地址且独立于单点登录():
    user = User.objects.create_user(username="oa-config")
    _grant_permission(user, "system.config")
    client = APIClient()
    client.force_authenticate(user)
    assert client.get(URL).data["data"] == {"url": ""}
    address = "http://oa.example.com/api/v1/ticketscript/create_software_archive_with_number"
    response = client.put(URL, {"url": address}, format="json")
    assert response.status_code == 200
    assert client.get(URL).data["data"] == {"url": address}
    assert client.get("/api/system/configs/sso_verify_url/").status_code == 404


@pytest.mark.parametrize("superuser", [False, True])
def test_只有配置维护者与超管可以读写地址(superuser):
    user = User.objects.create_user(username="ordinary", is_superuser=superuser)
    client = APIClient()
    client.force_authenticate(user)
    assert client.get(URL).status_code == (200 if superuser else 403)
    assert client.put(URL, {"url": "https://oa.example.com/archive"}, format="json").status_code == (200 if superuser else 403)


def test_地址必须完整且不能通过通用配置接口公开或绕过校验():
    client = APIClient()
    client.force_authenticate(User.objects.create_superuser(username="admin"))
    for address in ["/api/create", "file:///tmp/archive", "https://user:password@oa.example.com/archive", "https://oa.example.com/archive#fragment"]:
        assert client.put(URL, {"url": address}, format="json").status_code == 400
    assert client.post("/api/system/configs/", {"key": "oa_archive_url", "value": "bad", "is_public": True}, format="json").status_code == 400
