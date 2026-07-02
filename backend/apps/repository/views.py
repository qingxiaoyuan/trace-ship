"""
仓库管理视图

提供仓库 CRUD、连通性测试、分支/commit 查询、手动同步以及提交记录审查接口。
"""
from typing import Any, Dict

from django_filters.rest_framework import DjangoFilterBackend
from django.db.models import Count, Q
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from utils.viewsets import StandardModelViewSet, StandardReadOnlyModelViewSet

from apps.project.models import ProjectMember
from apps.repository.models import CommitRecord, Repository
from apps.repository.serializers import (
    CommitRecordSerializer,
    RepositoryListSerializer,
    RepositorySerializer,
)
from apps.repository.services import RepositoryService
from utils.permissions import IsProjectDeveloper, IsProjectManager, IsProjectTester
from utils.response import error_response, success_response
from apps.release.services import ReleaseService, ReleaseValidator, VersionCalculator
from utils.provider.exceptions import ProviderError


class RepositoryViewSet(StandardModelViewSet):
    """
    仓库管理视图集

    - 项目管理员可创建/修改/删除仓库
    - 项目开发人员可执行测试、同步等操作
    - 普通成员仅可查看自己参与项目的仓库
    """

    queryset = Repository.objects.all()
    serializer_class = RepositorySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["project", "repo_type", "vendor", "health_status", "credential"]
    search_fields = ["name", "url", "external_identity"]
    ordering_fields = ["created_at", "last_sync_at"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        """
        列表接口使用精简序列化器

        Returns:
            Serializer 类
        """
        if self.action == "list":
            return RepositoryListSerializer
        return RepositorySerializer

    def get_queryset(self):
        """
        根据用户身份返回可见仓库

        Returns:
            Repository QuerySet
        """
        if getattr(self, "swagger_fake_view", False):
            return Repository.objects.none()
        user = self.request.user
        queryset = Repository.objects.select_related("project", "credential")
        if user.is_superuser:
            return queryset.all()
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        """
        写操作需项目管理员，测试/同步需项目开发人员

        Returns:
            权限实例列表
        """
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsAuthenticated(), IsProjectManager()]
        if self.action in ["test", "sync_commits"]:
            return [IsAuthenticated(), IsProjectDeveloper()]
        return super().get_permissions()

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        """查询单个仓库详情"""
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return success_response(serializer.data)

    def create(self, request: Request, *args, **kwargs) -> Response:
        """创建仓库"""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return success_response(serializer.data, message="创建成功", status=201)

    def update(self, request: Request, *args, **kwargs) -> Response:
        """更新仓库"""
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return success_response(serializer.data, message="更新成功")

    def destroy(self, request: Request, *args, **kwargs) -> Response:
        """删除仓库"""
        instance = self.get_object()
        self.perform_destroy(instance)
        return success_response(None, message="删除成功")

    @action(detail=True, methods=["post"])
    def test(self, request: Request, pk=None) -> Response:
        """
        测试仓库连通性

        Args:
            request: DRF Request
            pk: 仓库主键

        Returns:
            连通性测试结果
        """
        repo = self.get_object()
        result = RepositoryService.test_connection(repo, request.user)
        return success_response(result)

    @action(detail=True, methods=["get"])
    def branches(self, request: Request, pk=None) -> Response:
        """
        获取分支列表

        Args:
            request: DRF Request
            pk: 仓库主键

        Returns:
            分支信息列表
        """
        repo = self.get_object()
        try:
            branches = RepositoryService.list_branches(repo, request.user)
            return success_response(branches)
        except Exception as exc:
            return error_response(50000, f"获取分支失败: {exc}", status_code=500)

    @action(detail=True, methods=["get"])
    def tags(self, request: Request, pk=None) -> Response:
        """
        获取仓库标签列表

        Args:
            request: DRF Request
            pk: 仓库主键

        Returns:
            标签信息列表（SVN 仓库返回空列表）
        """
        repo = self.get_object()
        try:
            tags = RepositoryService.list_tags(repo, request.user)
            return success_response(tags)
        except Exception as exc:
            return error_response(50000, f"获取标签失败: {exc}", status_code=500)

    @action(detail=True, methods=["get"])
    def commits(self, request: Request, pk=None) -> Response:
        """
        获取该仓库已同步的 commit 列表

        Args:
            request: DRF Request
            pk: 仓库主键

        Returns:
            分页后的提交记录列表
        """
        repo = self.get_object()
        queryset = repo.commits.select_related("project", "repository").order_by("-committed_at")
        review_status = request.query_params.get("review_status")
        if review_status:
            queryset = queryset.filter(review_status=review_status)
        branch = request.query_params.get("branch")
        if branch:
            queryset = queryset.filter(branch=branch)
        page = self.paginate_queryset(queryset)
        serializer = CommitRecordSerializer(page, many=True, context={"request": request})
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=["post"], url_path="sync-commits")
    def sync_commits(self, request: Request, pk=None) -> Response:
        """
        手动同步 commits

        Args:
            request: DRF Request，body 可指定 branch
            pk: 仓库主键

        Returns:
            同步结果统计
        """
        repo = self.get_object()
        branch = request.data.get("branch", repo.default_branch)
        try:
            result = RepositoryService.sync_commits(repo, branch, request.user)
            return success_response(result)
        except Exception as exc:
            return error_response(50000, f"同步失败: {exc}", status_code=500)

    @action(detail=True, methods=["get"], url_path="next-version")
    def next_version(self, request: Request, pk=None) -> Response:
        """
        获取下一个建议版本号与 Tag 名称

        基于仓库现有 Tag 列表和项目 version_rule 自动计算，
        无匹配 Tag 时返回项目初始版本号。

        Args:
            request: DRF Request，query 参数 release_type
            pk: 仓库主键

        Returns:
            建议版本信息，含顶层当前类型字段与 all_types 三类详情
        """
        repo = self.get_object()
        release_type = request.query_params.get("release_type", "formal")
        if release_type not in ("formal", "rc", "beta"):
            return error_response(40001, "无效的发布类型")

        try:
            provider = ReleaseService._get_provider(repo, request.user)
            tags = provider.list_tags(repo.external_identity)
        except ProviderError as exc:
            return error_response(50000, f"获取 tag 列表失败: {exc}", status_code=500)
        except Exception as exc:
            return error_response(50000, f"计算版本号失败: {exc}", status_code=500)

        version_rule = repo.project.version_rule or {}
        calculator = VersionCalculator(version_rule)

        # 计算三类发布类型各自的结果
        all_types: Dict[str, Dict[str, Any]] = {}
        for rt in ("formal", "rc", "beta"):
            rt_version, rt_tag_name = calculator.calculate(tags, release_type=rt)
            all_types[rt] = {
                "latest_tag": calculator.find_latest_tag_by_type(tags, rt),
                "next_version": rt_version,
                "next_tag_name": rt_tag_name,
            }

        version, tag_name = calculator.calculate(tags, release_type=release_type)
        latest = calculator.find_latest_tag_by_type(tags, release_type)
        return success_response({
            "latest_tag": latest,
            "next_version": version,
            "next_tag_name": tag_name,
            "has_existing_tags": len(tags) > 0,
            "all_types": all_types,
        })

    @action(detail=True, methods=["get"], url_path="changes-preview")
    def changes_preview(self, request: Request, pk=None) -> Response:
        """
        预览上个 Tag 到本次基线之间的 commits 与 MRs，并自动解析更新内容

        不落库，供创建发布表单实时预览。

        Args:
            request: DRF Request，query 参数 branch
            pk: 仓库主键

        Returns:
            预览数据
        """
        repo = self.get_object()
        branch = request.query_params.get("branch", "")
        if not branch:
            return error_response(40001, "缺少 branch 参数")
        try:
            data = ReleaseService.preview_changes(repo, branch, request.user)
            return success_response(data)
        except Exception as exc:
            return error_response(50000, f"预览失败: {exc}", status_code=500)

    @action(detail=True, methods=["get"], url_path="review-range")
    def review_range(self, request: Request, pk=None) -> Response:
        """
        按 Tag 区间拉取 commits 与 MRs 并做合规审查（不落库）

        query 参数 tag：指定 Tag 名称，审查该 Tag 与上一个 Tag 之间的提交；
        为空或 "latest" 时审查最新 Tag 到分支 HEAD 之间的提交。

        Args:
            request: DRF Request，query 参数 tag
            pk: 仓库主键

        Returns:
            审查结果，含 commits / merge_requests / stats
        """
        repo = self.get_object()
        tag = request.query_params.get("tag") or "latest"
        try:
            result = RepositoryService.review_range(repo, tag, request.user)
            return success_response(result)
        except Exception as exc:
            return error_response(50000, f"拉取审查失败: {exc}", status_code=500)

    @action(detail=False, methods=["get"])
    def stats(self, request: Request) -> Response:
        """仓库统计：仓库总数 / 健康数 / Git 仓库数 / SVN 仓库数。"""
        queryset = self.get_queryset()
        aggregate = queryset.aggregate(
            total=Count("id"),
            healthy_count=Count("id", filter=Q(health_status="healthy")),
            git_count=Count("id", filter=Q(repo_type="git")),
            svn_count=Count("id", filter=Q(repo_type="svn")),
        )
        return success_response({
            "total": aggregate["total"] or 0,
            "healthy_count": aggregate["healthy_count"] or 0,
            "git_count": aggregate["git_count"] or 0,
            "svn_count": aggregate["svn_count"] or 0,
        })

    @action(detail=False, methods=["get"], url_path="compliance-stats")
    def compliance_stats(self, request: Request) -> Response:
        """
        按仓库聚合提交审查结果计数，用于「仓库合规扫描」列表。

        单次分组查询统计每个仓库的通过 / 警告 / 非法 / 未审查提交数，
        再与仓库基本信息合并返回。
        """
        queryset = self.get_queryset()
        # 单次分组聚合：按 repository_id 统计各审查状态计数
        stats_qs = (
            CommitRecord.objects.filter(repository__in=queryset)
            .values("repository_id")
            .annotate(
                commit_total=Count("id"),
                pass_count=Count("id", filter=Q(review_status="pass")),
                warning_count=Count("id", filter=Q(review_status="warning")),
                illegal_count=Count("id", filter=Q(review_status="illegal")),
                unreviewed_count=Count("id", filter=Q(review_status="unreviewed")),
            )
        )
        stat_map = {item["repository_id"]: item for item in stats_qs}

        result = []
        for repo in queryset:
            stat = stat_map.get(repo.id, {})
            result.append({
                "id": str(repo.id),
                "name": repo.name,
                "project_id": str(repo.project_id) if repo.project_id else "",
                "project_name": repo.project.name if repo.project else "",
                "repo_type": repo.repo_type,
                "vendor": repo.vendor,
                "default_branch": repo.default_branch,
                "health_status": repo.health_status,
                "last_sync_at": repo.last_sync_at,
                "commit_total": stat.get("commit_total", 0),
                "pass_count": stat.get("pass_count", 0),
                "warning_count": stat.get("warning_count", 0),
                "illegal_count": stat.get("illegal_count", 0),
                "unreviewed_count": stat.get("unreviewed_count", 0),
            })
        return success_response(result)

    @action(detail=False, methods=["get"])
    def vendors(self, request: Request) -> Response:
        """
        支持的 vendor 列表

        Args:
            request: DRF Request

        Returns:
            vendor 枚举列表
        """
        return success_response([
            {"value": "gitlab", "label": "GitLab"},
            {"value": "gitea", "label": "Gitea"},
            {"value": "github", "label": "GitHub"},
            {"value": "gitee", "label": "Gitee"},
            {"value": "svn", "label": "SVN"},
        ])


