"""
Jenkins 集成序列化器

包含 Jenkins 任务配置（JenkinsJob）和构建记录（JenkinsBuild）的序列化器。
"""
from rest_framework import serializers

from apps.credential.models import Credential
from apps.jenkins.models import JenkinsBuild, JenkinsJob
from apps.project.models import ProjectMember


class JenkinsJobSerializer(serializers.ModelSerializer):
    """
    Jenkins 任务序列化器

    写入时校验项目归属、凭证模式与仓库归属一致性。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    credential_name = serializers.CharField(source="credential.name", read_only=True, default="")
    repository_name = serializers.CharField(source="repository.name", read_only=True, default="")

    class Meta:
        model = JenkinsJob
        fields = [
            "id", "project", "project_name", "repository", "repository_name", "name",
            "server_url", "job_name", "credential", "credential_name",
            "credential_mode",
            "params_template", "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_project(self, value):
        """
        校验用户只能为所属项目创建 Jenkins 任务

        Args:
            value: 项目实例

        Returns:
            项目实例
        """
        user = self.context["request"].user
        if user.is_superuser:
            return value
        member = ProjectMember.objects.filter(project=value, user=user).first()
        if not member:
            raise serializers.ValidationError("你只能为所属项目创建 Jenkins 任务")
        if member.role != "manager":
            raise serializers.ValidationError("只有项目管理员才能创建/修改 Jenkins 任务")
        return value

    def validate_repository(self, value):
        """
        校验关联仓库必须属于当前项目

        Args:
            value: Repository 实例

        Returns:
            仓库实例
        """
        if value is None:
            return value
        project = self.instance.project if self.instance else self.initial_data.get("project")
        if isinstance(project, str):
            project = getattr(self.instance, "project_id", project)
        if str(value.project_id) != str(project):
            raise serializers.ValidationError("关联仓库必须属于当前项目")
        return value

    def validate(self, attrs: dict) -> dict:
        """
        校验凭证来源与绑定凭证的匹配关系

        Args:
            attrs: 待校验属性

        Returns:
            校验通过的字典
        """
        credential_mode = attrs.get("credential_mode", getattr(self.instance, "credential_mode", "project"))
        credential = attrs.get("credential", getattr(self.instance, "credential", None))

        if credential is None:
            raise serializers.ValidationError({"credential": "必须选择凭证"})
        if credential_mode not in ("personal", "project"):
            raise serializers.ValidationError({"credential_mode": "凭证来源只能为 personal 或 project"})

        if credential.cred_type != "jenkins_token":
            raise serializers.ValidationError({"credential": "Jenkins 任务需使用 jenkins_token 类型凭证"})

        if credential_mode == "personal":
            if credential.scope != "personal":
                raise serializers.ValidationError({"credential": "个人来源必须选择个人凭证"})
            if credential.owner_id != self.context["request"].user.id:
                raise serializers.ValidationError({"credential": "个人来源只能选择自己的凭证"})
        else:  # project
            project = attrs.get("project", getattr(self.instance, "project", None))
            project_id = project.id if project else None
            if credential.scope != "project":
                raise serializers.ValidationError({"credential": "项目来源必须选择项目凭证"})
            if credential.project_id != project_id:
                raise serializers.ValidationError({"credential": "项目来源只能选择挂靠在当前项目下的凭证"})
        return attrs


class JenkinsJobListSerializer(serializers.ModelSerializer):
    """
    Jenkins 任务列表序列化器

    字段精简，适合列表展示；额外返回最近一次构建的概要信息。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True, default="")
    latest_build = serializers.SerializerMethodField()

    class Meta:
        model = JenkinsJob
        fields = [
            "id", "project", "project_name", "repository", "repository_name", "name", "job_name",
            "server_url", "is_active", "latest_build", "created_at", "updated_at",
        ]

    def get_latest_build(self, obj: JenkinsJob) -> dict:
        """
        获取该任务最近一次构建的概要

        建议在视图层通过 prefetch_related('builds') 预加载以避免 N+1 查询。

        Args:
            obj: JenkinsJob 实例

        Returns:
            最近构建概要字典，无构建记录时返回 None
        """
        builds = obj.builds.all() if hasattr(obj, "builds") else []
        latest = None
        for b in builds:
            if latest is None or (b.created_at and latest.created_at and b.created_at > latest.created_at):
                latest = b
        if latest is None:
            return None
        return {
            "id": str(latest.id),
            "build_number": latest.build_number,
            "status": latest.status,
            "started_at": latest.started_at.isoformat() if latest.started_at else None,
            "created_at": latest.created_at.isoformat() if latest.created_at else None,
        }


class JenkinsBuildSerializer(serializers.ModelSerializer):
    """
    Jenkins 构建记录序列化器

    读取时展开任务名称与项目信息，以及触发人昵称。
    """

    job_name = serializers.CharField(source="job.name", read_only=True)
    project_id = serializers.UUIDField(source="job.project_id", read_only=True)
    project_name = serializers.CharField(source="job.project.name", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    triggered_by_name = serializers.CharField(source="triggered_by.nickname", read_only=True, default="")

    class Meta:
        model = JenkinsBuild
        fields = [
            "id", "job", "job_name", "project_id", "project_name",
            "triggered_by", "triggered_by_name",
            "queue_id", "build_number", "status", "status_display",
            "params", "log_url", "artifact_info",
            "duration", "estimated_duration",
            "started_at", "finished_at",
            "created_at", "updated_at",
        ]
        read_only_fields = fields
