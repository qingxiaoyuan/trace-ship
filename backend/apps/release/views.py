"""
发布管理视图

提供发布记录 CRUD、生成发布说明、提交审批、推 tag、看板统计以及关联 commit 查询接口。
"""
import logging
import re
from typing import Any

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django_filters import rest_framework as filters
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters as drf_filters
from rest_framework import serializers
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.project.services import visible_project_ids
from apps.release.exporters import ReleaseDocExporter
from apps.release.models import ReleaseRecord, ReleaseReviewIssue
from apps.release.serializers import (
    ReleaseCommitSerializer,
    ReleaseListSerializer,
    ReleaseRecordSerializer,
    ReleaseReviewIssueSerializer,
)
from apps.release.services import (
    ReleaseReviewError,
    ReleaseReviewService,
    ReleaseService,
    ReleaseTagExistsError,
    ReleaseValidator,
)
from apps.repository.models import Repository
from utils.permissions import IsProjectDeveloper, IsProjectManager
from utils.provider.exceptions import ProviderError
from utils.response import error_response, success_response
from utils.viewsets import StandardModelViewSet

logger = logging.getLogger(__name__)


def _extract_validation_message(exc: Exception) -> str:
    """
    从 DRF ValidationError 中提取第一条可读错误信息

    Args:
        exc: serializers.ValidationError 实例

    Returns:
        错误描述字符串
    """
    detail = getattr(exc, "detail", exc)
    if isinstance(detail, dict):
        first = next(iter(detail.values()), "校验失败")
        return str(first[0] if isinstance(first, list) and first else first)
    if isinstance(detail, list):
        return str(detail[0]) if detail else "校验失败"
    return str(detail or "校验失败")


def _handle_service_error(exc: Exception, action_desc: str) -> Response:
    """
    分类处理发布服务层抛出的异常，返回统一格式响应

    - 远端 tag 已存在（ReleaseTagExistsError）：400 + 明确提示
    - 业务校验错误（ValidationError）：400 + 具体原因
    - Git 平台错误（ProviderError）：502 + 平台错误信息
    - 未知异常：500 + 记录完整堆栈日志（不对客户端暴露内部细节）

    Args:
        exc: 异常实例
        action_desc: 操作描述（用于日志与错误提示）

    Returns:
        统一格式错误响应
    """
    if isinstance(exc, ReleaseTagExistsError):
        return error_response(40003, str(exc))
    if isinstance(exc, serializers.ValidationError):
        return error_response(40002, _extract_validation_message(exc))
    if isinstance(exc, ProviderError):
        logger.warning("%s失败（Git 平台错误）: %s", action_desc, exc, exc_info=True)
        return error_response(50200, f"{action_desc}失败: {exc}", status_code=502)
    logger.exception("%s失败（未预期异常）", action_desc)
    return error_response(50000, f"{action_desc}失败，请联系管理员", status_code=500)


