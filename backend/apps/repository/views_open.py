"""
仓库模块对外开放接口

供外部系统通过 Access Token 调用，只读。
挂 /api/open/ 前缀（见 config/urls_open.py）。
"""
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.repository.models import Repository
from utils.authentication import AccessTokenAuthentication
from utils.permissions import HasAccessTokenScope
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider
from utils.response import error_response, success_response


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

    def get(self, request: Request) -> Response:
        """比较指定仓库两个 tag 之间的提交与 MR"""
        params = request.query_params
        repository_id = params.get("repository_id", "").strip()
        from_tag = params.get("from_tag", "").strip()
        to_tag = params.get("to_tag", "").strip()
        if not repository_id or not from_tag or not to_tag:
            return error_response(40001, "缺少必填参数 repository_id、from_tag 或 to_tag")

        repo = Repository.objects.filter(id=repository_id).select_related("project").first()
        if repo is None:
            return error_response(40404, "仓库不存在", status_code=404)
        branch = params.get("branch", "").strip() or repo.default_branch

        from apps.project.models import ProductComponent, Project
        from apps.project.services import is_repository_owner_in_product

        product = None
        product_id = params.get("product_id", "").strip()
        if product_id:
            product = Project.objects.filter(id=product_id).first()
            if product is None:
                return error_response(40404, "产品不存在", status_code=404)
        elif repo.project_id:
            product = repo.project
        else:
            component = ProductComponent.objects.filter(
                repository=repo, is_active=True,
            ).select_related("project").first()
            product = component.project if component else None
        if product is None or not is_repository_owner_in_product(repo, product):
            return error_response(
                40301,
                "仓库所有者不在关联产品成员中，无法使用该仓库凭证",
                status_code=403,
            )

        try:
            from apps.repository.services import RepositoryService

            server_url = RepositoryService._resolve_server_url(repo)
            cred_data = resolve_credential(repo, product=product, operation="read")
            provider = get_provider(repo.vendor, server_url, cred_data)

            # 取两个 tag 的提交时间，用于 MR 区间过滤；tag 列表走短 TTL 缓存，
            # 避免外部系统高频调用时反复全量翻页拉取
            from apps.release.services import list_tags_cached

            tag_map = {t.name: t for t in list_tags_cached(provider, repo.external_identity)}
            from_info = tag_map.get(from_tag)
            to_info = tag_map.get(to_tag)
            if from_info is None or to_info is None:
                missing = from_tag if from_info is None else to_tag
                return error_response(40404, f"tag 不存在: {missing}", status_code=404)

            commits = provider.compare_commits(repo.external_identity, from_tag, to_tag)
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
            "project_name": product.name if product else "",
            "from_tag": from_tag,
            "to_tag": to_tag,
            "branch": branch,
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
