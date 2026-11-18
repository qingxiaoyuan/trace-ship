"""以实际任务项目隔离 SVN 交付目录及其子树。"""

from hashlib import sha256

from django.db import transaction
from django.db.models import Q

from apps.package.models import PackageSvnNamespace, PackageSvnTarget, PackageTask
from utils.provider.svn_path import svn_target


class SvnTargetConflict(RuntimeError):
    """目录当前无法安全归属于这一项目。"""


_CONFLICT = "SVN 目录与已有交付范围冲突，无法在当前项目使用该目录"


def _historical_paths(server, *, excluding_project):
    """旧任务可保留真实目录证据，即使配置的 URL 或模板后来改变。"""
    tasks = PackageTask.objects.filter(stage_info__svn_push__remote_url__isnull=False).exclude(
        project_id=excluding_project,
    )
    for stage in tasks.values_list("stage_info", flat=True).iterator():
        try:
            saved_server, saved_path = svn_target(stage["svn_push"]["remote_url"])
        except (TypeError, ValueError):
            continue
        if saved_server == server:
            yield saved_path


def _overlaps(left, right):
    return not left or not right or left == right or left.startswith(right + "/") or right.startswith(left + "/")


def verify_svn_target(project_id, url):
    """读、写均拒绝跨项目访问相同目录、其父目录或子目录。"""
    try:
        server, path = svn_target(url)
    except (TypeError, ValueError) as exc:
        raise SvnTargetConflict("SVN 目录地址无效，无法核验") from exc
    parts = path.split("/")
    ancestors = {"/".join(parts[:depth]) for depth in range(len(parts) + 1)}
    claimed = PackageSvnTarget.objects.filter(namespace_id=server).exclude(project_id=project_id)
    if path:
        claimed = claimed.filter(Q(path__in=ancestors) | Q(path__startswith=path + "/"))
    if claimed.exists() or any(
        _overlaps(path, saved) for saved in _historical_paths(server, excluding_project=project_id)
    ):
        raise SvnTargetConflict(_CONFLICT)
    return server, path


@transaction.atomic(durable=True)
def reserve_svn_target(task, url):
    """先落库，再允许远端写入；未知提交结果也继续保留占用。"""
    server, _ = verify_svn_target(task.project_id, url)
    namespace, _ = PackageSvnNamespace.objects.get_or_create(pk=server)
    PackageSvnNamespace.objects.select_for_update().get(pk=namespace.pk)
    _, path = verify_svn_target(task.project_id, url)
    path_key = sha256(path.encode()).hexdigest()
    PackageSvnTarget.objects.get_or_create(
        namespace=namespace, path_key=path_key, project_id=task.project_id, defaults={"path": path},
    )
