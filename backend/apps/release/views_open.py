"""
发布模块对外开放接口

供外部系统通过 Access Token 调用，只读。
挂 /api/open/ 前缀（见 config/urls_open.py）。
"""
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.release.delivery_identity import release_repository_name, release_software_name
from apps.release.models import ReleaseRecord
from utils.authentication import AccessTokenAuthentication
from utils.permissions import HasAccessTokenScope
from utils.response import error_response, success_response


class ReleaseDocQuery(serializers.Serializer):
    tag = serializers.CharField()
    repository_id = serializers.UUIDField(required=False)
    software_id = serializers.UUIDField(required=False)


class OpenReleaseDocView(APIView):
    """
    按 tag 查询发布变更文档（scope: release.doc）

    GET /api/open/release-doc/?tag=<tag_name>&repository_id=<id>
    仅放行 status=released 的发布记录，草稿/审批中/驳回不对外暴露。
    """

    authentication_classes = [AccessTokenAuthentication]
    permission_classes = [HasAccessTokenScope]
    open_scope = "release.doc"

    @extend_schema(parameters=[
        OpenApiParameter("tag", str, required=True, description="完整 Tag，包含原有的软件前缀（若有）"),
        OpenApiParameter("software_id", str, description="软件 UUID，与 repository_id 至少填写一项"),
        OpenApiParameter("repository_id", str, description="来源仓库 UUID，兼容历史查询"),
    ], responses={200: dict})
    def get(self, request: Request) -> Response:
        """查询指定仓库指定 tag 的发布文档"""
        params = ReleaseDocQuery(data=request.query_params)
        params.is_valid(raise_exception=True)
        values = params.validated_data
        repository_id = values.get("repository_id")
        software_id = values.get("software_id")
        if not (software_id or repository_id):
            return error_response(40001, "请输入完整 tag，并指定 software_id 或 repository_id")

        releases = ReleaseRecord.objects.filter(tag_name=values["tag"], status="released")
        if repository_id:
            releases = releases.filter(repository_id=repository_id)
        if software_id:
            releases = releases.filter(software_id=software_id)
        release = releases.select_related("project", "repository", "software").first()
        if release is None:
            return error_response(40404, "未找到该 tag 对应的已发布记录", status_code=404)

        return success_response({
            "project_name": release.project.name,
            "repository_id": str(release.repository_id),
            "repository_name": release_repository_name(release),
            "software_id": str(release.software_id) if release.software_id else None,
            "software_name": release_software_name(release) if release.software_id else None,
            "software_slug": release.software.slug if release.software_id else None,
            "branch": release.branch,
            "git_hash": release.git_hash,
            "version": release.version,
            "tag_name": release.tag_name,
            "release_type": release.release_type,
            "release_doc": release.release_doc,
            "config_change_doc": release.config_change_doc,
            "released_at": release.released_at,
        })
