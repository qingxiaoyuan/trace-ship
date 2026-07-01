"""
工作流视图

提供流程定义、流程实例、审批任务的 RESTful API。
"""
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from utils.viewsets import StandardModelViewSet, StandardReadOnlyModelViewSet

from apps.account.models import User
from apps.project.models import ProjectMember
from apps.release.services import ReleaseService
from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask
from apps.workflow.serializers import (
    WorkflowDefinitionListSerializer,
    WorkflowDefinitionSerializer,
    WorkflowInstanceListSerializer,
    WorkflowInstanceSerializer,
    WorkflowTaskSerializer,
)
from apps.workflow.services import WorkflowEngine
from utils.permissions import IsProjectDeveloper, IsProjectLeader
from utils.response import error_response, success_response


class WorkflowDefinitionViewSet(StandardModelViewSet):
    """
    工作流定义视图集

    项目管理员可创建/修改/删除，项目成员可查看。
    """

    queryset = WorkflowDefinition.objects.all()
    serializer_class = WorkflowDefinitionSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["project", "biz_type", "is_active"]
    search_fields = ["name"]
    ordering_fields = ["created_at", "updated_at"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        """列表使用精简序列化器"""
        if self.action == "list":
            return WorkflowDefinitionListSerializer
        return WorkflowDefinitionSerializer

    def get_queryset(self):
        """根据用户身份返回可见定义"""
        if getattr(self, "swagger_fake_view", False):
            return WorkflowDefinition.objects.none()
        user = self.request.user
        queryset = WorkflowDefinition.objects.select_related("project", "created_by")
        if user.is_superuser:
            return queryset.all()
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        """写操作需项目负责人"""
        if self.action in ["update", "partial_update"]:
            return [IsAuthenticated(), IsProjectLeader()]
        return super().get_permissions()

    def perform_create(self, serializer):
        """创建时自动设置创建人"""
        serializer.save(created_by=self.request.user)

    def create(self, request: Request, *args, **kwargs) -> Response:
        """内置流程随项目自动创建，不支持手动新增"""
        return error_response(40003, "流程为项目内置，不支持手动新增")

    def update(self, request: Request, *args, **kwargs) -> Response:
        """更新流程定义（仅允许修改审批节点配置）"""
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        # 内置流程仅允许修改 node_config，其余标识字段保持不变
        data = {"node_config": request.data.get("node_config")}
        if data["node_config"] is None:
            return error_response(40001, "仅可修改审批节点配置")
        serializer = self.get_serializer(instance, data=data, partial=partial)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return success_response(serializer.data, message="更新成功")

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """内置流程不可删除"""
        return error_response(40003, "流程为项目内置，不可删除")


class WorkflowInstanceViewSet(StandardModelViewSet):
    """
    工作流实例视图集

    项目开发者可创建实例，项目成员可查看详情。
    """

    queryset = WorkflowInstance.objects.all()
    serializer_class = WorkflowInstanceSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["biz_type", "biz_id", "status", "created_by"]
    ordering_fields = ["created_at", "updated_at"]
    ordering = ["-created_at"]
    http_method_names = ["get", "post", "head", "options"]

    def get_serializer_class(self):
        """列表与「我发起的」使用轻量序列化器，详情使用完整序列化器。"""
        if self.action in ("list", "initiated"):
            return WorkflowInstanceListSerializer
        return WorkflowInstanceSerializer

    def get_queryset(self):
        """根据用户身份返回可见实例"""
        if getattr(self, "swagger_fake_view", False):
            return WorkflowInstance.objects.none()
        user = self.request.user
        queryset = WorkflowInstance.objects.select_related("definition", "created_by").prefetch_related("tasks")
        if user.is_superuser:
            return queryset.all()
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(definition__project_id__in=project_ids)

    def get_permissions(self):
        """创建实例需项目开发者"""
        if self.action == "create":
            return [IsAuthenticated(), IsProjectDeveloper()]
        return super().get_permissions()

    def create(self, request: Request, *args, **kwargs) -> Response:
        """创建流程实例"""
        definition_id = request.data.get("definition_id")
        biz_type = request.data.get("biz_type", "release")
        biz_id = request.data.get("biz_id")

        if not definition_id or not biz_id:
            return error_response(40001, "definition_id 和 biz_id 不能为空")

        try:
            definition = WorkflowDefinition.objects.get(id=definition_id, is_active=True)
        except WorkflowDefinition.DoesNotExist:
            return error_response(40401, "流程定义不存在或已停用")

        instance = WorkflowEngine.create_instance(
            definition=definition,
            biz_type=biz_type,
            biz_id=biz_id,
            user=request.user,
        )
        serializer = self.get_serializer(instance)
        return success_response(serializer.data, message="创建成功", status=201)

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        """查询实例详情"""
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return success_response(serializer.data)

    @action(detail=False, methods=["get"], url_path="initiated")
    def initiated(self, request: Request) -> Response:
        """我发起的：返回当前用户创建的流程实例列表，支持 status 过滤。"""
        queryset = self.get_queryset().filter(created_by=request.user)
        status = request.query_params.get("status")
        if status:
            queryset = queryset.filter(status=status)
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=["post"], url_path="revoke")
    def revoke(self, request: Request, pk=None) -> Response:
        """发起人撤销实例"""
        instance = self.get_object()
        try:
            WorkflowEngine.revoke_instance(instance, request.user)
        except Exception as exc:
            return error_response(40001, str(exc))
        serializer = self.get_serializer(instance)
        return success_response(serializer.data, message="撤销成功")


