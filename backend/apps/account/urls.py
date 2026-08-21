"""
账号认证路由配置

将登录、登出、Token 刷新、用户信息、菜单等接口注册到 /api/auth/ 下。
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.account.views import AuthViewSet

# 创建默认路由器，空路径由 AuthViewSet 处理
router = DefaultRouter()
router.register(r"", AuthViewSet, basename="auth")

urlpatterns = [
    # 包含路由器生成的全部 URL
    path("", include(router.urls)),
]
