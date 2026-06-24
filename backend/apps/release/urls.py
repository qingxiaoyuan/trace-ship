"""
发布管理路由配置

将发布记录 CRUD 及扩展 action 注册到 /api/releases/ 下。
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.release.views import ReleaseViewSet

router = DefaultRouter()
router.register(r"", ReleaseViewSet, basename="release")

urlpatterns = [
    path("", include(router.urls)),
]