class ReleaseFilter(filters.FilterSet):
    """
    发布记录过滤器
    """

    created_at__gte = filters.DateTimeFilter(field_name="created_at", lookup_expr="gte")
    created_at__lte = filters.DateTimeFilter(field_name="created_at", lookup_expr="lte")
    version__icontains = filters.CharFilter(field_name="version", lookup_expr="icontains")
    review_status = filters.CharFilter(method="filter_review_status")

    class Meta:
        model = ReleaseRecord
        fields = [
            "project", "repository", "release_type", "status", "publisher",
        ]

    def filter_review_status(self, queryset, name, value):
        """
        按整改意见状态过滤发布记录

        open=待整改（存在待整改意见），replied=待复核（存在待复核意见），其他值不过滤。
        """
        if value in (ReleaseReviewIssue.STATUS_OPEN, ReleaseReviewIssue.STATUS_REPLIED):
            return queryset.filter(review_issues__status=value).distinct()
        return queryset


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
        queryset = (
            ReleaseRecord.objects.select_related("project", "repository", "publisher")
            .prefetch_related("package_tasks")
            # 列表页「待整改 / 待复核」徽标：注记待整改（open）与待复核（replied）整改意见数，避免逐条查询
            .annotate(
                open_review_count=Count(
                    "review_issues", filter=Q(review_issues__status=ReleaseReviewIssue.STATUS_OPEN)
                ),
                replied_review_count=Count(
                    "review_issues", filter=Q(review_issues__status=ReleaseReviewIssue.STATUS_REPLIED)
                ),
            )
        )
        if user.is_superuser:
            return queryset.all()
        project_ids = visible_project_ids(user)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        """
        写操作（创建/编辑/删除/生成说明/提交审批/推 tag）需项目开发及以上角色；
        删除已发布版本属高风险操作，额外要求项目管理员及以上。

        Returns:
            权限实例列表
        """
        if self.action in [
            "create", "update", "partial_update", "destroy",
            "generate_doc", "update_doc", "submit_audit", "push_tag", "retry_push_tag",
        ]:
            return [IsAuthenticated(), IsProjectDeveloper()]
        if self.action in ("delete_released", "cleanup_tag"):
            return [IsAuthenticated(), IsProjectManager()]
        return super().get_permissions()

    def _serialize_release(self, release: ReleaseRecord) -> dict[str, Any]:
        """
        序列化单条发布记录

        Args:
            release: ReleaseRecord 实例

        Returns:
            序列化后的字典
        """
        return ReleaseRecordSerializer(release, context={"request": self.request}).data

    @action(detail=False, methods=["get"], url_path="rc-candidates")
    def rc_candidates(self, request: Request) -> Response:
        """仅返回当前可见项目、启用仓库下的 RC 及实时引用可用性。"""
        from apps.project.models import Project

        params = serializers.Serializer(data=request.query_params)
        params.fields["project"] = serializers.UUIDField(required=True)
        params.fields["repository"] = serializers.UUIDField(required=True)
        params.is_valid(raise_exception=True)
        project = Project.objects.filter(
            id=params.validated_data["project"], id__in=visible_project_ids(request.user),
        ).first()
        if project is None:
            return error_response(40400, "项目不存在或不可见", status_code=404)
        repository = Repository.objects.filter(
            id=params.validated_data["repository"],
            project_components__project=project, project_components__is_active=True,
        ).first()
        if repository is None:
            return error_response(40400, "仓库未在当前项目中启用", status_code=404)
        try:
            ReleaseService.validate_source_context(project, repository)
            queryset = self.get_queryset().filter(
                project=project, repository=repository, release_type="rc", status="released",
            ).order_by("-released_at", "-created_at", "id")
            search = request.query_params.get("search", "").strip()
            if search:
                queryset = queryset.filter(Q(version__icontains=search) | Q(tag_name__icontains=search))
            page = self.paginate_queryset(queryset)
            provider = ReleaseService._get_provider(repository, request.user, project=project)
            tags = provider.list_tags(repository.external_identity)
            results = []
            for source in page:
                reason = ReleaseService.rc_source_unavailable_reason(source, tags)
                results.append({
                    "id": str(source.id), "version": source.version, "tag_name": source.tag_name,
                    "branch": source.branch, "git_hash": source.git_hash,
                    "released_at": source.released_at, "available": not reason,
                    "unavailable_reason": reason,
                })
            return self.get_paginated_response(results)
        except APIException:
            raise
        except Exception as exc:
            return _handle_service_error(exc, "查询来源 RC")

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
                branch=data.get("branch", ""),
                source_rc=data.get("source_rc"),
                publisher=request.user,
                version=data.get("version"),
                tag_name=data.get("tag_name"),
                redmine_url=data.get("redmine_url", ""),
                related_changes=data.get("related_changes"),
                updates=data.get("updates"),
                has_config_changes=data.get("has_config_changes", False),
                config_change_doc=data.get("config_change_doc", ""),
                impact_other=data.get("impact_other", False),
                impact_desc=data.get("impact_desc", ""),
                self_test_passed=data.get("self_test_passed", False),
                retest_passed=data.get("retest_passed", False),
                package_config_ids=data.get("package_config_ids"),
            )
        except Exception as exc:
            return _handle_service_error(exc, "创建发布")
        return success_response(self._serialize_release(release), message="创建成功", status=201)

    @transaction.atomic
    def update(self, request: Request, *args, **kwargs) -> Response:
        """
        更新发布申请（仅草稿可编辑）

        Args:
            request: DRF Request

        Returns:
            更新后的发布记录
        """
        instance = self.get_object()
        Repository.objects.select_for_update(no_key=True).get(pk=instance.repository_id)
        instance = ReleaseRecord.objects.select_for_update().get(pk=instance.pk)
        if instance.status != "draft":
            return error_response(40002, "只有草稿状态才能编辑")
        serializer = self.get_serializer(instance, data=request.data, partial=kwargs.pop("partial", False))
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        source_changed = False
        old_version = instance.version
        try:
            if instance.release_type == "formal":
                if "source_rc" in data:
                    source_changed = ReleaseService.update_source(instance, data["source_rc"], request.user)
            else:
                instance.branch = data.get("branch", instance.branch)
                if "branch" in data:
                    instance.git_hash = ReleaseService._resolve_branch_head_hash(
                        instance.repository, instance.branch, request.user, project=instance.project,
                    )
        except Exception as exc:
            return _handle_service_error(exc, "更新来源提交")
        instance.redmine_url = data.get("redmine_url", instance.redmine_url)

        # tag_name 与 version 统一为单一值：优先 tag_name，未传则按 version 推导
        version_rule = instance.repository.get_version_rule()
        if "tag_name" in data and data.get("tag_name"):
            instance.tag_name = data["tag_name"]
            # rc/beta 类型自动补后缀（后缀位于日期段之前）
            if instance.release_type in ("rc", "beta"):
                suffixes = version_rule.get("suffixes") or ReleaseValidator.get_default_suffixes()
                suffix = (suffixes.get(instance.release_type, "") or "").strip("-")
                if suffix and not re.search(f"-{re.escape(suffix)}(?:_\\d{{8}})?$", instance.tag_name):
                    if re.search(r"_\d{8}$", instance.tag_name):
                        instance.tag_name = f"{instance.tag_name[:-9]}-{suffix}{instance.tag_name[-9:]}"
                    else:
                        instance.tag_name = f"{instance.tag_name}-{suffix}"
            instance.tag_name = ReleaseValidator.ensure_tag_date(instance.tag_name, version_rule)
            instance.version = ReleaseValidator.strip_suffix(instance.tag_name, version_rule)
        elif "version" in data and data.get("version"):
            instance.version = data["version"]
            instance.tag_name = instance.version
            if instance.release_type in ("rc", "beta"):
                suffixes = version_rule.get("suffixes") or ReleaseValidator.get_default_suffixes()
                suffix = (suffixes.get(instance.release_type, "") or "").strip("-")
                if suffix and not instance.tag_name.endswith(f"-{suffix}"):
                    instance.tag_name = f"{instance.tag_name}-{suffix}"
            instance.tag_name = ReleaseValidator.ensure_tag_date(instance.tag_name, version_rule)

        # 校验 tag 后缀一致性
        try:
            ReleaseValidator.validate_tag_suffix(
                instance.release_type, instance.tag_name, version_rule
            )
            if "tag_name" in data or "version" in data:
                ReleaseService.validate_tag_not_exists(instance.repository, instance.tag_name, request.user)
        except serializers.ValidationError as exc:
            return error_response(40002, _extract_validation_message(exc))

        changes_invalidated = source_changed or (instance.source_rc_id and instance.version != old_version)
        if changes_invalidated:
            from apps.release.formal_changes import FormalChanges

            FormalChanges.reset(instance)
        instance.save(
            update_fields=[
                "branch", "version", "tag_name", "redmine_url", "git_hash", "updated_at",
                "source_rc", "source_rc_version", "source_rc_tag", "source_rc_git_hash",
                "base_tag", "base_git_hash", "changes_initialized", "changes_warnings",
                "release_doc", "updates", "related_changes",
            ]
        )
        if changes_invalidated:
            instance.release_commits.all().delete()
            instance.release_mrs.all().delete()
        return success_response(self._serialize_release(instance), message="更新成功")

    @transaction.atomic
    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """
        删除发布申请

        项目管理员可删除草稿/已驳回记录；开发人员仅可删除本人创建的草稿。

        Args:
            request: DRF Request

        Returns:
            删除结果
        """
        instance = self.get_object()
        Repository.objects.select_for_update(no_key=True).get(pk=instance.repository_id)
        instance = ReleaseRecord.objects.select_for_update().get(pk=instance.pk)
        if instance.status not in ["draft", "rejected"]:
            return error_response(40002, "仅草稿或已驳回状态可删除")
        # 项目负责人视同 manager，复用权限类的统一判定，避免 leader 等价逻辑走样
        is_manager = request.user.is_superuser or IsProjectManager().has_object_permission(
            request, self, instance.project
        )
        if not is_manager:
            if str(instance.publisher_id) != str(request.user.id) or instance.status != "draft":
                return error_response(
                    40300, "仅可删除本人创建的草稿", status_code=403
                )
        from apps.release.versions import release_claim

        release_claim(instance)
        instance.delete()
        return success_response(None, message="删除成功")

    @action(detail=True, methods=["get"], url_path="changes-preview")
    def changes_preview(self, request: Request, pk=None) -> Response:
        """预览正式草稿固定区间；首次生成说明时才持久化基线。"""
        from apps.release.formal_changes import FormalChanges

        release = self.get_object()
        try:
            provider = ReleaseService._get_provider(release.repository, request.user, project=release.project)
            data = FormalChanges.preview(FormalChanges.collect(release, provider))
        except Exception as exc:
            return _handle_service_error(exc, "预览正式变更")
        return success_response(data)

    @action(detail=False, methods=["get"], url_path="cleanup-candidates")
    def cleanup_candidates(self, request: Request) -> Response:
        from apps.release.tag_cleanup import TagCleanup

        params = serializers.Serializer(data=request.query_params)
        params.fields["project"] = serializers.UUIDField(required=True)
        params.fields["repository"] = serializers.UUIDField(required=True)
        params.is_valid(raise_exception=True)
        queryset = self.get_queryset().filter(project_id=params.validated_data["project"],
            repository_id=params.validated_data["repository"], release_type="rc", status="released")
        page = self.paginate_queryset(queryset)
        results = []
        try:
            tags = None
            for release in page:
                if tags is None:
                    provider = ReleaseService._get_provider(release.repository, request.user, project=release.project)
                    tags = provider.list_tags(release.repository.external_identity)
                result = TagCleanup.preview(release, tags)
                if not IsProjectManager().has_object_permission(request, self, release):
                    result.update(allowed=False, reason="仅项目管理员可清理")
                results.append(result)
        except Exception as exc:
            return _handle_service_error(exc, "预览 RC Tag 清理")
        return self.get_paginated_response(results)

    @action(detail=True, methods=["get"], url_path="source-reference")
    def source_reference(self, request: Request, pk=None) -> Response:
        from apps.release.references import ReleaseReferences
        from apps.release.tag_cleanup import validation_message

        release = self.get_object()
        source = release.source_rc if release.source_rc_id and release.status != "released" else release
        try:
            provider = ReleaseService._get_provider(source.repository, request.user, project=release.project)
            reference = ReleaseReferences.resolve(source, provider.list_tags(source.repository.external_identity))
        except serializers.ValidationError as exc:
            return success_response({"available": False, "reference": "", "reason": validation_message(exc)})
        except Exception as exc:
            return _handle_service_error(exc, "核验源码引用")
        return success_response({"available": True, "reference": reference, "reason": ""})

    @action(detail=True, methods=["post"], url_path="cleanup-tag")
    def cleanup_tag(self, request: Request, pk=None) -> Response:
        from apps.release.tag_cleanup import TagCleanup

        release = self.get_object()
        try:
            result = TagCleanup.execute(release, request.data.get("tag_name", ""), request.user)
        except Exception as exc:
            return _handle_service_error(exc, "清理 RC Tag")
        return success_response(result)

    @action(detail=False, methods=["post"], url_path="cleanup-tags")
    def cleanup_tags(self, request: Request) -> Response:
        from apps.release.tag_cleanup import TagCleanup

        class ItemSerializer(serializers.Serializer):
            id = serializers.UUIDField()
            tag_name = serializers.CharField(max_length=100)

        params = serializers.Serializer(data=request.data)
        params.fields["items"] = serializers.ListField(child=ItemSerializer(), min_length=1, max_length=50)
        params.is_valid(raise_exception=True)
        results = []
        for item in params.validated_data["items"]:
            release = self.get_queryset().filter(pk=item["id"]).first()
            if release is None or not IsProjectManager().has_object_permission(request, self, release):
                results.append({"id": str(item["id"]), "status": "blocked", "reason": "记录不存在或无清理权限"})
                continue
            try:
                results.append(TagCleanup.execute(release, item["tag_name"], request.user))
            except Exception:
                logger.exception("单项 RC 清理失败: release=%s", release.id)
                results.append({"id": str(item["id"]), "status": "failure", "reason": "操作结果未确认，请重试对账"})
        return success_response(results)

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
        commit_ids: list[str] = request.data.get("commit_ids") or None
        merge_similar: bool = request.data.get("merge_similar", True)
        try:
            doc = ReleaseService.generate_doc(
                release=release,
                commit_ids=commit_ids,
                merge_similar=merge_similar,
                request_user=request.user,
            )
        except Exception as exc:
            return _handle_service_error(exc, "生成发布说明")
        return success_response(doc, message="生成成功")

    @action(detail=True, methods=["post"], url_path="update-doc")
    def update_doc(self, request: Request, pk=None) -> Response:
        """
        手动编辑发布说明 Markdown 文档

        Args:
            request: DRF Request，body 需包含 release_doc
            pk: 发布主键

        Returns:
            更新后的发布记录
        """
        release = self.get_object()
        md_content = request.data.get("release_doc", "")
        try:
            release = ReleaseService.update_doc(release, md_content)
            # 保存成功后同步替换已推送 SVN 的发布文档；失败不阻塞保存
            from apps.package.services import PackageService

            sync_results = PackageService.sync_release_docs_to_svn(release)
        except Exception as exc:
            return _handle_service_error(exc, "保存发布说明")
        data = self._serialize_release(release)
        data["svn_sync_results"] = sync_results
        # SVN 文档同步失败记入操作日志，便于追溯
        failed = [r for r in sync_results if not r.get("ok")]
        if failed:
            from apps.system.services import OperationLogService

            OperationLogService.log(
                user=request.user,
                module="发布管理",
                action="update_doc",
                resource_type="release_record",
                resource_id=str(release.id),
                description=(
                    f"保存发布说明 {release.version}（SVN 文档同步失败 "
                    f"{len(failed)} 项）"
                ),
                result="failure",
                detail={"svn_sync_failed": failed},
            )
        return success_response(data, message="保存成功")

    @action(detail=True, methods=["get"], url_path="export-md")
    def export_md(self, request: Request, pk=None):
        """
        导出 Markdown 发布单

        Args:
            request: DRF Request
            pk: 发布主键

        Returns:
            Markdown 文件响应（纯文本，不经 DRF 渲染器）
        """
        from django.http import HttpResponse

        from utils.markdown_table import table_newlines_to_br

        release = self.get_object()
        # 导出文件转为标准 Markdown 表格语法（单元格内换行用 <br>）
        md_content = table_newlines_to_br(release.release_doc or "")
        response = HttpResponse(md_content, content_type="text/markdown; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="release-{release.version}.md"'
        return response

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
            release = ReleaseService.submit_audit(release, request.user)
        except Exception as exc:
            return _handle_service_error(exc, "提交审批")
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
            return _handle_service_error(exc, "推 tag")
        return success_response({
            "tag_name": tag_info.name,
            "git_hash": tag_info.commit_hash,
            "pushed_at": release.released_at,
        }, message="推 tag 成功")

    @action(detail=True, methods=["post"], url_path="retry-push-tag")
    def retry_push_tag(self, request: Request, pk=None) -> Response:
        """
        推 tag 失败后重试（仅审批已通过、推 tag 环节失败的发布单可用）

        Args:
            request: DRF Request
            pk: 发布主键

        Returns:
            创建的 tag 信息
        """
        release = self.get_object()
        try:
            tag_info = ReleaseService.retry_push_tag(release, request.user)
        except Exception as exc:
            return _handle_service_error(exc, "重试推 tag")
        return success_response({
            "tag_name": tag_info.name,
            "git_hash": tag_info.commit_hash,
            "pushed_at": release.released_at,
        }, message="重试推 tag 成功")

    @action(detail=True, methods=["post"], url_path="delete-released")
    def delete_released(self, request: Request, pk=None) -> Response:
        """
        删除已发布的版本（远端 tag + 发布记录）

        Body 需携带 tag_name（必须与发布记录的 tag 名称一致），
        作为删除前的二次确认输入，防止误删。

        Args:
            request: DRF Request，body: {tag_name: str}
            pk: 发布主键

        Returns:
            删除结果（含远端 tag 是否实际删除）
        """
        release = self.get_object()
        if not request.user.is_superuser and not IsProjectManager().has_object_permission(
            request, self, release.project
        ):
            return error_response(40300, "仅项目管理员可删除已发布版本", status_code=403)
        tag_name = request.data.get("tag_name", "")
        try:
            result = ReleaseService.delete_released_tag(
                release,
                tag_name=tag_name,
                request_user=request.user,
            )
        except Exception as exc:
            return _handle_service_error(exc, "删除已发布版本")
        return success_response(result, message="删除成功")

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
            return _handle_service_error(exc, "导出 PDF")
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
            return _handle_service_error(exc, "导出 Word")
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
        # 注意：不要走 self.filter_queryset——视图集的 ReleaseFilter 是针对
        # ReleaseRecord 的，套用到 ReleaseCommit 查询集会因模型不匹配报错
        queryset = release.release_commits.select_related("commit").order_by("-commit__committed_at")
        page = self.paginate_queryset(queryset)
        serializer = ReleaseCommitSerializer(page, many=True, context={"request": request})
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=["get", "post"], url_path="review-issues")
    def review_issues(self, request: Request, pk=None) -> Response:
        """
        获取/发起发布文档整改意见

        GET：返回该发布全部整改意见（含回复时间线）
        POST：审查员发起整改意见（仅 released，拥有 release.audit 权限）
        """
        release = self.get_object()
        if request.method == "GET":
            queryset = (
                release.review_issues.select_related("author", "resolved_by")
                .prefetch_related("replies")
                .order_by("-created_at")
            )
            serializer = ReleaseReviewIssueSerializer(
                queryset, many=True, context={"request": request}
            )
            return success_response(serializer.data)
        content = request.data.get("content", "")
        try:
            issue = ReleaseReviewService.create_issue(release, request.user, content)
        except ReleaseReviewError as exc:
            return error_response(40002, str(exc))
        serializer = ReleaseReviewIssueSerializer(issue, context={"request": request})
        return success_response(serializer.data, "整改意见已提交", status=201)

    def _get_review_issue(self, release: ReleaseRecord, issue_id: str):
        """按 id 取发布下的整改意见，不存在或 id 非法返回 None（避免非法 UUID 触发 500）"""
        if not issue_id:
            return None
        try:
            from uuid import UUID

            UUID(str(issue_id))
        except (ValueError, TypeError, AttributeError):
            return None
        return release.review_issues.filter(id=issue_id).first()

    @action(detail=True, methods=["post"], url_path=r"review-issues/(?P<issue_id>[^/.]+)/reply")
    def review_issue_reply(self, request: Request, pk=None, issue_id=None) -> Response:
        """发布人回复整改意见（仅发布人，open -> replied）"""
        release = self.get_object()
        issue = self._get_review_issue(release, issue_id)
        if not issue:
            return error_response(40400, "整改意见不存在", status_code=404)
        content = request.data.get("content", "")
        try:
            issue = ReleaseReviewService.reply_issue(issue, request.user, content)
        except ReleaseReviewError as exc:
            return error_response(40002, str(exc))
        serializer = ReleaseReviewIssueSerializer(issue, context={"request": request})
        return success_response(serializer.data, "已回复整改意见")

    @action(detail=True, methods=["post"], url_path=r"review-issues/(?P<issue_id>[^/.]+)/resolve")
    def review_issue_resolve(self, request: Request, pk=None, issue_id=None) -> Response:
        """审查员通过整改意见（replied -> resolved）"""
        release = self.get_object()
        issue = self._get_review_issue(release, issue_id)
        if not issue:
            return error_response(40400, "整改意见不存在", status_code=404)
        try:
            issue = ReleaseReviewService.resolve_issue(issue, request.user)
        except ReleaseReviewError as exc:
            return error_response(40002, str(exc))
        serializer = ReleaseReviewIssueSerializer(issue, context={"request": request})
        return success_response(serializer.data, "整改意见已通过")

    @action(detail=True, methods=["post"], url_path=r"review-issues/(?P<issue_id>[^/.]+)/reject")
    def review_issue_reject(self, request: Request, pk=None, issue_id=None) -> Response:
        """审查员驳回整改意见（replied -> open，可填备注，发布人可再次回复）"""
        release = self.get_object()
        issue = self._get_review_issue(release, issue_id)
        if not issue:
            return error_response(40400, "整改意见不存在", status_code=404)
        comment = request.data.get("comment", "")
        try:
            issue = ReleaseReviewService.reject_issue(issue, request.user, comment)
        except ReleaseReviewError as exc:
            return error_response(40002, str(exc))
        serializer = ReleaseReviewIssueSerializer(issue, context={"request": request})
        return success_response(serializer.data, "整改意见已驳回")

    @action(detail=False, methods=["get"], url_path="dashboard/overview")
    def dashboard_overview(self, request: Request) -> Response:
        """
        看板总览统计（近 7 天）

        Returns:
            总览数据字典
        """
        from datetime import timedelta

        seven_days_ago = timezone.now() - timedelta(days=7)
        queryset = self.get_queryset().filter(created_at__gte=seven_days_ago)
        total = queryset.count()
        success_count = queryset.filter(status="released").count()
        success_rate = round(success_count / total, 2) if total > 0 else 1.0
        data = {
            "total_releases": total,
            "success_rate": success_rate,
            "pending_audit_count": queryset.filter(status="pending").count(),
            "rejected_count": queryset.filter(status="rejected").count(),
            "released_count": success_count,
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
            queryset.extra(select={"date": "DATE(release_record.created_at)"})
            .values("date")
            .annotate(
                count=Count("id"),
                success_count=Count("id", filter=Q(status="released")),
                failure_count=Count("id", filter=Q(status="rejected")),
            )
            .order_by("date")
        )

        result = []
        # PostgreSQL 的 DATE() 返回 date 对象，统一转成 ISO 字符串再匹配（SQLite 返回字符串，str() 对两者都安全）
        date_map = {str(item["date"]): item for item in stats}
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
