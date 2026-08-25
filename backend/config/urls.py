"""
项目根路由配置

统一注册管理后台、健康检查、各业务模块 API 以及 API 文档页面。
"""
from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularRedocView, SpectacularSwaggerView
from rest_framework import status


def health_check(request) -> JsonResponse:
    """
    健康检查接口

    检查 PostgreSQL 和 Redis 是否可用，用于容器探针和负载均衡健康检测。
    结果短缓存 5 秒，避免高频探针请求反复压测数据库与 Redis。

    Args:
        request: Django HttpRequest 对象

    Returns:
        服务正常时返回 200，异常时返回 503
    """
    from django.core.cache import cache
    from django.db import connection

    # 探针结果短缓存：命中则直接返回，避免每次探针都真实探测 DB/Redis
    try:
        cached = cache.get("health_check_result")
    except Exception:
        cached = None
    if cached is not None:
        return JsonResponse(cached["payload"], status=cached["http_status"])

    db_ok = True
    redis_ok = True

    # 检查数据库连接
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        db_ok = False

    # 检查 Redis 缓存连接
    try:
        cache.set("health_check", "ok", timeout=5)
        cache.get("health_check")
    except Exception:
        redis_ok = False

    if db_ok and redis_ok:
        payload = {"code": 0, "message": "success", "data": {"db": "ok", "redis": "ok"}}
        http_status = status.HTTP_200_OK
    else:
        payload = {
            "code": 50000,
            "message": "service unhealthy",
            "data": {"db": "ok" if db_ok else "error", "redis": "ok" if redis_ok else "error"},
        }
        http_status = status.HTTP_503_SERVICE_UNAVAILABLE

    try:
        cache.set("health_check_result", {"payload": payload, "http_status": http_status}, timeout=5)
    except Exception:
        pass
    return JsonResponse(payload, status=http_status)


# 根路由表
urlpatterns = [
    # Django 管理后台
    path("admin/", admin.site.urls),
    # 健康检查
    path("health/", health_check, name="health-check"),
    # 业务 API
    path("api/auth/", include("apps.account.urls")),
    path("api/account/", include("apps.account.urls_account")),
    path("api/projects/", include("apps.project.urls")),
    path("api/repositories/", include("apps.repository.urls")),
    path("api/commits/", include("apps.repository.urls_commits")),
    path("api/releases/", include("apps.release.urls")),
    path("api/packages/", include("apps.package.urls")),
    path("api/credentials/", include("apps.credential.urls")),
    path("api/system/", include("apps.system.urls")),
    path("api/workflow/", include("apps.workflow.urls")),
    path("api/notifications/", include("apps.notification.urls")),
    path("api/feedback/", include("apps.feedback.urls")),
    # 对外开放接口（Access Token 认证 + scope 授权，只读）
    path("api/open/", include("config.urls_open")),
    # API 文档（OpenAPI Schema、Swagger UI、ReDoc）
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("swagger/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]
