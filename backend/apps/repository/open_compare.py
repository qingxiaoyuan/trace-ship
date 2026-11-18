"""开放 Tag 比较的已发布来源、凭证和固定提交核验。"""

import re

from apps.project.models import Project, ProjectComponent
from apps.project.services import is_repository_owner_in_project
from apps.release.models import ReleaseRecord
from apps.release.services import list_tags_cached
from apps.repository.models import Repository
from apps.repository.services import RepositoryService
from apps.software.models import Software
from apps.software.services import usable_software_components
from utils.provider.credential_resolver import resolve_credential
from utils.provider.factory import get_provider


class OpenTagCompareError(Exception):
    """可返回给调用方的 Tag 比较业务错误。"""

    def __init__(self, code, message, *, status=400):
        super().__init__(message)
        self.code = code
        self.status = status


def compare_published_tags(params):
    """软件比较核验已发布 Tag 与固定 SHA，保留旧仓库入口的范围。"""
    repository_id = params.get("repository_id")
    software_id = params.get("software_id")
    from_tag = params["from_tag"]
    to_tag = params["to_tag"]
    if not (repository_id or software_id):
        raise OpenTagCompareError(40001, "请输入 from_tag、to_tag，并指定 software_id 或 repository_id")

    software = None
    fixed_hashes: dict[str, str] = {}
    if software_id:
        software = Software.objects.filter(pk=software_id).first()
        if software is None or (repository_id and software.repository_id != repository_id):
            raise OpenTagCompareError(40404, "软件不在指定仓库中", status=404)
        repository_id = software.repository_id
        tags = {from_tag, to_tag}
        known = list(ReleaseRecord.objects.filter(
            software=software, repository_id=repository_id, status="released", tag_name__in=tags,
        ).order_by().values_list("tag_name", "git_hash").distinct())
        if {tag for tag, _ in known} != tags:
            raise OpenTagCompareError(40404, "未找到该软件对应的已发布 Tag", status=404)
        if len(known) != len(tags) or any(not re.fullmatch(r"[a-fA-F0-9]{40}|[a-fA-F0-9]{64}", sha) for _, sha in known):
            raise OpenTagCompareError(40901, "已发布 Tag 缺少唯一的完整源码 SHA", status=409)
        fixed_hashes = dict(known)

    repo = Repository.objects.filter(pk=repository_id).first()
    if repo is None:
        raise OpenTagCompareError(40404, "仓库不存在", status=404)
    branch = params.get("branch", "").strip() or repo.default_branch

    project = None
    # project_id 为准；product_id 为旧参数名，保留兼容
    project_id = params.get("project_id") or params.get("product_id")
    selections = usable_software_components().filter(repository=repo)
    if software and not software.is_active:
        selections = selections.none()
    if project_id:
        project = Project.objects.filter(pk=project_id).first()
        if project is None:
            raise OpenTagCompareError(40404, "项目不存在", status=404)
        if software and not selections.filter(project=project).exists():
            raise OpenTagCompareError(40404, "项目未选用该软件", status=404)
    else:
        components = ProjectComponent.objects.filter(repository=repo, is_active=True)
        if software:
            components = components.filter(project_id__in=selections.values("project_id"))
        component = components.select_related("project").first()
        project = component.project if component else None
    if project is None or not is_repository_owner_in_project(repo, project):
        raise OpenTagCompareError(
            40301,
            "仓库所有者不在关联项目成员中，无法使用该仓库凭证",
            status=403,
        )

    server_url = RepositoryService._resolve_server_url(repo)
    cred_data = resolve_credential(repo, project=project, operation="read")
    provider = get_provider(repo.vendor, server_url, cred_data)

    # 软件比较当前核验远端指向；原仓库查询继续使用短 TTL 缓存。
    remote_tags = (provider.list_tags(repo.external_identity) if fixed_hashes else
                   list_tags_cached(provider, repo.external_identity))
    tag_map = {t.name: t for t in remote_tags}
    from_info = tag_map.get(from_tag)
    to_info = tag_map.get(to_tag)
    if from_info is None or to_info is None:
        missing = from_tag if from_info is None else to_tag
        raise OpenTagCompareError(40404, f"tag 不存在: {missing}", status=404)

    from_ref, to_ref = from_tag, to_tag
    from_sha, to_sha = from_info.commit_hash, to_info.commit_hash
    if fixed_hashes:
        from_ref, to_ref = fixed_hashes[from_tag], fixed_hashes[to_tag]
        if (from_sha.lower(), to_sha.lower()) != (from_ref.lower(), to_ref.lower()):
            raise OpenTagCompareError(40901, "远端 Tag 指向与发布保存的固定源码不一致", status=409)
        from_sha, to_sha = from_ref, to_ref
    commits = provider.compare_commits(repo.external_identity, from_ref, to_ref)
    mrs = provider.list_merge_requests(
        repo.external_identity,
        branch,
        since=from_info.created_at,
    )
    if to_info.created_at is not None:
        mrs = [
            mr for mr in mrs
            if mr.merged_at is not None and mr.merged_at <= to_info.created_at
        ]

    return {
        "repository_name": repo.name,
        "software_id": str(software.pk) if software else None,
        "software_name": software.name if software else None,
        "software_slug": software.slug if software else None,
        "project_name": project.name if project else "",
        "from_tag": from_tag,
        "to_tag": to_tag,
        "branch": branch,
        "from_git_hash": from_sha,
        "to_git_hash": to_sha,
        "commits": [
            {
                "hash": c.hash,
                "author": c.author,
                "message": c.message,
                "committed_at": c.committed_at,
            }
            for c in commits
        ],
        "mrs": [
            {
                "number": mr.number,
                "title": mr.title,
                "author": mr.author,
                "source_branch": mr.source_branch,
                "target_branch": mr.target_branch,
                "merged_at": mr.merged_at,
                "web_url": mr.web_url,
            }
            for mr in mrs
        ],
    }
