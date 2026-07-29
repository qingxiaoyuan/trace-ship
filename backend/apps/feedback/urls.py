"""
使用反馈路由配置
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.feedback.views import FeedbackViewSet

router = DefaultRouter()
router.register(r"", FeedbackViewSet, basename="feedback")

urlpatterns = [
    path("", include(router.urls)),
]
