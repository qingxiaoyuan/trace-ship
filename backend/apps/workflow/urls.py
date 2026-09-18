"""
工作流路由配置
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.workflow.views import (
    WorkflowDefinitionViewSet,
    WorkflowInstanceViewSet,
    WorkflowTaskViewSet,
    todo_count,
)

router = DefaultRouter()
router.register(r"definitions", WorkflowDefinitionViewSet, basename="workflow-definition")
router.register(r"instances", WorkflowInstanceViewSet, basename="workflow-instance")
router.register(r"tasks", WorkflowTaskViewSet, basename="workflow-task")

urlpatterns = [
    # 待我审批计数（侧边栏 badge），需在 router 路由之前注册
    path("todo-count/", todo_count, name="workflow-todo-count"),
    path("", include(router.urls)),
]