class WorkflowTaskViewSet(StandardReadOnlyModelViewSet):
    """
    审批任务视图集

    提供我的待办、我的已办以及审批操作 API。
    """

    queryset = WorkflowTask.objects.all()
    serializer_class = WorkflowTaskSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ["instance", "node_id", "status"]
    ordering_fields = ["created_at", "action_time"]
    ordering = ["-created_at"]

    def get_queryset(self):
        """根据用户身份返回可见任务"""
        if getattr(self, "swagger_fake_view", False):
            return WorkflowTask.objects.none()
        user = self.request.user
        queryset = WorkflowTask.objects.select_related("instance", "approver", "transferred_from")
        if user.is_superuser:
            return queryset.all()
        return queryset.filter(approver=user)

    @action(detail=False, methods=["get"], url_path="todo")
    def todo(self, request: Request) -> Response:
        """我的待办"""
        queryset = self.get_queryset().filter(status="pending")
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=False, methods=["get"], url_path="done")
    def done(self, request: Request) -> Response:
        """我的已办"""
        queryset = self.get_queryset().exclude(status="pending")
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request: Request, pk=None) -> Response:
        """审批通过"""
        task = self.get_object()
        comment = request.data.get("comment", "")
        try:
            instance = WorkflowEngine.process_task(task, "approve", comment)
            if instance.status == "completed":
                ReleaseService.handle_workflow_completed(instance)
        except serializers.ValidationError as exc:
            # 抛出审批校验异常中的首条可读信息，避免前端仅看到 "'node_id'" 这类字段名
            message = self._extract_validation_message(exc)
            return error_response(40001, message)
        except Exception as exc:
            return error_response(40001, str(exc))
        serializer = self.get_serializer(task)
        return success_response(serializer.data, message="审批通过")

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request: Request, pk=None) -> Response:
        """审批驳回"""
        task = self.get_object()
        comment = request.data.get("comment", "")
        try:
            instance = WorkflowEngine.process_task(task, "reject", comment)
            if instance.status == "rejected":
                ReleaseService.handle_workflow_rejected(instance, comment)
        except serializers.ValidationError as exc:
            message = self._extract_validation_message(exc)
            return error_response(40001, message)
        except Exception as exc:
            return error_response(40001, str(exc))
        serializer = self.get_serializer(task)
        return success_response(serializer.data, message="审批驳回")

    @action(detail=True, methods=["post"], url_path="transfer")
    def transfer(self, request: Request, pk=None) -> Response:
        """转交他人"""
        task = self.get_object()
        comment = request.data.get("comment", "")
        to_user_id = request.data.get("to_user_id")
        if not to_user_id:
            return error_response(40001, "to_user_id 不能为空")
        to_user = User.objects.filter(id=to_user_id).first()
        if not to_user:
            return error_response(40401, "目标用户不存在")
        try:
            WorkflowEngine.process_task(task, "transfer", comment, to_user)
        except serializers.ValidationError as exc:
            message = self._extract_validation_message(exc)
            return error_response(40001, message)
        except Exception as exc:
            return error_response(40001, str(exc))
        serializer = self.get_serializer(task)
        return success_response(serializer.data, message="转交成功")

    @action(detail=True, methods=["post"], url_path="rollback")
    def rollback(self, request: Request, pk=None) -> Response:
        """回退到上一节点或初始节点"""
        task = self.get_object()
        comment = request.data.get("comment", "")
        rollback_target = request.data.get("rollback_target")
        try:
            instance = WorkflowEngine.process_task(
                task,
                "rollback",
                comment,
                rollback_target=rollback_target,
            )
        except serializers.ValidationError as exc:
            message = self._extract_validation_message(exc)
            return error_response(40001, message)
        except Exception as exc:
            return error_response(40001, str(exc))

        serializer = self.get_serializer(task)

        # 驳回到初始节点：流程作废，自动删除该实例并让发布回到草稿态
        if instance.status == "rejected":
            try:
                ReleaseService.handle_workflow_rollback_to_start(instance, comment)
            except Exception:
                pass
            instance.delete()
            return success_response(serializer.data, message="已回退到初始节点，流程已删除")

        return success_response(serializer.data, message="回退成功")

    def _extract_validation_message(self, exc: serializers.ValidationError) -> str:
        """从 DRF ValidationError 中提取第一条可读错误信息。"""
        if not exc.detail:
            return "参数校验失败"
        first = exc.detail[0] if isinstance(exc.detail, list) else next(iter(exc.detail.values()))
        if isinstance(first, list):
            first = first[0]
        return str(first) if first else "参数校验失败"
