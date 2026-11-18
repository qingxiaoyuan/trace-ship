"""软件目录路由。"""

from rest_framework.routers import SimpleRouter

from apps.software.views import SoftwareViewSet

router = SimpleRouter(use_regex_path=False)
router.register("", SoftwareViewSet, basename="software")
urlpatterns = router.urls