class CommitRecordViewSet(StandardReadOnlyModelViewSet):
    """
    提交记录视图集

    默认只读，测试人员可执行人工复核。
    """
    queryset = CommitRecord.objects.all()
    serializer_class = CommitRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["project", "repository", "branch", "review_status", "author"]
    search_fields = ["message", "commit_hash"]
    ordering_fields = ["committed_at", "created_at"]
    ordering = ["-committed_at"]

    def get_queryset(self):
        """
        根据用户身份返回可见提交记录

        Returns:
            CommitRecord QuerySet
        """
        if getattr(self, "swagger_fake_view", False):
            return CommitRecord.objects.none()
        user = self.request.user
        queryset = CommitRecord.objects.select_related("project", "repository")
        if user.is_superuser:
            return queryset.all()
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        """
        复核操作需测试人员权限

        Returns:
            权限实例列表
        """
        if self.action == "review":
            return [IsAuthenticated(), IsProjectTester()]
        return super().get_permissions()

    def retrieve(self, request: Request, *args, **kwargs) -> Response:
        """查询单条提交记录详情"""
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return success_response(serializer.data)

    @action(detail=True, methods=["post"])
    def review(self, request: Request, pk=None) -> Response:
        """
        人工复核 commit

        Args:
            request: DRF Request，body 包含 review_status 和可选 reason
            pk: 提交记录主键

        Returns:
            复核后的审查状态
        """
        commit = self.get_object()
        new_status = request.data.get("review_status")
        reason = request.data.get("reason", "")
        if new_status not in ["pass", "warning", "illegal"]:
            return error_response(40001, "无效的审查状态")
        commit.review_status = new_status
        commit.review_reason = reason
        commit.save(update_fields=["review_status", "review_reason", "updated_at"])
        return success_response({
            "id": str(commit.id),
            "review_status": commit.review_status,
            "reason": commit.review_reason,
        })
