"""
发布模块对外开放接口

供外部系统通过 Access Token 调用，只读。
挂 /api/open/ 前缀（见 config/urls_open.py）。
"""
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.release.models import ReleaseRecord
from utils.authentication import AccessTokenAuthentication
from utils.permissions import HasAccessTokenScope
from utils.response import error_response, success_response


class OpenReleaseDocView(APIView):
    """
    按 tag 查询发布变更文档（scope: release.doc）

    GET /api/open/release-doc/?tag=<tag_name>&repository_id=<id>
    仅放行 status=released 的发布记录，草稿/审批中/驳回不对外暴露。
    """

    authentication_classes = [AccessTokenAuthentication]
    permission_classes = [HasAccessTokenScope]
    open_scope = "release.doc"

    def get(self, request: Request) -> Response:
        """查询指定仓库指定 tag 的发布文档"""
        tag = request.query_params.get("tag", "").strip()
        repository_id = request.query_params.get("repository_id", "").strip()
        if not tag or not repository_id:
            return error_response(40001, "缺少必填参数 tag 或 repository_id")

        release = (
            ReleaseRecord.objects.filter(
                tag_name=tag,
                repository_id=repository_id,
                status="released",
            )
            .select_related("project", "repository")
            .first()
        )
        if release is None:
            return error_response(40404, "未找到该 tag 对应的已发布记录", status_code=404)

        return success_response({
            "project_name": release.project.name,
            "repository_name": release.repository.name,
            "version": release.version,
            "tag_name": release.tag_name,
            "release_type": release.release_type,
            "release_doc": release.release_doc,
            "config_change_doc": release.config_change_doc,
            "released_at": release.released_at,
        })
