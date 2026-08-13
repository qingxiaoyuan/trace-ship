"""健康检查接口短缓存行为测试。"""
import pytest
from django.core.cache import cache
from django.db import connections
from django.test import Client, RequestFactory

from config.urls import health_check


@pytest.fixture(autouse=True)
def _clear_health_cache():
    """每个测试前后清空缓存，避免健康检查结果跨测试残留。"""
    cache.clear()
    yield
    cache.clear()


@pytest.mark.django_db
def test_health_check_caches_ok_result():
    """首次探测成功后，缓存期内命中缓存，不再真实探测 DB。"""
    request = RequestFactory().get("/health/")
    assert health_check(request).status_code == 200

    connection = connections["default"]
    original_cursor = connection.cursor
    connection.cursor = lambda: (_ for _ in ()).throw(Exception("db down"))
    try:
        # 缓存命中时直接返回 200，DB 探测逻辑不会被触发
        assert health_check(request).status_code == 200
    finally:
        connection.cursor = original_cursor


@pytest.mark.django_db
def test_health_check_caches_unhealthy_result():
    """DB 探测失败返回 503 后，缓存期内即使 DB 恢复也返回缓存的 503。"""
    request = RequestFactory().get("/health/")
    connection = connections["default"]
    original_cursor = connection.cursor
    connection.cursor = lambda: (_ for _ in ()).throw(Exception("db down"))
    try:
        assert health_check(request).status_code == 503
        # 恢复 DB：缓存期内仍应命中缓存返回 503，而不是立即恢复 200
        connection.cursor = original_cursor
        assert health_check(request).status_code == 503
    finally:
        connection.cursor = original_cursor


@pytest.mark.django_db
def test_health_endpoint_registered():
    """/health/ 路由可访问（真实请求链路）。"""
    client = Client()
    assert client.get("/health/").status_code == 200
