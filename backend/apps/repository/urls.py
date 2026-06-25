"""
仓库路由配置

将仓库 CRUD 及扩展 action 注册到 /api/repositories/ 下。
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.repository.views import RepositoryViewSet

router = DefaultRouter()
router.register(r"", RepositoryViewSet, basename="repository")

urlpatterns = [
    path("", include(router.urls)),
]
