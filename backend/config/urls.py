from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse
from rest_framework import status
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView, SpectacularRedocView


def health_check(request):
    """健康检查接口"""
    from django.db import connection
    from django.core.cache import cache
    from django_redis import get_redis_connection

    db_ok = True
    redis_ok = True
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:
        db_ok = False

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


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", health_check, name="health-check"),
    # API
    path("api/auth/", include("apps.account.urls")),
    path("api/account/", include("apps.account.urls_account")),
    path("api/projects/", include("apps.project.urls")),
    path("api/repositories/", include("apps.repository.urls")),
    path("api/commits/", include("apps.repository.urls_commits")),
    path("api/credentials/", include("apps.credential.urls")),
    path("api/system/", include("apps.system.urls")),
    # API Docs
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("swagger/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    path("redoc/", SpectacularRedocView.as_view(url_name="schema"), name="redoc"),
]
