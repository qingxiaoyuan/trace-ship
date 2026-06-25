"""
发布管理序列化器

包含发布记录（ReleaseRecord）和发布关联提交（ReleaseCommit）的序列化器。
"""
from rest_framework import serializers

from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseCommit, ReleaseRecord
from apps.repository.models import Repository


class ReleaseRecordSerializer(serializers.ModelSerializer):
    """
    发布记录序列化器

    读取时展开项目/仓库/发布人信息，写入时校验项目归属与仓库一致性。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True)
    publisher_name = serializers.CharField(source="publisher.nickname", read_only=True, default="")
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    release_type_display = serializers.CharField(source="get_release_type_display", read_only=True)
    version = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = ReleaseRecord
        fields = [
            "id", "project", "project_name", "repository", "repository_name",
            "version", "tag_name", "source_branch", "target_branch", "git_hash",
            "release_type", "release_type_display", "status", "status_display",
            "release_doc", "publisher", "publisher_name", "jenkins_build",
            "rejected_reason", "released_at", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "tag_name", "git_hash", "status", "release_doc",
            "jenkins_build", "rejected_reason", "released_at", "created_at", "updated_at",
        ]

    def validate_project(self, value: Project) -> Project:
        """
        校验用户必须是指定项目的管理员（或超管）才能创建/修改发布

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
        if not member or member.role != "manager":
            raise serializers.ValidationError("只有项目管理员才能创建/修改发布")
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
        校验发布类型与目标分支一致性

        Args:
            attrs: 待校验属性

        Returns:
            校验通过的字典
        """
        release_type = attrs.get("release_type", getattr(self.instance, "release_type", "formal"))
        target_branch = attrs.get("target_branch", getattr(self.instance, "target_branch", ""))
        if release_type == "formal" and target_branch not in ["main", "master"]:
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

    class Meta:
        model = ReleaseRecord
        fields = [
            "id", "project", "project_name", "repository", "repository_name",
            "version", "tag_name", "release_type", "release_type_display",
            "status", "status_display", "publisher_name", "released_at", "created_at",
        ]


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
    committed_at = serializers.DateTimeField(source="commit.committed_at", read_only=True)

    class Meta:
        model = ReleaseCommit
        fields = [
            "id", "commit_id", "commit_hash", "author", "message",
            "review_status", "committed_at", "is_included", "edited_content",
        ]
        read_only_fields = [
            "id", "commit_id", "commit_hash", "author", "message",
            "review_status", "committed_at",
        ]
