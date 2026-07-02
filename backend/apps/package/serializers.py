"""
系统内置打包序列化器
"""
from rest_framework import serializers

from apps.package.models import PackageConfig, PackageImage, PackageTask
from apps.project.models import ProjectMember


def validate_safe_rel_path(value: str, field: str = "path") -> str:
    """校验并归一化工作区内相对路径。"""
    path = (value or ".").strip().replace("\\", "/").strip("/")
    if not path:
        return "."
    parts = [part for part in path.split("/") if part and part != "."]
    if any(part == ".." for part in parts):
        raise serializers.ValidationError({field: "路径不能包含 .."})
    return "/".join(parts) if parts else "."


class PackageImageSerializer(serializers.ModelSerializer):
    """系统级打包镜像序列化器。"""

    build_type_display = serializers.CharField(source="get_build_type_display", read_only=True)

    class Meta:
        model = PackageImage
        fields = [
            "id", "name", "build_type", "build_type_display",
            "image", "script_entry", "default_build_path", "default_output_path",
            "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "build_type_display", "created_at", "updated_at"]

    def validate_default_build_path(self, value: str) -> str:
        return validate_safe_rel_path(value, "default_build_path")

    def validate_default_output_path(self, value: str) -> str:
        return validate_safe_rel_path(value, "default_output_path")


class PackageConfigSerializer(serializers.ModelSerializer):
    """项目级打包配置序列化器。"""

    project_id = serializers.UUIDField(source="project.id", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_id = serializers.UUIDField(source="repository.id", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True, default="")
    image_id = serializers.UUIDField(source="image.id", read_only=True)
    image_name = serializers.CharField(source="image.name", read_only=True, default="")
    mode_display = serializers.CharField(source="get_mode_display", read_only=True)
    build_type_display = serializers.CharField(source="get_build_type_display", read_only=True)

    class Meta:
        model = PackageConfig
        fields = [
            "id", "project", "project_id", "project_name",
            "repository", "repository_id", "repository_name",
            "name", "mode", "mode_display", "build_type", "build_type_display",
            "image", "image_id", "image_name", "local_script",
            "build_path", "output_path", "env_vars",
            "auto_package_on_release", "is_active",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "project_id", "project_name", "repository_id", "repository_name",
            "image_id", "image_name", "mode_display", "build_type_display",
            "created_at", "updated_at",
        ]

    def validate_project(self, value):
        """校验项目管理员权限。"""
        user = self.context["request"].user
        if user.is_superuser:
            return value
        member = ProjectMember.objects.filter(project=value, user=user).first()
        if not member or member.role != "manager":
            raise serializers.ValidationError("只有项目管理员才能维护打包配置")
        return value

    def validate_build_path(self, value: str) -> str:
        return validate_safe_rel_path(value, "build_path")

    def validate_output_path(self, value: str) -> str:
        return validate_safe_rel_path(value, "output_path")

    def validate(self, attrs: dict) -> dict:
        """校验模式、仓库、镜像和脚本约束。"""
        project = attrs.get("project", getattr(self.instance, "project", None))
        repository = attrs.get("repository", getattr(self.instance, "repository", None))
        mode = attrs.get("mode", getattr(self.instance, "mode", "simple"))
        build_type = attrs.get("build_type", getattr(self.instance, "build_type", "web"))
        image = attrs.get("image", getattr(self.instance, "image", None))
        local_script = attrs.get("local_script", getattr(self.instance, "local_script", ""))
        env_vars = attrs.get("env_vars", getattr(self.instance, "env_vars", {}))

        if mode not in ("simple", "local"):
            raise serializers.ValidationError({"mode": "打包模式只能为 simple 或 local"})
        if build_type not in ("web", "qt"):
            raise serializers.ValidationError({"build_type": "第一阶段打包类型只能为 web 或 qt"})
        if repository and project and repository.project_id != project.id:
            raise serializers.ValidationError({"repository": "关联仓库必须属于当前项目"})
        if repository and repository.repo_type != "git":
            raise serializers.ValidationError({"repository": "打包配置第一阶段仅支持 Git 仓库"})
        if not isinstance(env_vars, dict):
            raise serializers.ValidationError({"env_vars": "环境变量必须为 JSON 对象"})

        if mode == "simple":
            if image is None:
                raise serializers.ValidationError({"image": "简易打包必须选择打包镜像"})
            if not image.is_active:
                raise serializers.ValidationError({"image": "打包镜像已停用"})
            if image.build_type != build_type:
                raise serializers.ValidationError({"image": "打包镜像类型与配置类型不匹配"})
        if mode == "local" and not (local_script or "").strip():
            raise serializers.ValidationError({"local_script": "本地打包必须填写打包脚本"})

        return attrs


class PackageTaskSerializer(serializers.ModelSerializer):
    """打包任务序列化器。"""

    config_name = serializers.CharField(source="config.name", read_only=True, default="")
    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True)
    release_version = serializers.CharField(source="release.version", read_only=True)
    triggered_by_name = serializers.CharField(source="triggered_by.nickname", read_only=True, default="")
    mode_display = serializers.CharField(source="get_mode_display", read_only=True)
    build_type_display = serializers.CharField(source="get_build_type_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = PackageTask
        fields = [
            "id", "config", "config_name", "release", "release_version",
            "project", "project_name", "repository", "repository_name",
            "triggered_by", "triggered_by_name", "name",
            "mode", "mode_display", "build_type", "build_type_display",
            "tag_name", "version", "commit_hash", "config_snapshot",
            "status", "status_display", "workspace_path", "log_path",
            "artifact_info", "duration", "error_message",
            "started_at", "finished_at", "created_at", "updated_at",
        ]
        read_only_fields = fields
