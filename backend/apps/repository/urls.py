from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.repository.views import RepositoryViewSet

router = DefaultRouter()
router.register(r"", RepositoryViewSet, basename="repository")

urlpatterns = [
    path("", include(router.urls)),
]
