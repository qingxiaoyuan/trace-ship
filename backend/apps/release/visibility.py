"""发布源记录权限与共享软件的已发布读取范围。"""

from django.db.models import Case, CharField, Exists, OuterRef, Q, Subquery, UUIDField, Value, When
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast, Coalesce, Replace

from apps.package.models import PackageTask
from apps.project.models import Project
from apps.project.services import visible_project_ids
from apps.release.models import OaArchiveApplication
from apps.software.services import usable_software_components


def _consumed_release_projects(projects):
    """以本项目已有的打包任务或归档保留单条版本的历史访问。"""
    tasks = PackageTask.objects.filter(
        release_id=OuterRef(OuterRef("pk")), project_id=OuterRef("pk"),
        software_id=OuterRef(OuterRef("software_id")), repository_id=OuterRef(OuterRef("repository_id")),
    )
    archives = OaArchiveApplication.objects.filter(release_id=OuterRef(OuterRef("pk")), task__isnull=True).alias(
        source_project=Replace(KeyTextTransform("project_id", "source"), Value("-"), Value(""), output_field=CharField()),
    ).filter(source_project=Replace(Cast(OuterRef("pk"), CharField()), Value("-"), Value("")))
    return Project.objects.filter(pk__in=projects).filter(Exists(tasks) | Exists(archives)).order_by("pk")


def releases_for_read(queryset, user, project_id=None, *, include_consumed_links=False):
    """当前可用的仓库软件共享已发布版本，发起项目保留原申请范围。"""
    projects = visible_project_ids(user)
    if project_id is not None:
        projects = projects.filter(pk=project_id)
    origin = Q(project_id__in=projects)
    active = usable_software_components().filter(
        project_id__in=projects, repository_id=OuterRef("repository_id"),
        repository__software__pk=OuterRef("software_id"), repository__software__is_active=True,
    ).order_by("project_id", "pk")
    active_scope = Exists(active)
    shared_scope = Q(active_scope)
    shared_project = Subquery(active.values("project_id")[:1], output_field=UUIDField())
    shared_name = Subquery(active.values("project__name")[:1])
    if include_consumed_links:
        consumed = _consumed_release_projects(projects)
        shared_scope |= Exists(consumed)
        shared_project = Coalesce(shared_project, Subquery(consumed.values("pk")[:1], output_field=UUIDField()))
        shared_name = Coalesce(shared_name, Subquery(consumed.values("name")[:1]))

    shared = Q(status="released", software_id__isnull=False) & shared_scope
    return queryset.filter(origin | shared).annotate(
        origin_read=Case(When(origin, then=Value(True)), default=Value(False)),
        shared_project_id=shared_project,
        shared_project_name=shared_name,
        shared_project_active=active_scope,
    )
