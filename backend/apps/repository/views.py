from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated

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


class RepositoryViewSet(viewsets.ModelViewSet):
    queryset = Repository.objects.all()
    serializer_class = RepositorySerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["project", "repo_type", "vendor", "health_status"]
    search_fields = ["name", "url", "external_identity"]
    ordering_fields = ["created_at", "last_sync_at"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        if self.action == "list":
            return RepositoryListSerializer
        return RepositorySerializer

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Repository.objects.none()
        user = self.request.user
        queryset = Repository.objects.select_related("project", "credential", "specified_user", "integration")
        if user.is_superuser:
            return queryset.all()
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        if self.action in ["create", "update", "partial_update", "destroy"]:
            return [IsAuthenticated(), IsProjectManager()]
        if self.action in ["test", "sync_commits"]:
            return [IsAuthenticated(), IsProjectDeveloper()]
        return super().get_permissions()

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return success_response(serializer.data)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        return success_response(serializer.data, message="创建成功", status=201)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return success_response(serializer.data, message="更新成功")

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self.perform_destroy(instance)
        return success_response(None, message="删除成功")

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        """测试仓库连通性"""
        repo = self.get_object()
        result = RepositoryService.test_connection(repo, request.user)
        return success_response(result)

    @action(detail=True, methods=["get"])
    def branches(self, request, pk=None):
        """获取分支列表"""
        repo = self.get_object()
        try:
            branches = RepositoryService.list_branches(repo, request.user)
            return success_response(branches)
        except Exception as exc:
            return error_response(50000, f"获取分支失败: {exc}", status_code=500)

    @action(detail=True, methods=["get"])
    def commits(self, request, pk=None):
        """获取该仓库已同步的 commit 列表"""
        repo = self.get_object()
        queryset = repo.commits.select_related("project", "repository").all()
        review_status = request.query_params.get("review_status")
        if review_status:
            queryset = queryset.filter(review_status=review_status)
        queryset = self.filter_queryset(queryset)
        page = self.paginate_queryset(queryset)
        serializer = CommitRecordSerializer(page, many=True, context={"request": request})
        return self.get_paginated_response(serializer.data)

    @action(detail=True, methods=["post"], url_path="sync-commits")
    def sync_commits(self, request, pk=None):
        """手动同步 commits"""
        repo = self.get_object()
        branch = request.data.get("branch", repo.default_branch)
        try:
            result = RepositoryService.sync_commits(repo, branch, request.user)
            return success_response(result)
        except Exception as exc:
            return error_response(50000, f"同步失败: {exc}", status_code=500)

    @action(detail=False, methods=["get"])
    def vendors(self, request):
        """支持的 vendor 列表"""
        return success_response([
            {"value": "gitlab", "label": "GitLab"},
            {"value": "gitea", "label": "Gitea"},
            {"value": "github", "label": "GitHub"},
            {"value": "gitee", "label": "Gitee"},
            {"value": "svn", "label": "SVN"},
        ])


class CommitRecordViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = CommitRecord.objects.all()
    serializer_class = CommitRecordSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ["project", "repository", "branch", "review_status", "author"]
    search_fields = ["message", "commit_hash"]
    ordering_fields = ["committed_at", "created_at"]
    ordering = ["-committed_at"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return CommitRecord.objects.none()
        user = self.request.user
        queryset = CommitRecord.objects.select_related("project", "repository")
        if user.is_superuser:
            return queryset.all()
        project_ids = ProjectMember.objects.filter(user=user).values_list("project_id", flat=True)
        return queryset.filter(project_id__in=project_ids)

    def get_permissions(self):
        if self.action == "review":
            return [IsAuthenticated(), IsProjectTester()]
        return super().get_permissions()

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = self.get_serializer(instance)
        return success_response(serializer.data)

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        """人工复核 commit"""
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

    @action(detail=True, methods=["get"], url_path="ai-review")
    def ai_review(self, request, pk=None):
        """AI 审查建议（阶段二占位）"""
        commit = self.get_object()
        result = RepositoryService.ai_review(commit)
        return success_response(result)
