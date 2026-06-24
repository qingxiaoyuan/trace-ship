"""
Jenkins 集成序列化器

包含 Jenkins 任务配置（JenkinsJob）和构建记录（JenkinsBuild）的序列化器。
"""
from rest_framework import serializers

from apps.credential.models import Credential
from apps.jenkins.models import JenkinsBuild, JenkinsJob
from apps.project.models import ProjectIntegration, ProjectMember


class JenkinsJobSerializer(serializers.ModelSerializer):
    """
    Jenkins 任务序列化器

    写入时校验项目归属、凭证模式与集成类型一致性。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    credential_name = serializers.CharField(source="credential.name", read_only=True)
    specified_user_name = serializers.CharField(source="specified_user.nickname", read_only=True, default="")

    class Meta:
        model = JenkinsJob
        fields = [
            "id", "project", "project_name", "integration", "name",
            "server_url", "job_name", "credential", "credential_name",
            "credential_mode", "specified_user", "specified_user_name",
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

    def validate_integration(self, value):
        """
        校验集成类型必须为 jenkins

        Args:
            value: ProjectIntegration 实例

        Returns:
            集成实例
        """
        if value and value.integration_type != "jenkins":
            raise serializers.ValidationError("集成类型必须为 jenkins")
        return value

    def validate(self, attrs: dict) -> dict:
        """
        校验凭证模式与凭证/指定用户的匹配关系

        Args:
            attrs: 待校验属性

        Returns:
            校验通过的字典
        """
        credential_mode = attrs.get("credential_mode", getattr(self.instance, "credential_mode", "fixed"))
        credential = attrs.get("credential", getattr(self.instance, "credential", None))
        specified_user = attrs.get("specified_user", getattr(self.instance, "specified_user", None))

        if credential_mode == "fixed" and credential is None:
            raise serializers.ValidationError({"credential": "fixed 凭证模式必须选择凭证"})
        if credential_mode != "fixed" and credential is not None:
            raise serializers.ValidationError({"credential": "非 fixed 凭证模式不能直接绑定凭证"})
        if credential_mode == "specified_user" and specified_user is None:
            raise serializers.ValidationError({"specified_user": "specified_user 凭证模式必须指定用户"})
        if credential_mode != "specified_user" and specified_user is not None:
            raise serializers.ValidationError({"specified_user": "仅 specified_user 凭证模式可以指定用户"})

        # 若选择了凭证，简单校验类型
        if credential and credential.cred_type != "jenkins_token":
            raise serializers.ValidationError({"credential": "Jenkins 任务需使用 jenkins_token 类型凭证"})
        return attrs


class JenkinsJobListSerializer(serializers.ModelSerializer):
    """
    Jenkins 任务列表序列化器

    字段精简，适合列表展示。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)

    class Meta:
        model = JenkinsJob
        fields = [
            "id", "project", "project_name", "name", "job_name",
            "server_url", "is_active", "created_at", "updated_at",
        ]


class JenkinsBuildSerializer(serializers.ModelSerializer):
    """
    Jenkins 构建记录序列化器

    读取时展开任务名称与项目信息。
    """

    job_name = serializers.CharField(source="job.name", read_only=True)
    project_id = serializers.UUIDField(source="job.project_id", read_only=True)
    project_name = serializers.CharField(source="job.project.name", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = JenkinsBuild
        fields = [
            "id", "job", "job_name", "project_id", "project_name",
            "queue_id", "build_number", "status", "status_display",
            "params", "log_url", "artifact_info", "started_at", "finished_at",
            "created_at", "updated_at",
        ]
        read_only_fields = fields
