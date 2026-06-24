"""
发布管理视图

提供发布记录 CRUD、生成发布说明、提交审批、推 tag 以及关联 commit 查询接口。
"""
from typing import Any, Dict, List

from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.project.models import ProjectMember
from apps.release.models import ReleaseRecord
from apps.release.serializers import (
    ReleaseCommitSerializer,
    ReleaseListSerializer,
    ReleaseRecordSerializer,
)
from apps.release.services import ReleaseService, ReleaseValidator
from utils.permissions import IsProjectDeveloper, IsProjectManager, IsProjectMember
from utils.response import error_response, success_response


class ReleaseViewSet(viewsets.ModelViewSet):
    """
    发布管理视图集

    - 项目管理员可创建/修改/删除发布申请
    - 项目开发者可生成发布说明、提交审批、推 tag
    - 普通成员仅可查看自己参与项目的发布
    """

    queryset = ReleaseRecord.objects.all()
    serializer_class = ReleaseRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["project", "repository", "release_type", "status", "publisher"]
    search_fields = ["version", "tag_name"]
    ordering_fields = ["created_at", "released_at", "version"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        """
        列表接口使用精简序列化器

        Returns:
            Serializer 类
        """
        if self.action == "list":
            return ReleaseListSerializer
        return ReleaseRecordSerializer

    def get_queryset(self):
        """
        根据用户身份返回可见发布记录

        Returns:
            ReleaseRecord QuerySet
        """
        if getattr(self, "swagger_fake_view", False):
            return ReleaseRecord.objects.none()
        user = self.request.user
        queryset = ReleaseRecord.objects.select_related(
            "project", "repository", "publisher", "jenkins_build"
        )
        if user.is_superuser:
            return queryset.all()
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        """
        写操作需项目管理员，生成说明/提交审批/推 tag 需项目开发者

        Returns:
            权限实例列表
        """
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsAuthenticated(), IsProjectManager()]
        if self.action in ["generate_doc", "submit_audit", "push_tag"]:
            return [IsAuthenticated(), IsProjectDeveloper()]
        return super().get_permissions()

    def _serialize_release(self, release: ReleaseRecord) -> Dict[str, Any]:
        """
        序列化单条发布记录

        Args:
            release: ReleaseRecord 实例

        Returns:
            序列化后的字典
        """
        return ReleaseRecordSerializer(release, context={"request": self.request}).data

    def create(self, request: Request, *args, **kwargs) -> Response:
        """
        创建发布申请

        Args:
            request: DRF Request

        Returns:
            创建后的发布记录
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            release = ReleaseService.create_release(
                project=data["project"],
                repository=data["repository"],
                release_type=data["release_type"],
                source_branch=data["source_branch"],
                target_branch=data["target_branch"],
                publisher=request.user,
                version=data.get("version"),
            )
        except Exception as exc:
            return error_response(40002, str(exc))
        return success_response(self._serialize_release(release), message="创建成功", status=201)

    def update(self, request: Request, *args, **kwargs) -> Response:
        """
        更新发布申请（仅草稿可编辑）

        Args:
            request: DRF Request

        Returns:
            更新后的发布记录
        """
        instance = self.get_object()
        if instance.status != "draft":
            return error_response(40002, "只有草稿状态才能编辑")
        serializer = self.get_serializer(instance, data=request.data, partial=kwargs.pop("partial", False))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # 更新允许修改的字段
        instance.source_branch = data.get("source_branch", instance.source_branch)
        instance.target_branch = data.get("target_branch", instance.target_branch)
        instance.version = data.get("version", instance.version)

        # 若目标分支变化则重新获取 git_hash
        if "target_branch" in data:
            try:
                instance.git_hash = ReleaseService._resolve_branch_head_hash(
                    instance.repository, instance.target_branch, request.user
                )
            except Exception as exc:
                return error_response(40002, str(exc))

        # 若版本号变化则重新计算 tag_name
        if "version" in data:
            rule = ReleaseValidator.get_release_rule(instance.project)
            instance.tag_name = instance.version
            if instance.release_type == "test":
                prefix = rule.get("test_prefix", "test").strip("-")
                if not instance.tag_name.startswith(prefix):
                    instance.tag_name = f"{prefix}-{instance.tag_name}"

        instance.save(update_fields=["source_branch", "target_branch", "version", "tag_name", "git_hash", "updated_at"])
        return success_response(self._serialize_release(instance), message="更新成功")

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """
        删除发布申请

        Args:
            request: DRF Request

        Returns:
            删除结果
        """
        instance = self.get_object()
        if instance.status not in ["draft", "rejected"]:
            return error_response(40002, "仅草稿或已驳回状态可删除")
        instance.delete()
        return success_response(None, message="删除成功")

    @action(detail=True, methods=["post"], url_path="generate-doc")
    def generate_doc(self, request: Request, pk=None) -> Response:
        """
        生成发布说明

        Args:
            request: DRF Request，body 可包含 commit_ids 与 merge_similar
            pk: 发布主键

        Returns:
            发布说明文档
        """
        release = self.get_object()
        commit_ids: List[str] = request.data.get("commit_ids") or None
        merge_similar: bool = request.data.get("merge_similar", True)
        try:
            doc = ReleaseService.generate_doc(
                release=release,
                commit_ids=commit_ids,
                merge_similar=merge_similar,
                request_user=request.user,
            )
        except Exception as exc:
            return error_response(50000, f"生成发布说明失败: {exc}", status_code=500)
        return success_response(doc, message="生成成功")

    @action(detail=True, methods=["post"], url_path="submit-audit")
    def submit_audit(self, request: Request, pk=None) -> Response:
        """
        提交审批（阶段三简化流转）

        Args:
            request: DRF Request
            pk: 发布主键

        Returns:
            更新后的状态
        """
        release = self.get_object()
        try:
            ReleaseService.submit_audit(release)
        except Exception as exc:
            return error_response(40002, str(exc))
        return success_response({
            "id": str(release.id),
            "status": release.status,
        }, message="提交成功")

    @action(detail=True, methods=["post"], url_path="push-tag")
    def push_tag(self, request: Request, pk=None) -> Response:
        """
        推 tag

        Args:
            request: DRF Request
            pk: 发布主键

        Returns:
            创建的 tag 信息
        """
        release = self.get_object()
        try:
            tag_info = ReleaseService.push_tag(release, request.user)
        except Exception as exc:
            return error_response(50001, f"推 tag 失败: {exc}", status_code=500)
        return success_response({
            "tag_name": tag_info.name,
            "git_hash": tag_info.commit_hash,
            "pushed_at": release.released_at,
        }, message="推 tag 成功")

    @action(detail=True, methods=["get"], url_path="commits")
    def commits(self, request: Request, pk=None) -> Response:
        """
        获取发布关联 commit 列表

        Args:
            request: DRF Request
            pk: 发布主键

        Returns:
            分页后的 ReleaseCommit 列表
        """
        release = self.get_object()
        queryset = release.release_commits.select_related("commit").order_by("-commit__committed_at")
        queryset = self.filter_queryset(queryset)
        page = self.paginate_queryset(queryset)
        serializer = ReleaseCommitSerializer(page, many=True, context={"request": request})
        return self.get_paginated_response(serializer.data)
