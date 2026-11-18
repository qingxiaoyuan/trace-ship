"""软件登记、共享维护与项目使用规则。"""

from dataclasses import dataclass
from uuid import UUID

from django.db import transaction
from django.db.models import Q, QuerySet
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.account.models import User
from apps.project.models import Project
from apps.project.services import (
    repository_owner,
    repository_use_error,
    usable_project_components,
    visible_repository_ids,
)
from apps.repository.models import Repository
from apps.software.models import Software
from utils.permissions import ProjectRolePermission


def can_manage_software(software: Software, user: User) -> bool:
    """软件资料由主仓库所有者维护。"""
    owner = repository_owner(software.repository)
    return user.is_superuser or (owner is not None and owner.pk == user.pk)


def can_maintain_software(software: Software, user: User) -> bool:
    return can_manage_software(software, user)


def owned_repositories(user: User) -> Q:
    """与现有仓库所有者定义一致，兼容只有凭证归属的旧仓库。"""
    return Q(created_by=user) | Q(created_by__isnull=True, credential__owner=user)


def _lock_software(software: Software) -> Software:
    get_object_or_404(Repository.objects.select_for_update(no_key=True), pk=software.repository_id)
    return get_object_or_404(Software.objects.select_for_update(), pk=software.pk)


@transaction.atomic
def register_software(user: User, repository: UUID, slug: str, name: str, description: str = "") -> Software:
    """锁定主仓库，确保并发登记时同一标识只有一个身份。"""
    repositories = Repository.objects.select_for_update(no_key=True)
    if not user.is_superuser:
        owned_ids = Repository.objects.filter(owned_repositories(user)).values("pk")
        repositories = repositories.filter(Q(pk__in=owned_ids) | Q(pk__in=visible_repository_ids(user)))
    repo = get_object_or_404(repositories, pk=repository)
    owner = repository_owner(repo)
    if owner is None:
        if not user.is_superuser:
            raise PermissionDenied("只有主仓库所有者可以登记软件。")
        raise ValidationError({"detail": "请先设置仓库所有者。"})
    if not user.is_superuser and owner.pk != user.pk:
        raise PermissionDenied("只有主仓库所有者可以登记软件。")
    if Software.objects.filter(repository=repo, slug=slug).exists():
        raise ValidationError({"detail": "当前主仓库已使用该软件标识。"})
    return Software.objects.create(repository=repo, slug=slug, name=name, description=description, owner=owner)


@transaction.atomic
def update_software(software: Software, user: User, values: dict) -> Software:
    """同仓库锁内更新资料和启停状态。"""
    software = _lock_software(software)
    if not can_maintain_software(software, user):
        raise PermissionDenied("没有维护此软件的权限。")
    for field, value in values.items():
        setattr(software, field, value)
    if values:
        software.save(update_fields=[*values, "updated_at"])
    return software


def usable_software_components() -> QuerySet:
    return usable_project_components()


def usable_project_repositories(project: Project) -> QuerySet:
    """候选目录与仅启用筛选使用同一仓库及所有者入项规则。"""
    return usable_software_components().filter(project=project).order_by().values("repository_id")


def _check_software_available(project: Project, software: Software) -> None:
    if error := repository_use_error(
        project, software.repository, inactive_message="项目已停用。",
        unlinked_message="软件的主仓库未在当前项目下启用。",
    ):
        raise ValidationError({"detail": error})
    if not software.is_active:
        raise ValidationError({"detail": "软件已停用。"})


@dataclass(frozen=True)
class ProjectSoftwareContext:
    project: Project
    software: Software


def require_project_software(
    project: Project,
    software: Software,
    user: User,
    permission: ProjectRolePermission,
) -> ProjectSoftwareContext:
    """校验一次新的软件使用。写操作须在仓库锁内调用并保存结果。"""
    if not permission._check(project, user):
        raise PermissionDenied("没有在当前项目使用软件的权限。")
    if project is None:
        raise NotFound("项目已删除")
    software = get_object_or_404(
        Software.objects.select_related("repository__created_by", "repository__credential__owner"),
        pk=software.pk,
    )
    _check_software_available(project, software)
    return ProjectSoftwareContext(project, software)
