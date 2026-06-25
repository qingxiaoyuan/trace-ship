"""
提交记录路由配置

将提交记录查询及复核接口注册到 /api/commits/ 下。
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.repository.views import CommitRecordViewSet

router = DefaultRouter()
router.register(r"", CommitRecordViewSet, basename="commit-record")

urlpatterns = [
    path("", include(router.urls)),
]
