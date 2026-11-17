"""软件登记、共享维护与项目使用规则。"""

from uuid import UUID

from django.db import transaction
from django.db.models import Q, QuerySet
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.account.models import User
from apps.project.models import Project, ProjectComponent, ProjectMember
from apps.project.services import repository_owner, repository_owner_association_error, visible_repository_ids
from apps.repository.models import Repository
from apps.software.models import ProjectSoftware, Software, SoftwareMaintainer
from utils.permissions import IsProjectManager, ProjectRolePermission


def can_manage_software(software: Software, user: User) -> bool:
    """维护负责人和超管负责授权与停用。"""
    return user.is_superuser or software.owner_id == user.pk


def can_maintain_software(software: Software, user: User) -> bool:
    """共享资料和配置维护仅依据软件自身授权。"""
    return can_manage_software(software, user) or software.maintainer_grants.filter(user=user).exists()


def owned_repositories(user: User) -> Q:
    """与现有仓库所有者定义一致，兼容只有凭证归属的旧仓库。"""
    return Q(created_by=user) | Q(created_by__isnull=True, credential__owner=user)


def _lock_software(software: Software) -> Software:
    get_object_or_404(Repository.objects.select_for_update(no_key=True), pk=software.repository_id)
    return get_object_or_404(Software.objects.select_for_update(), pk=software.pk)


def _active_account(username: str) -> User:
    account = User.objects.filter(username=username, is_active=True).first()
    if account is None:
        raise ValidationError({"detail": "找不到该启用账号。请核对登录名。"})
    return account


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
    if {"owner_username", "is_active"} & values.keys() and not can_manage_software(software, user):
        raise PermissionDenied("只有软件维护负责人可以移交负责人或启停软件。")
    if "owner_username" in values:
        owner = _active_account(values.pop("owner_username"))
        software.maintainer_grants.filter(user=owner).delete()
        values["owner"] = owner
    for field, value in values.items():
        setattr(software, field, value)
    if values:
        software.save(update_fields=[*values, "updated_at"])
    return software


@transaction.atomic
def grant_software_maintenance(software: Software, actor: User, username: str) -> Software:
    software = _lock_software(software)
    if not can_manage_software(software, actor):
        raise PermissionDenied("只有软件维护负责人可以管理协作维护授权。")
    user = _active_account(username)
    if user.pk == software.owner_id:
        raise ValidationError({"detail": "软件维护负责人已拥有维护权限。"})
    SoftwareMaintainer.objects.get_or_create(software=software, user=user, defaults={"granted_by": actor})
    return software


@transaction.atomic
def revoke_software_maintenance(software: Software, actor: User, user_id: UUID) -> Software:
    software = _lock_software(software)
    if not can_manage_software(software, actor):
        raise PermissionDenied("只有软件维护负责人可以管理协作维护授权。")
    software.maintainer_grants.filter(user_id=user_id).delete()
    return software


def active_project_repositories(project: Project) -> QuerySet:
    """保留项目仓库关联作为仓库可见性与凭证解析依据。"""
    return ProjectComponent.objects.filter(project=project, is_active=True).values("repository_id")


def usable_project_repositories(project: Project) -> QuerySet:
    """候选目录与仅启用筛选使用同一仓库及所有者入项规则。"""
    repos = Repository.objects.filter(pk__in=active_project_repositories(project))
    if project.status != 1:
        return repos.none()
    members = ProjectMember.objects.filter(project=project).values("user_id")
    creator_in_project = Q(created_by_id__in=members)
    credential_owner_in_project = Q(credential__owner_id__in=members)
    if project.leader_id:
        creator_in_project |= Q(created_by_id=project.leader_id)
        credential_owner_in_project |= Q(credential__owner_id=project.leader_id)
    return repos.filter(creator_in_project | (Q(created_by__isnull=True) & credential_owner_in_project)).values("id")


def _check_software_available(project: Project, software: Software) -> None:
    if project.status != 1:
        raise ValidationError({"detail": "项目已停用。"})
    if not software.is_active:
        raise ValidationError({"detail": "软件已停用。"})
    if not active_project_repositories(project).filter(repository_id=software.repository_id).exists():
        raise ValidationError({"detail": "软件的主仓库未在当前项目下启用。"})
    if error := repository_owner_association_error(software.repository, project):
        raise ValidationError({"detail": error})


def require_project_software(
    project: Project,
    software: Software,
    user: User,
    permission: ProjectRolePermission,
) -> ProjectSoftware:
    """校验一次新的软件使用。写操作须在仓库锁内调用并保存结果。"""
    if not permission._check(project, user):
        raise PermissionDenied("没有在当前项目使用软件的权限。")
    link = (
        ProjectSoftware.objects.select_related(
            "project", "software__repository__created_by", "software__repository__credential__owner"
        )
        .filter(project=project, software=software, is_active=True)
        .first()
    )
    if link is None:
        raise ValidationError({"detail": "当前项目尚未启用选用此软件。"})
    _check_software_available(link.project, link.software)
    return link


@transaction.atomic
def change_project_selection(
    project: Project,
    software: Software,
    user: User,
    is_active: bool,
    *,
    allow_create: bool = False,
) -> tuple[ProjectSoftware, bool]:
    """按仓库→软件→项目顺序锁定，停用时保存原关联。"""
    software = _lock_software(software)
    project = get_object_or_404(Project.objects.select_for_update(no_key=True), pk=project.pk)
    if not IsProjectManager()._check(project, user):
        raise PermissionDenied("没有管理当前项目软件选用的权限。")
    if is_active:
        _check_software_available(project, software)
    link = ProjectSoftware.objects.filter(project=project, software=software).first()
    if link is None:
        if not allow_create:
            raise NotFound("项目软件关联不存在。")
        return ProjectSoftware.objects.create(project=project, software=software), True
    if link.is_active != is_active:
        link.is_active = is_active
        link.save(update_fields=["is_active", "updated_at"])
    return link, False
