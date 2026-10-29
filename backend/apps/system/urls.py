"""
系统管理路由配置

将系统参数和操作日志接口注册到 /api/system/ 下。
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.system.views import (
    AccessTokenViewSet,
    OperationLogViewSet,
    SystemConfigViewSet,
    ai_settings,
    review_settings,
    review_skill_detail,
    review_skills,
)

router = DefaultRouter()
router.register(r"configs", SystemConfigViewSet, basename="config")
router.register(r"logs", OperationLogViewSet, basename="log")
router.register(r"access-tokens", AccessTokenViewSet, basename="access-token")

urlpatterns = [
    path("ai-settings/", ai_settings),
    path("review-settings/", review_settings),
    path("review-skills/", review_skills),
    path("review-skills/<uuid:pk>/", review_skill_detail),
    path("", include(router.urls)),
]
