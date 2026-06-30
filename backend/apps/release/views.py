"""
发布管理视图

提供发布记录 CRUD、生成发布说明、提交审批、推 tag、看板统计以及关联 commit 查询接口。
"""
from typing import Any, Dict, List

from django.db.models import Count, Q
from django.utils import timezone
from django_filters import rest_framework as filters
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters as drf_filters, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from utils.viewsets import StandardModelViewSet, StandardReadOnlyModelViewSet

from apps.project.models import ProjectMember
from apps.release.models import ReleaseRecord
from apps.release.serializers import (
    ReleaseCommitSerializer,
    ReleaseListSerializer,
    ReleaseRecordSerializer,
)
from apps.release.services import ReleaseService, ReleaseValidator
from apps.release.exporters import ReleaseDocExporter
from utils.permissions import IsProjectDeveloper, IsProjectManager, IsProjectMember
from utils.response import error_response, success_response


class ReleaseFilter(filters.FilterSet):
    """
    发布记录过滤器
    """

    created_at__gte = filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")
    version__icontains = filters.CharFilter(field_name="version", lookup_expr="icontains")

    class Meta:
        model = ReleaseRecord
        fields = [
            "project", "repository", "release_type", "status", "publisher",
        ]


class ReleaseViewSet(StandardModelViewSet):
    """
    发布管理视图集

    - 项目管理员可创建/修改/删除发布申请
    - 项目开发者可生成发布说明、提交审批、推 tag
    - 普通成员仅可查看自己参与项目的发布
    """

    queryset = ReleaseRecord.objects.all()
    serializer_class = ReleaseRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, drf_filters.SearchFilter, drf_filters.OrderingFilter]
    filterset_class = ReleaseFilter
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
        写操作需项目成员，生成说明/提交审批/推 tag 需项目开发者

        Returns:
            权限实例列表
        """
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsAuthenticated(), IsProjectMember()]
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
                branch=data["branch"],
                publisher=request.user,
                version=data.get("version"),
                tag_name=data.get("tag_name"),
                related_changes=data.get("related_changes"),
                updates=data.get("updates"),
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
        instance.branch = data.get("branch", instance.branch)
        instance.version = data.get("version", instance.version)

        # 若分支变化则重新获取 git_hash
        if "branch" in data:
            try:
                instance.git_hash = ReleaseService._resolve_branch_head_hash(
                    instance.repository, instance.branch, request.user
                )
            except Exception as exc:
                return error_response(40002, str(exc))

        # 若版本号变化则按新 Tag 流程重新计算 tag_name
        if "version" in data:
            rule = ReleaseValidator.get_release_rule(instance.project)
            prefixes = rule.get("tag_prefixes", ReleaseValidator.get_default_tag_prefixes())
            instance.tag_name = instance.version
            if instance.release_type in ("rc", "beta"):
                prefix = (prefixes.get(instance.release_type, "") or "").strip("-")
                if not instance.tag_name.startswith(prefix):
                    instance.tag_name = f"{prefix}-{instance.tag_name}"

        instance.save(update_fields=["branch", "version", "tag_name", "git_hash", "updated_at"])
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
            ReleaseService.submit_audit(release, request.user)
        except Exception as exc:
            return error_response(40002, str(exc))
        return success_response({
            "id": str(release.id),
            "status": release.status,
            "workflow_instance_id": str(release.workflow_instance_id) if release.workflow_instance_id else None,
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

    @action(detail=True, methods=["get"], url_path="export-pdf")
    def export_pdf(self, request: Request, pk=None) -> Response:
        """
        导出 PDF 发布单

        Args:
            request: DRF Request
            pk: 发布主键

        Returns:
            PDF 文件响应
        """
        release = self.get_object()
        try:
            pdf_bytes = ReleaseDocExporter.export_pdf(release)
        except Exception as exc:
            return error_response(50001, f"导出 PDF 失败: {exc}", status_code=500)
        response = Response(pdf_bytes, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="release-{release.version}.pdf"'
        return response

    @action(detail=True, methods=["get"], url_path="export-word")
    def export_word(self, request: Request, pk=None) -> Response:
        """
        导出 Word 发布单

        Args:
            request: DRF Request
            pk: 发布主键

        Returns:
            Word 文件响应
        """
        release = self.get_object()
        try:
            word_bytes = ReleaseDocExporter.export_word(release)
        except Exception as exc:
            return error_response(50001, f"导出 Word 失败: {exc}", status_code=500)
        response = Response(
            word_bytes,
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        response["Content-Disposition"] = f'attachment; filename="release-{release.version}.docx"'
        return response

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

    @action(detail=False, methods=["get"], url_path="dashboard/overview")
    def dashboard_overview(self, request: Request) -> Response:
        """
        看板总览统计

        Returns:
            总览数据字典
        """
        queryset = self.get_queryset()
        total = queryset.count()
        success_count = queryset.filter(status="released").count()
        success_rate = round(success_count / total, 2) if total > 0 else 1.0
        data = {
            "total_releases": total,
            "success_rate": success_rate,
            "pending_audit_count": queryset.filter(status="pending").count(),
            "rejected_count": queryset.filter(status="rejected").count(),
            "released_count": queryset.filter(status="released").count(),
        }
        return success_response(data)

    @action(detail=False, methods=["get"], url_path="dashboard/trend")
    def dashboard_trend(self, request: Request) -> Response:
        """
        发布趋势统计

        Query: days 统计天数，默认 30

        Returns:
            日期维度统计列表
        """
        try:
            days = int(request.query_params.get("days", 30))
        except ValueError:
            days = 30
        start_date = timezone.now().date() - __import__("datetime").timedelta(days=days - 1)

        queryset = self.get_queryset().filter(created_at__date__gte=start_date)
        stats = (
            queryset.extra(select={"date": "DATE(created_at)"})
            .values("date")
            .annotate(
                count=Count("id"),
                success_count=Count("id", filter=Q(status="released")),
                failure_count=Count("id", filter=Q(status="rejected")),
            )
            .order_by("date")
        )

        result = []
        date_map = {item["date"]: item for item in stats}
        for i in range(days):
            date = (start_date + __import__("datetime").timedelta(days=i)).isoformat()
            item = date_map.get(date, {"count": 0, "success_count": 0, "failure_count": 0})
            result.append({
                "date": date,
                "count": item["count"],
                "success_count": item["success_count"],
                "failure_count": item["failure_count"],
            })
        return success_response(result)

    @action(detail=False, methods=["get"], url_path="dashboard/projects")
    def dashboard_projects(self, request: Request) -> Response:
        """
        项目维度发布统计

        Returns:
            项目统计列表
        """
        queryset = self.get_queryset()
        stats = (
            queryset.values("project", "project__name")
            .annotate(
                release_count=Count("id"),
                success_count=Count("id", filter=Q(status="released")),
            )
            .order_by("-release_count")
        )
        result = []
        for item in stats:
            total = item["release_count"]
            success = item["success_count"]
            result.append({
                "project_id": str(item["project"]),
                "project_name": item["project__name"],
                "release_count": total,
                "success_rate": round(success / total, 2) if total > 0 else 1.0,
            })
        return success_response(result)

    @action(detail=False, methods=["get"], url_path="catalog")
    def catalog(self, request: Request) -> Response:
        """
        正式/RC/Beta 版本目录

        Returns:
            {formal: Release[], rc: Release[], beta: Release[]}
        """
        queryset = self.get_queryset().filter(status="released").order_by("-version")
        formal = queryset.filter(release_type="formal")
        rc = queryset.filter(release_type="rc")
        beta = queryset.filter(release_type="beta")
        serializer = ReleaseListSerializer
        return success_response({
            "formal": serializer(formal, many=True, context={"request": request}).data,
            "rc": serializer(rc, many=True, context={"request": request}).data,
            "beta": serializer(beta, many=True, context={"request": request}).data,
        })
