from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.project.views import ProjectViewSet, ProjectMemberViewSet, ProjectIntegrationViewSet

router = DefaultRouter()
router.register(r"", ProjectViewSet, basename="project")

urlpatterns = [
    path("", include(router.urls)),
    # 项目成员
    path("<uuid:project_pk>/members/", ProjectMemberViewSet.as_view({"get": "list", "post": "create"}), name="project-member-list"),
    path("<uuid:project_pk>/members/<uuid:pk>/", ProjectMemberViewSet.as_view({
        "get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"
    }), name="project-member-detail"),
    # 项目外站绑定
    path("<uuid:project_pk>/integrations/", ProjectIntegrationViewSet.as_view({"get": "list", "post": "create"}), name="project-integration-list"),
    path("<uuid:project_pk>/integrations/<uuid:pk>/", ProjectIntegrationViewSet.as_view({
        "get": "retrieve", "put": "update", "patch": "partial_update", "delete": "destroy"
    }), name="project-integration-detail"),
    path("<uuid:project_pk>/integrations/<uuid:pk>/test/", ProjectIntegrationViewSet.as_view({"post": "test"}), name="project-integration-test"),
]
