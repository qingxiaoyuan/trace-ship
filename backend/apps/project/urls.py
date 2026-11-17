"""
项目管理路由配置

注册项目 CRUD 以及嵌套的项目成员接口。
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.project.views import ProjectComponentViewSet, ProjectMemberViewSet, ProjectViewSet
from apps.software.views import ProjectSoftwareViewSet

router = DefaultRouter()
router.register(r"", ProjectViewSet, basename="project")

urlpatterns = [
    path("", include(router.urls)),
    # 项目组件嵌套路由：Project 在业务语义上即项目
    path("<uuid:project_pk>/components/", ProjectComponentViewSet.as_view({"get": "list", "post": "create"}), name="project-component-list"),
    path("<uuid:project_pk>/components/available/", ProjectComponentViewSet.as_view({"get": "available"}), name="project-component-available"),
    path("<uuid:project_pk>/components/<uuid:pk>/", ProjectComponentViewSet.as_view({
        "get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"
    }), name="project-component-detail"),
    # 显式项目软件选用
    path("<uuid:project_pk>/software/", ProjectSoftwareViewSet.as_view({"get": "list", "post": "create"}), name="project-software-list"),
    path("<uuid:project_pk>/software/available/", ProjectSoftwareViewSet.as_view({"get": "available"}), name="project-software-available"),
    path("<uuid:project_pk>/software/<uuid:pk>/", ProjectSoftwareViewSet.as_view({"patch": "partial_update"}), name="project-software-detail"),
    # 项目成员嵌套路由
    path("<uuid:project_pk>/members/", ProjectMemberViewSet.as_view({"get": "list", "post": "create"}), name="project-member-list"),
    path("<uuid:project_pk>/members/<uuid:pk>/", ProjectMemberViewSet.as_view({
        "get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"
    }), name="project-member-detail"),
]
