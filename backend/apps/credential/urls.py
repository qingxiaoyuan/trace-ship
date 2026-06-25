"""
凭证管理路由配置

将凭证 CRUD 及扩展 action 注册到 /api/credentials/ 下。
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.credential.views import CredentialViewSet

router = DefaultRouter()
router.register(r"", CredentialViewSet, basename="credential")

urlpatterns = [
    path("", include(router.urls)),
]
