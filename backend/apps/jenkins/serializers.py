"""
Jenkins 集成序列化器

包含 Jenkins 打包预设、任务配置和构建记录的序列化器。
"""
from rest_framework import serializers

from apps.jenkins.models import JenkinsBuild, JenkinsBuildPreset, JenkinsJob
from apps.project.models import ProjectMember
from apps.system.models import SystemConfig


class JenkinsBuildPresetSerializer(serializers.ModelSerializer):
    """
    Jenkins 打包预设序列化器

    预设维护简单模式可选的 Docker 镜像白名单和镜像内脚本入口。
    """

    build_type_display = serializers.CharField(source="get_build_type_display", read_only=True)

    class Meta:
        model = JenkinsBuildPreset
        fields = [
            "id", "name", "build_type", "build_type_display", "image",
            "script_entry", "default_build_path", "default_output_path",
            "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "build_type_display", "created_at", "updated_at"]


class JenkinsJobSerializer(serializers.ModelSerializer):
    """
    Jenkins 任务序列化器

    写入时按简单 / 高级模式校验任务配置。
    """

    project_id = serializers.UUIDField(source="project.id", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_id = serializers.UUIDField(source="repository.id", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True, default="")
    credential_id = serializers.UUIDField(source="credential.id", read_only=True)
    credential_name = serializers.CharField(source="credential.name", read_only=True, default="")
    build_preset_id = serializers.UUIDField(source="build_preset.id", read_only=True)
    build_preset_name = serializers.CharField(source="build_preset.name", read_only=True, default="")
    config_mode_display = serializers.CharField(source="get_config_mode_display", read_only=True)
    build_type_display = serializers.CharField(source="get_build_type_display", read_only=True)

    class Meta:
        model = JenkinsJob
        fields = [
            "id", "project", "project_id", "project_name",
            "repository", "repository_id", "repository_name",
            "config_mode", "config_mode_display", "build_type", "build_type_display",
            "build_preset", "build_preset_id", "build_preset_name",
            "name", "server_url", "job_name",
            "credential", "credential_id", "credential_name", "credential_mode",
            "params_template", "build_path", "output_path",
            "auto_build_on_release", "managed_job", "pipeline_config",
            "is_active", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "project_id", "project_name", "repository_id", "repository_name",
            "credential_id", "credential_name", "build_preset_id", "build_preset_name",
            "config_mode_display", "build_type_display", "server_url",
            "managed_job", "pipeline_config",
            "created_at", "updated_at",
        ]

    def validate_project(self, value):
        """校验用户只能为所属项目创建 Jenkins 任务。"""
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
        """校验关联仓库必须属于当前项目。"""
        if value is None:
            return value
        project = self.instance.project if self.instance else self.initial_data.get("project")
        if isinstance(project, str):
            project = getattr(self.instance, "project_id", project)
        if str(value.project_id) != str(project):
            raise serializers.ValidationError("关联仓库必须属于当前项目")
        return value

    def validate(self, attrs: dict) -> dict:
        """校验简单 / 高级模式的字段约束。"""
        config_mode = attrs.get("config_mode", getattr(self.instance, "config_mode", None))
        build_type = attrs.get("build_type", getattr(self.instance, "build_type", "web"))
        repository = attrs.get("repository", getattr(self.instance, "repository", None))
        build_preset = attrs.get("build_preset", getattr(self.instance, "build_preset", None))
        params_template = attrs.get("params_template", getattr(self.instance, "params_template", {}))
        credential_mode = attrs.get("credential_mode", getattr(self.instance, "credential_mode", "project"))
        credential = attrs.get("credential", getattr(self.instance, "credential", None))

        if config_mode not in ("simple", "advanced"):
            raise serializers.ValidationError({"config_mode": "配置模式只能为 simple 或 advanced"})
        if build_type not in ("web", "qt", "custom"):
            raise serializers.ValidationError({"build_type": "打包类型只能为 web、qt 或 custom"})
        if credential is None:
            raise serializers.ValidationError({"credential": "必须选择凭证"})
        if credential_mode not in ("personal", "project"):
            raise serializers.ValidationError({"credential_mode": "凭证来源只能为 personal 或 project"})
        if credential.cred_type != "jenkins_token":
            raise serializers.ValidationError({"credential": "Jenkins 任务需使用 jenkins_token 类型凭证"})

        if config_mode == "simple":
            if repository is None:
                raise serializers.ValidationError({"repository": "简单模式必须选择关联仓库"})
            if repository.repo_type != "git":
                raise serializers.ValidationError({"repository": "简单模式仅支持 Git 仓库"})
            if build_preset is None:
                raise serializers.ValidationError({"build_preset": "简单模式必须选择打包预设"})
            if not build_preset.is_active:
                raise serializers.ValidationError({"build_preset": "打包预设已停用"})
            if build_preset.build_type != build_type:
                raise serializers.ValidationError({"build_preset": "打包预设类型与任务类型不匹配"})
        elif not isinstance(params_template, dict):
            raise serializers.ValidationError({"params_template": "高级模式参数模板必须为 JSON 对象"})

        if credential_mode == "personal":
            if credential.scope != "personal":
                raise serializers.ValidationError({"credential": "个人来源必须选择个人凭证"})
            if credential.owner_id != self.context["request"].user.id:
                raise serializers.ValidationError({"credential": "个人来源只能选择自己的凭证"})
        else:
            project = attrs.get("project", getattr(self.instance, "project", None))
            project_id = project.id if project else None
            if credential.scope != "project":
                raise serializers.ValidationError({"credential": "项目来源必须选择项目凭证"})
            if credential.project_id != project_id:
                raise serializers.ValidationError({"credential": "项目来源只能选择挂靠在当前项目下的凭证"})

        return attrs

    @staticmethod
    def _get_global_server_url() -> str:
        """读取系统级 Jenkins 地址。"""
        config = SystemConfig.objects.filter(key="jenkins.server_url").first()
        value = (config.value if config else "").strip().rstrip("/")
        if not value:
            raise serializers.ValidationError({"jenkins_server": "请先在系统参数中配置 jenkins.server_url"})
        return value

    def create(self, validated_data):
        """创建任务时写入系统级 Jenkins 地址快照。"""
        validated_data["server_url"] = self._get_global_server_url()
        return super().create(validated_data)

    def update(self, instance, validated_data):
        """更新任务时刷新系统级 Jenkins 地址快照。"""
        validated_data["server_url"] = self._get_global_server_url()
        return super().update(instance, validated_data)


class JenkinsJobListSerializer(serializers.ModelSerializer):
    """
    Jenkins 任务列表序列化器

    字段适合列表展示，并返回最近一次构建概要。
    """

    project_id = serializers.UUIDField(source="project.id", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_id = serializers.UUIDField(source="repository.id", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True, default="")
    credential_id = serializers.UUIDField(source="credential.id", read_only=True)
    build_preset_id = serializers.UUIDField(source="build_preset.id", read_only=True)
    build_preset_name = serializers.CharField(source="build_preset.name", read_only=True, default="")
    config_mode_display = serializers.CharField(source="get_config_mode_display", read_only=True)
    build_type_display = serializers.CharField(source="get_build_type_display", read_only=True)
    latest_build = serializers.SerializerMethodField()

    class Meta:
        model = JenkinsJob
        fields = [
            "id", "project", "project_id", "project_name",
            "repository", "repository_id", "repository_name",
            "config_mode", "config_mode_display", "build_type", "build_type_display",
            "build_preset", "build_preset_id", "build_preset_name",
            "name", "server_url", "job_name", "credential", "credential_id",
            "credential_mode", "params_template", "build_path", "output_path",
            "auto_build_on_release", "managed_job", "is_active",
            "latest_build", "created_at", "updated_at",
        ]

    def get_latest_build(self, obj: JenkinsJob) -> dict:
        """获取该任务最近一次构建的概要。"""
        builds = obj.builds.all() if hasattr(obj, "builds") else []
        latest = None
        for build in builds:
            if latest is None or (build.created_at and latest.created_at and build.created_at > latest.created_at):
                latest = build
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

    读取时展开任务、项目、发布与触发人信息。
    """

    job_name = serializers.CharField(source="job.name", read_only=True)
    project_id = serializers.UUIDField(source="job.project_id", read_only=True)
    project_name = serializers.CharField(source="job.project.name", read_only=True)
    release_id = serializers.UUIDField(source="release.id", read_only=True)
    release_version = serializers.CharField(source="release.version", read_only=True, default="")
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    triggered_by_name = serializers.CharField(source="triggered_by.nickname", read_only=True, default="")

    class Meta:
        model = JenkinsBuild
        fields = [
            "id", "job", "job_name", "project_id", "project_name",
            "release", "release_id", "release_version",
            "triggered_by", "triggered_by_name",
            "queue_id", "build_number", "status", "status_display",
            "params", "stage_info", "log_url", "artifact_info",
            "duration", "estimated_duration",
            "started_at", "finished_at",
            "created_at", "updated_at",
        ]
        read_only_fields = fields
