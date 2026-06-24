"""
账号管理路由配置

将用户、角色、权限资源注册到 /api/account/ 下。
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.account.views import UserViewSet, RoleViewSet, PermissionViewSet

# 创建默认路由器并注册三个 ViewSet
router = DefaultRouter()
router.register(r"users", UserViewSet, basename="user")
router.register(r"roles", RoleViewSet, basename="role")
router.register(r"permissions", PermissionViewSet, basename="permission")

urlpatterns = [
    path("", include(router.urls)),
]
