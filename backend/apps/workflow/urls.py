"""
工作流路由配置
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.workflow.views import (
    WorkflowDefinitionViewSet,
    WorkflowInstanceViewSet,
    WorkflowTaskViewSet,
)

router = DefaultRouter()
router.register(r"definitions", WorkflowDefinitionViewSet, basename="workflow-definition")
router.register(r"instances", WorkflowInstanceViewSet, basename="workflow-instance")
router.register(r"tasks", WorkflowTaskViewSet, basename="workflow-task")

urlpatterns = [
    path("", include(router.urls)),
]
