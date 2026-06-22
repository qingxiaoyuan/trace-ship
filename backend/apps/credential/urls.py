from django.urls import path, include
from rest_framework.routers import DefaultRouter
from apps.credential.views import CredentialViewSet

router = DefaultRouter()
router.register(r"", CredentialViewSet, basename="credential")

urlpatterns = [
    path("", include(router.urls)),
]
