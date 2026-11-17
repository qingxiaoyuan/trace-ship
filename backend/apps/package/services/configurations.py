"""共享配置的项目使用与锁定规则。"""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.package.models import PackageConfig
from apps.project.services import visible_project_ids
from apps.repository.models import Repository
from apps.software.models import ProjectSoftware
from apps.software.services import can_maintain_software, require_project_software, usable_project_repositories
from utils.permissions import IsProjectPackageAdmin

CONFIG_RELATIONS = (
    "project_component__project", "project_component__repository",
    "software__repository", "image", "node", "svn_credential",
)


def lock_package_config(config: PackageConfig) -> PackageConfig:
    """事务内按仓库、配置的顺序锁定，再读取当前配置关系。"""
    repository_id = config.source_repository_id
    get_object_or_404(Repository.objects.select_for_update(no_key=True), pk=repository_id)
    get_object_or_404(PackageConfig.objects.select_for_update().only("id"), pk=config.pk)
    current = PackageConfig.objects.select_related(*CONFIG_RELATIONS).get(pk=config.pk)
    if current.source_repository_id != repository_id:
        raise ValidationError({"config": "配置的仓库已变更，请刷新后重试。"})
    return current


def require_shared_config(config: PackageConfig, *, project, software, user, permission) -> ProjectSoftware:
    """在显式项目上下文中核验启用的软件与同软件配置。"""
    link = require_project_software(project, software, user, permission)
    if config.software_id != link.software_id:
        raise ValidationError({"config": "请选择当前软件的打包配置。"})
    if not config.is_active:
        raise ValidationError({"config": "打包配置已停用。"})
    return link


def can_maintain_config(user, *, software=None, component=None) -> bool:
    if software is not None:
        return can_maintain_software(software, user)
    return component is not None and IsProjectPackageAdmin()._check(component.project, user)


def require_config_maintenance(user, *, software=None, component=None) -> None:
    if not can_maintain_config(user, software=software, component=component):
        raise PermissionDenied("没有维护此打包配置的权限。")


def selected_project_software(user, project=None):
    """按当前显式可见项目和启用选用筛选共享配置。"""
    links = ProjectSoftware.objects.filter(
        project_id__in=visible_project_ids(user), project__status=1, software__is_active=True, is_active=True,
    )
    if project is not None:
        links = links.filter(project=project, software__repository_id__in=usable_project_repositories(project))
    return links


def visible_configs(user):
    queryset = PackageConfig.objects.select_related(*CONFIG_RELATIONS)
    if user.is_superuser:
        return queryset
    maintained = Q(software__owner=user) | Q(software__maintainer_grants__user=user)
    selected = Q(software_id__in=selected_project_software(user).values("software_id"))
    legacy = Q(project_component__project_id__in=visible_project_ids(user))
    return queryset.filter(maintained | selected | legacy).distinct()
