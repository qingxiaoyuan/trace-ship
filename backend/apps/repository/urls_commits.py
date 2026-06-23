from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.repository.views import CommitRecordViewSet

router = DefaultRouter()
router.register(r"", CommitRecordViewSet, basename="commit-record")

urlpatterns = [
    path("", include(router.urls)),
]
