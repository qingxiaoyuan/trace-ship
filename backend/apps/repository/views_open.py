"""
仓库模块对外开放接口

供外部系统通过 Access Token 调用，只读。
挂 /api/open/ 前缀（见 config/urls_open.py）。
"""
import re

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.release.models import ReleaseRecord
from apps.repository.models import Repository
from apps.software.models import ProjectSoftware, Software
from utils.authentication import AccessTokenAuthentication
from utils.permissions import HasAccessTokenScope
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider
from utils.response import error_response, success_response


class TagCompareQuery(serializers.Serializer):
    repository_id = serializers.UUIDField(required=False)
    software_id = serializers.UUIDField(required=False)
    project_id = serializers.UUIDField(required=False)
    product_id = serializers.UUIDField(required=False)
    from_tag = serializers.CharField()
    to_tag = serializers.CharField()
    branch = serializers.CharField(required=False, allow_blank=True)


class OpenTagCompareView(APIView):
    """
    查询两个 tag 之间的 commits 与 MRs（scope: repo.compare）

    GET /api/open/compare/?repository_id=<id>&from_tag=<a>&to_tag=<b>[&branch=<分支>]

    commits 走 GitLab compare 接口；MRs 按目标分支拉取 from_tag 时间之后
    合并的 MR，再按 merged_at <= to_tag 时间过滤。branch 缺省用仓库默认分支。
    """

    authentication_classes = [AccessTokenAuthentication]
    permission_classes = [HasAccessTokenScope]
    open_scope = "repo.compare"

    @extend_schema(parameters=[
        OpenApiParameter("repository_id", str, description="来源仓库 UUID，与 software_id 至少填写一项"),
        OpenApiParameter("software_id", str, description="软件 UUID，两端须为该软件的已发布 Tag"),
        OpenApiParameter("from_tag", str, required=True),
        OpenApiParameter("to_tag", str, required=True),
        OpenApiParameter("branch", str),
        OpenApiParameter("project_id", str, description="用于解析仓库凭证的项目 UUID"),
        OpenApiParameter("product_id", str, description="project_id 的历史参数名"),
    ], responses={200: dict})
    def get(self, request: Request) -> Response:
        """比较指定仓库两个 tag 之间的提交与 MR"""
        raw = request.query_params
        query = TagCompareQuery(data={key: value.strip() for key, value in raw.items() if value.strip()})
        query.is_valid(raise_exception=True)
        params = query.validated_data
        repository_id = params.get("repository_id")
        software_id = params.get("software_id")
        from_tag = params["from_tag"]
        to_tag = params["to_tag"]
        if not (repository_id or software_id):
            return error_response(40001, "请输入 from_tag、to_tag，并指定 software_id 或 repository_id")

        software = None
        fixed_hashes: dict[str, str] = {}
        if software_id:
            software = Software.objects.filter(pk=software_id).first()
            if software is None or (repository_id and software.repository_id != repository_id):
                return error_response(40404, "软件不在指定仓库中", status_code=404)
            repository_id = software.repository_id
            tags = {from_tag, to_tag}
            known = list(ReleaseRecord.objects.filter(
                software=software, repository_id=repository_id, status="released", tag_name__in=tags,
            ).order_by().values_list("tag_name", "git_hash").distinct())
            if {tag for tag, _ in known} != tags:
                return error_response(40404, "未找到该软件对应的已发布 Tag", status_code=404)
            if len(known) != len(tags) or any(not re.fullmatch(r"[a-fA-F0-9]{40}|[a-fA-F0-9]{64}", sha) for _, sha in known):
                return error_response(40901, "已发布 Tag 缺少唯一的完整源码 SHA", status_code=409)
            fixed_hashes = dict(known)

        repo = Repository.objects.filter(pk=repository_id).first()
        if repo is None:
            return error_response(40404, "仓库不存在", status_code=404)
        branch = params.get("branch", "").strip() or repo.default_branch

        from apps.project.models import Project, ProjectComponent
        from apps.project.services import is_repository_owner_in_project

        project = None
        # project_id 为准；product_id 为旧参数名，保留兼容
        project_id = params.get("project_id") or params.get("product_id")
        selections = ProjectSoftware.objects.filter(software=software, is_active=True)
        if project_id:
            project = Project.objects.filter(pk=project_id).first()
            if project is None:
                return error_response(40404, "项目不存在", status_code=404)
            if software and not selections.filter(project=project).exists():
                return error_response(40404, "项目未选用该软件", status_code=404)
        else:
            components = ProjectComponent.objects.filter(repository=repo, is_active=True)
            if software:
                components = components.filter(project_id__in=selections.values("project_id"))
            component = components.select_related("project").first()
            project = component.project if component else None
        if project is None or not is_repository_owner_in_project(repo, project):
            return error_response(
                40301,
                "仓库所有者不在关联项目成员中，无法使用该仓库凭证",
                status_code=403,
            )

        try:
            from apps.repository.services import RepositoryService

            server_url = RepositoryService._resolve_server_url(repo)
            cred_data = resolve_credential(repo, project=project, operation="read")
            provider = get_provider(repo.vendor, server_url, cred_data)

            # 软件比较当前核验远端指向；原仓库查询继续使用短 TTL 缓存。
            from apps.release.services import list_tags_cached

            remote_tags = (provider.list_tags(repo.external_identity) if fixed_hashes else
                           list_tags_cached(provider, repo.external_identity))
            tag_map = {t.name: t for t in remote_tags}
            from_info = tag_map.get(from_tag)
            to_info = tag_map.get(to_tag)
            if from_info is None or to_info is None:
                missing = from_tag if from_info is None else to_tag
                return error_response(40404, f"tag 不存在: {missing}", status_code=404)

            from_ref, to_ref = from_tag, to_tag
            from_sha, to_sha = from_info.commit_hash, to_info.commit_hash
            if fixed_hashes:
                from_ref, to_ref = fixed_hashes[from_tag], fixed_hashes[to_tag]
                if (from_sha.lower(), to_sha.lower()) != (from_ref.lower(), to_ref.lower()):
                    return error_response(40901, "远端 Tag 指向与发布保存的固定源码不一致", status_code=409)
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
        except ProviderError as exc:
            return error_response(50201, f"GitLab 调用失败: {exc}", status_code=502)

        return success_response({
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
        })
