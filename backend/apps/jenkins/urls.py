"""
Jenkins 集成路由配置

注册 Jenkins 任务与构建记录接口到 /api/jenkins/ 下。
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.jenkins.views import JenkinsBuildViewSet, JenkinsJobViewSet

router = DefaultRouter()
router.register(r"jobs", JenkinsJobViewSet, basename="jenkins-job")
router.register(r"builds", JenkinsBuildViewSet, basename="jenkins-build")

urlpatterns = [
    path("", include(router.urls)),
]
