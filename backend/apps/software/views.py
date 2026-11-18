"""软件目录公开 REST 接口。"""

from django.db.models import Count, F, OuterRef, Q, Subquery
from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema
from rest_framework import filters, mixins, status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.package.services.configurations import visible_configs
from apps.project.services import visible_repository_ids
from apps.project.views import NestedProjectPermissionMixin
from apps.release.models import ReleaseRecord
from apps.release.visibility import releases_for_read
from apps.repository.models import Repository
from apps.software.models import Software
from apps.software.serializers import (
    ProjectSoftwareSerializer,
    SoftwareRegistrationSerializer,
    SoftwareSerializer,
    SoftwareUpdateSerializer,
)
from apps.software.services import (
    owned_repositories,
    register_software,
    update_software,
    usable_project_repositories,
)
from utils.permissions import IsProjectMember
from utils.response import success_response


class SoftwareViewSet(viewsets.GenericViewSet):
    serializer_class = SoftwareSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "head", "options"]
    lookup_value_converter = "uuid"
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ["repository", "is_active"]
    search_fields = ["name", "slug", "repository__name"]

    def get_queryset(self):
        queryset = Software.objects.select_related(
            "repository__created_by", "repository__credential__owner", "owner",
        )
        user = self.request.user
        if getattr(self, "swagger_fake_view", False) or not user.is_authenticated:
            return queryset.none()
        if user.is_superuser:
            return queryset
        owned = Repository.objects.filter(owned_repositories(user)).values("pk")
        return queryset.filter(Q(repository_id__in=owned) | Q(repository_id__in=visible_repository_ids(user)))

    def list(self, request: Request, *args, **kwargs) -> Response:
        releases = releases_for_read(ReleaseRecord.objects.all(), request.user).filter(
            software_id=OuterRef("pk"), status="released", release_type="formal",
        ).order_by(F("released_at").desc(nulls_last=True), "-created_at", "-pk")
        configs = visible_configs(request.user).filter(software_id=OuterRef("pk")).order_by().values("software_id")
        page = self.paginate_queryset(self.filter_queryset(self.get_queryset()).annotate(
            latest_release_version=Subquery(releases.values("version")[:1]),
            latest_release_tag=Subquery(releases.values("tag_name")[:1]),
            package_config_count=Subquery(configs.annotate(total=Count("pk")).values("total")),
        ))
        return self.get_paginated_response(self.get_serializer(page, many=True).data)

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        return success_response(self.get_serializer(self.get_object()).data)

    @extend_schema(request=SoftwareRegistrationSerializer, responses={201: SoftwareSerializer})
    def create(self, request: Request, *args, **kwargs) -> Response:
        inputs = SoftwareRegistrationSerializer(data=request.data)
        inputs.is_valid(raise_exception=True)
        software = register_software(request.user, **inputs.validated_data)
        return success_response(self.get_serializer(software).data, "登记成功", status=status.HTTP_201_CREATED)

    @extend_schema(request=SoftwareUpdateSerializer, responses={200: SoftwareSerializer})
    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        inputs = SoftwareUpdateSerializer(data=request.data)
        inputs.is_valid(raise_exception=True)
        software = update_software(self.get_object(), request.user, inputs.validated_data)
        return success_response(self.get_serializer(software).data, "更新成功")


class ProjectSoftwareViewSet(NestedProjectPermissionMixin, mixins.ListModelMixin, viewsets.GenericViewSet):
    """列出项目关联仓库中的软件。"""

    serializer_class = ProjectSoftwareSerializer
    permission_classes = [IsAuthenticated, IsProjectMember]
    pagination_class = None

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Software.objects.none()
        project = self.get_parent_project()
        repos = usable_project_repositories(project)
        queryset = Software.objects.filter(
            repository__project_components__project=project,
            repository__project_components__is_active=True,
        ).select_related("repository").distinct()
        if self.request.query_params.get("active") == "true":
            queryset = queryset.filter(is_active=True, repository_id__in=repos)
        return queryset

    def list(self, request: Request, *args, **kwargs) -> Response:
        context = self.get_serializer_context()
        context["usable_repository_ids"] = set(
            usable_project_repositories(self.get_parent_project()).values_list("repository_id", flat=True)
        )
        return success_response(self.get_serializer(self.get_queryset(), many=True, context=context).data)
