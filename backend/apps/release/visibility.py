"""发布源记录权限与共享软件的已发布读取范围。"""

from django.db.models import Case, OuterRef, Q, Subquery, UUIDField, Value, When

from apps.project.services import visible_project_ids
from apps.software.models import ProjectSoftware


def releases_for_read(queryset, user, project_id=None):
    """选用项目只共享该软件已发布版本，发起项目仍保留原申请范围。"""
    projects = visible_project_ids(user)
    origin = Q(project_id__in=projects)
    links = ProjectSoftware.objects.filter(project_id__in=projects, is_active=True)
    if project_id is not None:
        origin &= Q(project_id=project_id)
        links = links.filter(project_id=project_id)
    shared = Q(status="released", software_id__in=links.values("software_id"))
    # 未指定目标项目时，固定选取一个有权项目供深链恢复查看上下文。
    target = links.filter(software_id=OuterRef("software_id")).order_by("project_id")
    return queryset.filter(origin | shared).annotate(
        origin_read=Case(When(origin, then=Value(True)), default=Value(False)),
        shared_project_id=Subquery(target.values("project_id")[:1], output_field=UUIDField()),
        shared_project_name=Subquery(target.values("project__name")[:1]),
    )
