"""系统内置打包路由。"""
from rest_framework.routers import DefaultRouter

from apps.package.views import (
    PackageConfigViewSet,
    PackageImageViewSet,
    PackageNodeViewSet,
    PackageTaskViewSet,
)

router = DefaultRouter()
router.register("images", PackageImageViewSet, basename="package-image")
router.register("nodes", PackageNodeViewSet, basename="package-node")
router.register("configs", PackageConfigViewSet, basename="package-config")
router.register("tasks", PackageTaskViewSet, basename="package-task")

urlpatterns = router.urls

