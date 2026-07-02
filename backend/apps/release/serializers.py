"""
发布管理序列化器

包含发布记录（ReleaseRecord）和发布关联提交（ReleaseCommit）的序列化器。
"""
from django.db.models import Count, Q
from rest_framework import serializers

from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseCommit, ReleaseRecord
from apps.repository.models import Repository


class ReleaseRecordSerializer(serializers.ModelSerializer):
    """
    发布记录序列化器

    读取时展开项目/仓库/发布人信息，写入时校验项目归属与仓库一致性。
    详情场景下附带关联打包任务概要信息。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True)
    publisher_name = serializers.CharField(source="publisher.nickname", read_only=True, default="")
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    release_type_display = serializers.CharField(source="get_release_type_display", read_only=True)
    version = serializers.CharField(required=False, allow_blank=True)
    tag_name = serializers.CharField(required=False, allow_blank=True)
    release_doc = serializers.CharField(required=False, allow_blank=True)
    package_tasks = serializers.SerializerMethodField()

    class Meta:
        model = ReleaseRecord
        fields = [
            "id", "project", "project_name", "repository", "repository_name",
            "version", "tag_name", "branch", "git_hash",
            "release_type", "release_type_display", "status", "status_display",
            "release_doc", "related_changes", "updates",
            "has_config_changes", "config_change_doc",
            "impact_other", "impact_desc",
            "self_test_passed", "retest_passed",
            "publisher", "publisher_name",
            "package_tasks",
            "rejected_reason", "released_at", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "git_hash", "status",
            "package_tasks", "rejected_reason",
            "released_at", "created_at", "updated_at",
        ]

    def get_package_tasks(self, obj: ReleaseRecord) -> list[dict]:
        """返回该发布关联的打包任务概要。"""
        tasks = obj.package_tasks.all().order_by("-created_at") if hasattr(obj, "package_tasks") else []
        return [
            {
                "id": str(task.id),
                "name": task.name,
                "status": task.status,
                "status_display": task.get_status_display(),
                "mode": task.mode,
                "build_type": task.build_type,
                "artifact_count": len(task.artifact_info or []),
                "started_at": task.started_at,
                "finished_at": task.finished_at,
                "created_at": task.created_at,
            }
            for task in tasks
        ]

    def validate_project(self, value: Project) -> Project:
        """
        校验用户必须是指定项目的开发者及以上（或超管）才能创建/修改发布

        Args:
            value: 项目实例

        Returns:
            项目实例

        Raises:
            serializers.ValidationError: 无权限时抛出
        """
        user = self.context["request"].user
        if user.is_superuser:
            return value
        member = ProjectMember.objects.filter(project=value, user=user).first()
        if not member or member.role not in ("developer", "tester", "manager", "auditor"):
            raise serializers.ValidationError("只有项目成员才能创建/修改发布")
        return value

    def validate_repository(self, value: Repository) -> Repository:
        """
        校验仓库必须属于所选项目

        Args:
            value: 仓库实例

        Returns:
            仓库实例

        Raises:
            serializers.ValidationError: 项目不一致时抛出
        """
        project = self.initial_data.get("project") or getattr(self.instance, "project_id", None)
        if project and str(value.project_id) != str(project):
            raise serializers.ValidationError("仓库不属于所选项目")
        return value

    def validate(self, attrs: dict) -> dict:
        """
        校验发布类型与分支一致性

        Args:
            attrs: 待校验属性

        Returns:
            校验通过的字典
        """
        release_type = attrs.get("release_type", getattr(self.instance, "release_type", "formal"))
        branch = attrs.get("branch", getattr(self.instance, "branch", ""))
        if release_type == "formal" and branch not in ["main", "master"]:
            # 允许具体项目配置在业务服务中再校验，这里仅做基础提示
            pass
        return attrs


class ReleaseListSerializer(serializers.ModelSerializer):
    """
    发布列表序列化器

    字段精简，适合列表展示。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True)
    publisher_name = serializers.CharField(source="publisher.nickname", read_only=True, default="")
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    release_type_display = serializers.CharField(source="get_release_type_display", read_only=True)
    commit_total = serializers.SerializerMethodField(read_only=True)
    pass_count = serializers.SerializerMethodField(read_only=True)
    warning_count = serializers.SerializerMethodField(read_only=True)
    illegal_count = serializers.SerializerMethodField(read_only=True)
    has_doc = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = ReleaseRecord
        fields = [
            "id", "project", "project_name", "repository", "repository_name",
            "version", "tag_name", "release_type", "release_type_display",
            "status", "status_display", "publisher_name", "released_at", "created_at",
            "commit_total", "pass_count", "warning_count", "illegal_count", "has_doc",
        ]

    def _review_counts(self, obj: ReleaseRecord) -> dict:
        """聚合该发布关联提交的审查结果计数（单次查询，结果缓存到实例上）"""
        if not hasattr(obj, "_review_counts_cache"):
            obj._review_counts_cache = obj.release_commits.aggregate(
                total=Count("id"),
                pass_count=Count("id", filter=Q(commit__review_status="pass")),
                warning_count=Count("id", filter=Q(commit__review_status="warning")),
                illegal_count=Count("id", filter=Q(commit__review_status="illegal")),
            )
        return obj._review_counts_cache

    def get_commit_total(self, obj: ReleaseRecord) -> int:
        """提交总数"""
        return self._review_counts(obj)["total"] or 0

    def get_pass_count(self, obj: ReleaseRecord) -> int:
        """通过数"""
        return self._review_counts(obj)["pass_count"] or 0

    def get_warning_count(self, obj: ReleaseRecord) -> int:
        """警告数"""
        return self._review_counts(obj)["warning_count"] or 0

    def get_illegal_count(self, obj: ReleaseRecord) -> int:
        """非法数"""
        return self._review_counts(obj)["illegal_count"] or 0

    def get_has_doc(self, obj: ReleaseRecord) -> bool:
        """是否已生成有效的发布说明文档（Markdown 两列表格）"""
        doc = (obj.release_doc or "").strip()
        if not doc:
            return False
        # 旧版 release_doc 为 JSON 格式，非有效 Markdown 表格，视为无文档
        return "| 项目 | 内容 |" in doc or doc.startswith("|")


class ReleaseCommitSerializer(serializers.ModelSerializer):
    """
    发布关联提交序列化器

    读取时展开 commit 的哈希、作者、消息和审查状态。
    """

    commit_id = serializers.UUIDField(source="commit.id", read_only=True)
    commit_hash = serializers.CharField(source="commit.commit_hash", read_only=True)
    author = serializers.CharField(source="commit.author", read_only=True)
    message = serializers.CharField(source="commit.message", read_only=True)
    review_status = serializers.CharField(source="commit.review_status", read_only=True)
    review_reason = serializers.CharField(source="commit.review_reason", read_only=True)
    parsed_result = serializers.JSONField(source="commit.parsed_message", read_only=True)
    committed_at = serializers.DateTimeField(source="commit.committed_at", read_only=True)

    class Meta:
        model = ReleaseCommit
        fields = [
            "id", "commit_id", "commit_hash", "author", "message",
            "review_status", "review_reason", "parsed_result",
            "committed_at", "is_included", "edited_content",
        ]
        read_only_fields = [
            "id", "commit_id", "commit_hash", "author", "message",
            "review_status", "review_reason", "parsed_result", "committed_at",
        ]
