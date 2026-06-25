"""
项目管理路由配置

注册项目 CRUD 以及嵌套的项目成员接口。
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.project.views import ProjectViewSet, ProjectMemberViewSet

router = DefaultRouter()
router.register(r"", ProjectViewSet, basename="project")

urlpatterns = [
    path("", include(router.urls)),
    # 项目成员嵌套路由
    path("<uuid:project_pk>/members/", ProjectMemberViewSet.as_view({"get": "list", "post": "create"}), name="project-member-list"),
    path("<uuid:project_pk>/members/<uuid:pk>/", ProjectMemberViewSet.as_view({
        "get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"
    }), name="project-member-detail"),
]
