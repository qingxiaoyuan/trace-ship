"""
项目根路由配置

统一注册管理后台、健康检查、各业务模块 API 以及 API 文档页面。
"""
from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse
from rest_framework import status
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView


def health_check(request) -> JsonResponse:
    """
    健康检查接口

    检查 PostgreSQL 和 Redis 是否可用，用于容器探针和负载均衡健康检测。

    Args:
        request: Django HttpRequest 对象

    Returns:
        服务正常时返回 200，异常时返回 503
    """
    from django.db import connection
    from django.core.cache import cache

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
        return JsonResponse(
            {"code": 0, "message": "success", "data": {"db": "ok", "redis": "ok"}},
            status=status.HTTP_200_OK,
        )
    else:
        return JsonResponse(
            {
                "code": 50000,
                "message": "service unhealthy",
                "data": {"db": "ok" if db_ok else "error", "redis": "ok" if redis_ok else "error"},
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


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
    # API 文档（OpenAPI Schema、Swagger UI、ReDoc）
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("swagger/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]
