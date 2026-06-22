from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.system.views import SystemConfigViewSet, OperationLogViewSet

router = DefaultRouter()
router.register(r"configs", SystemConfigViewSet, basename="config")
router.register(r"logs", OperationLogViewSet, basename="log")

urlpatterns = [
    path("", include(router.urls)),
]
