"""发布源记录权限与共享软件的已发布读取范围。"""

from django.db.models import Case, CharField, Exists, OuterRef, Q, Subquery, UUIDField, Value, When
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast, Replace

from apps.package.models import PackageTask
from apps.project.services import visible_project_ids
from apps.release.models import OaArchiveApplication
from apps.software.models import ProjectSoftware


def _consumed_release_links(links):
    """已停用选用仅以本项目任务或保存的归档作为单条版本的读取依据。"""
    tasks = PackageTask.objects.filter(
        release_id=OuterRef(OuterRef("pk")), project_id=OuterRef("project_id"),
        software_id=OuterRef("software_id"), repository_id=OuterRef("software__repository_id"),
    )
    archives = OaArchiveApplication.objects.filter(release_id=OuterRef(OuterRef("pk")), task__isnull=True).alias(
        source_project=Replace(KeyTextTransform("project_id", "source"), Value("-"), Value(""), output_field=CharField()),
    ).filter(source_project=Replace(Cast(OuterRef("project_id"), CharField()), Value("-"), Value("")))
    return links.filter(Q(is_active=True) | Exists(tasks) | Exists(archives))


def releases_for_read(queryset, user, project_id=None, *, include_consumed_links=False):
    """选用项目只共享该软件已发布版本，发起项目仍保留原申请范围。"""
    projects = visible_project_ids(user)
    origin = Q(project_id__in=projects)
    links = ProjectSoftware.objects.filter(project_id__in=projects)
    if project_id is not None:
        origin &= Q(project_id=project_id)
        links = links.filter(project_id=project_id)
    # 未指定目标项目时优先使用启用的选用关系，再恢复已有消费历史的项目。
    target = links.filter(software_id=OuterRef("software_id")).order_by("-is_active", "project_id")
    target = _consumed_release_links(target) if include_consumed_links else target.filter(is_active=True)
    shared = Q(status="released") & Exists(target)
    return queryset.filter(origin | shared).annotate(
        origin_read=Case(When(origin, then=Value(True)), default=Value(False)),
        shared_project_id=Subquery(target.values("project_id")[:1], output_field=UUIDField()),
        shared_project_name=Subquery(target.values("project__name")[:1]),
        shared_project_active=Subquery(target.values("is_active")[:1]),
    )
