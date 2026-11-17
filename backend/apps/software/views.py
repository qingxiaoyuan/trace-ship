"""软件目录公开 REST 接口。"""

from uuid import UUID

from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.project.services import visible_project_ids, visible_repository_ids
from apps.project.views import NestedProjectPermissionMixin
from apps.repository.models import Repository
from apps.software.models import ProjectSoftware, Software, SoftwareMaintainer
from apps.software.serializers import (
    ProjectSoftwareSelectionSerializer,
    ProjectSoftwareSerializer,
    ProjectSoftwareStateSerializer,
    SoftwareGrantSerializer,
    SoftwareRegistrationSerializer,
    SoftwareSerializer,
    SoftwareSummarySerializer,
    SoftwareUpdateSerializer,
)
from apps.software.services import (
    active_project_repositories,
    change_project_selection,
    grant_software_maintenance,
    owned_repositories,
    register_software,
    revoke_software_maintenance,
    update_software,
    usable_project_repositories,
)
from utils.permissions import IsProjectManager, IsProjectMember
from utils.response import success_response


class SoftwareViewSet(viewsets.GenericViewSet):
    serializer_class = SoftwareSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    lookup_value_converter = "uuid"
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["repository", "is_active"]
    search_fields = ["name", "slug", "repository__name"]

    def get_queryset(self):
        queryset = Software.objects.select_related("repository", "owner").prefetch_related(
            Prefetch(
                "maintainer_grants",
                queryset=SoftwareMaintainer.objects.select_related("user").order_by("user__username"),
            ),
        )
        user = self.request.user
        if getattr(self, "swagger_fake_view", False) or not user.is_authenticated:
            return queryset.none()
        if user.is_superuser:
            return queryset
        owned = Repository.objects.filter(owned_repositories(user)).values("pk")
        return queryset.filter(
            Q(owner=user)
            | Q(maintainer_grants__user=user)
            | Q(repository_id__in=owned)
            | Q(project_links__project_id__in=visible_project_ids(user))
        ).distinct()

    def list(self, request: Request, *args, **kwargs) -> Response:
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()))
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        return success_response(self.get_serializer(self.get_object()).data)

    def create(self, request: Request, *args, **kwargs) -> Response:
        inputs = SoftwareRegistrationSerializer(data=request.data)
        inputs.is_valid(raise_exception=True)
        software = register_software(request.user, **inputs.validated_data)
        return success_response(self.get_serializer(software).data, "登记成功", status=status.HTTP_201_CREATED)

    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        inputs = SoftwareUpdateSerializer(data=request.data)
        inputs.is_valid(raise_exception=True)
        software = update_software(self.get_object(), request.user, inputs.validated_data)
        return success_response(self.get_serializer(software).data, "更新成功")

    @action(detail=True, methods=["post"], url_path="maintainers")
    def grant_maintainer(self, request: Request, pk: UUID) -> Response:
        inputs = SoftwareGrantSerializer(data=request.data)
        inputs.is_valid(raise_exception=True)
        software = grant_software_maintenance(self.get_object(), request.user, **inputs.validated_data)
        return success_response(self.get_serializer(software).data, "已授权")

    @action(detail=True, methods=["delete"], url_path="maintainers/<uuid:user_id>")
    def revoke_maintainer(self, request: Request, pk: UUID, user_id: UUID) -> Response:
        software = revoke_software_maintenance(self.get_object(), request.user, user_id)
        return success_response(self.get_serializer(software).data, "已撤销")


class ProjectSoftwareViewSet(
    NestedProjectPermissionMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """项目内软件选用、候选与启停。"""

    serializer_class = ProjectSoftwareSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = None

    def get_permissions(self):
        if self.action in {"create", "available", "partial_update"}:
            return [IsAuthenticated(), IsProjectManager()]
        return super().get_permissions()

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ProjectSoftware.objects.none()
        project = self.get_parent_project()
        queryset = ProjectSoftware.objects.filter(project=project).select_related(
            "project",
            "software__repository",
        )
        if self.request.query_params.get("active") == "true":
            queryset = queryset.filter(
                is_active=True,
                software__is_active=True,
                software__repository_id__in=usable_project_repositories(project),
            )
        return queryset.order_by("software__name", "software__slug", "id")

    def _serialize_selections(self, instance, *, many: bool = False):
        """批量核验当前用户可见的仓库和目标项目可用的仓库。"""
        records = list(instance) if many else [instance]
        repository_ids = {record.software.repository_id for record in records}
        context = self.get_serializer_context()
        context["visible_repository_ids"] = set(
            visible_repository_ids(self.request.user).filter(id__in=repository_ids).values_list("id", flat=True)
        )
        context["usable_repository_ids"] = set(
            usable_project_repositories(self.get_parent_project())
            .filter(id__in=repository_ids)
            .values_list(
                "id",
                flat=True,
            )
        )
        return self.get_serializer(records if many else instance, many=many, context=context).data

    def list(self, request: Request, *args, **kwargs) -> Response:
        return success_response(self._serialize_selections(self.get_queryset(), many=True))

    def available(self, request: Request, *args, **kwargs) -> Response:
        project = self.get_parent_project()
        candidates = (
            Software.objects.filter(
                repository_id__in=usable_project_repositories(project),
                is_active=True,
            )
            .exclude(project_links__project=project)
            .select_related("repository")
        )
        return success_response(SoftwareSummarySerializer(candidates, many=True).data)

    def create(self, request: Request, *args, **kwargs) -> Response:
        inputs = ProjectSoftwareSelectionSerializer(data=request.data)
        inputs.is_valid(raise_exception=True)
        project = self.get_parent_project()
        software = get_object_or_404(
            Software,
            pk=inputs.validated_data["software"],
            repository_id__in=active_project_repositories(project),
        )
        link, created = change_project_selection(project, software, request.user, True, allow_create=True)
        return success_response(
            self._serialize_selections(link),
            "已选用软件",
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        inputs = ProjectSoftwareStateSerializer(data=request.data)
        inputs.is_valid(raise_exception=True)
        previous = get_object_or_404(self.get_queryset(), pk=self.kwargs["pk"])
        link, _ = change_project_selection(previous.project, previous.software, request.user, **inputs.validated_data)
        return success_response(self._serialize_selections(link), "已更新选用状态")
