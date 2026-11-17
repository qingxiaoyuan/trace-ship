"""
仓库模块对外开放接口

供外部系统通过 Access Token 调用，只读。
挂 /api/open/ 前缀（见 config/urls_open.py）。
"""
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.repository.open_compare import OpenTagCompareError, compare_published_tags
from utils.authentication import AccessTokenAuthentication
from utils.permissions import HasAccessTokenScope
from utils.provider.exceptions import ProviderError
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
        try:
            return success_response(compare_published_tags(params))
        except OpenTagCompareError as exc:
            return error_response(exc.code, str(exc), status_code=exc.status)
        except ProviderError as exc:
            return error_response(50201, f"GitLab 调用失败: {exc}", status_code=502)
