"""
系统内置打包序列化器
"""
import re
from pathlib import PurePosixPath, PureWindowsPath

from rest_framework import serializers

from apps.package.models import PackageConfig, PackageImage, PackageKnowledge, PackageNode, PackageTask
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
    """打包镜像序列化器。"""

    source_display = serializers.CharField(source="get_source_display", read_only=True)

    class Meta:
        model = PackageImage
        fields = [
            "id", "name",
            "source", "source_display", "registry_host", "repository",
            "image_name", "image_tag", "image",
            "script_entry", "default_build_path", "default_output_path",
            "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "source_display", "image", "created_at", "updated_at"]

    def validate_source(self, value: str) -> str:
        if value not in ("nexus", "local"):
            raise serializers.ValidationError("镜像来源仅支持 nexus / local")
        return value

    def validate(self, attrs: dict) -> dict:
        source = attrs.get("source", getattr(self.instance, "source", "nexus"))
        if source not in ("nexus", "local"):
            raise serializers.ValidationError({"source": "镜像来源仅支持 nexus / local"})
        image_name = attrs.get("image_name", getattr(self.instance, "image_name", ""))
        image_tag = attrs.get("image_tag", getattr(self.instance, "image_tag", ""))
        if not image_name:
            raise serializers.ValidationError({"image_name": "必须填写镜像名"})
        if not image_tag:
            raise serializers.ValidationError({"image_tag": "必须填写镜像标签"})
        return attrs

    def validate_default_build_path(self, value: str) -> str:
        return validate_safe_rel_path(value, "default_build_path")

    def validate_default_output_path(self, value: str) -> str:
        return validate_safe_rel_path(value, "default_output_path")


class PackageNodeSerializer(serializers.ModelSerializer):
    """远程打包节点序列化器。"""

    credential_id = serializers.UUIDField(source="credential.id", read_only=True)
    credential_name = serializers.CharField(source="credential.name", read_only=True, default="")
    os_type_display = serializers.CharField(source="get_os_type_display", read_only=True)
    created_by_name = serializers.CharField(source="created_by.nickname", read_only=True, default="")

    class Meta:
        model = PackageNode
        fields = [
            "id", "name", "host", "port", "os_type", "os_type_display",
            "credential", "credential_id", "credential_name",
            "work_root", "max_concurrency", "cpu_cores", "cpu_priority", "description", "is_active",
            "created_by", "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "credential_id", "credential_name", "os_type_display",
            "created_by", "created_by_name", "created_at", "updated_at",
        ]

    def validate_credential(self, value):
        """节点登录凭证必填且启用；类型与 os_type 的匹配在 validate 中校验。"""
        if value is None:
            raise serializers.ValidationError("必须选择登录凭证")
        if not value.is_active:
            raise serializers.ValidationError("登录凭证已停用")
        return value

    def validate(self, attrs: dict) -> dict:
        """按 os_type 校验凭证类型与 work_root 路径风格。"""
        os_type = attrs.get("os_type", getattr(self.instance, "os_type", "windows"))
        credential = attrs.get("credential", getattr(self.instance, "credential", None))
        if credential is not None:
            # 麒麟节点用 SSH 密码（ssh_password），Windows 节点用 Windows 密码
            expected = "ssh_password" if os_type == "kylin" else "windows_password"
            if credential.cred_type != expected:
                raise serializers.ValidationError(
                    {"credential": f"节点登录凭证类型必须为 {expected}"}
                )
        work_root = attrs.get("work_root", getattr(self.instance, "work_root", "") or "")
        if work_root:
            if os_type == "kylin":
                # 拒绝根目录等危险路径（与 cleanup._safe_work_root 对齐）
                if (
                    "\\" in work_root
                    or not PurePosixPath(work_root).is_absolute()
                    or len(PurePosixPath(work_root).parts) < 2
                ):
                    raise serializers.ValidationError(
                        {"work_root": "麒麟节点工作目录必须为 POSIX 绝对路径（如 /data/trace-ship/workspaces），且不能是根目录"}
                    )
            elif not re.match(r"^[A-Za-z]:[\\/]", work_root) or len(PureWindowsPath(work_root).parts) < 2:
                raise serializers.ValidationError(
                    {"work_root": r"Windows 节点工作目录必须为盘符路径（如 C:\trace-ship\workspaces），且不能是盘符根目录"}
                )
        return attrs

    def validate_port(self, value: int) -> int:
        if not (1 <= value <= 65535):
            raise serializers.ValidationError("端口号必须在 1-65535 之间")
        return value

    def validate_max_concurrency(self, value: int) -> int:
        if not (1 <= value <= 16):
            raise serializers.ValidationError("最大并发数必须在 1-16 之间")
        return value

    def validate_cpu_cores(self, value: int) -> int:
        if not (0 <= value <= 64):
            raise serializers.ValidationError("CPU 核数必须在 0-64 之间（0 为不限）")
        return value


class PackageConfigSerializer(serializers.ModelSerializer):
    """项目级打包配置序列化器。"""

    project_id = serializers.UUIDField(source="project.id", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_id = serializers.UUIDField(source="repository.id", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True, default="")
    image_id = serializers.UUIDField(source="image.id", read_only=True)
    image_name = serializers.CharField(source="image.name", read_only=True, default="")
    image_ref = serializers.CharField(source="image.image", read_only=True, default="")
    image_source = serializers.CharField(source="image.source", read_only=True, default="")
    # 写入镜像坐标（本地 / Nexus 可选列表中的条目），后端按坐标 get_or_create 镜像记录
    image_info = serializers.DictField(write_only=True, required=False)
    node_id = serializers.UUIDField(source="node.id", read_only=True)
    node_name = serializers.CharField(source="node.name", read_only=True, default="")
    node_host = serializers.CharField(source="node.host", read_only=True, default="")
    executor_type_display = serializers.CharField(source="get_executor_type_display", read_only=True)
    svn_commit_mode_display = serializers.CharField(source="get_svn_commit_mode_display", read_only=True)
    svn_credential_id = serializers.UUIDField(source="svn_credential.id", read_only=True)
    svn_credential_name = serializers.CharField(source="svn_credential.name", read_only=True, default="")
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = PackageConfig
        fields = [
            "id", "project", "project_id", "project_name",
            "repository", "repository_id", "repository_name",
            "name",
            "executor_type", "executor_type_display", "node", "node_id", "node_name", "node_host",
            "image", "image_id", "image_name", "image_ref", "image_source", "image_info", "custom_script",
            "cpu_cores", "cpu_priority", "mem_limit_mb",
            "build_path", "output_path", "auto_collect_output", "auto_compress", "env_vars",
            "auto_package_on_release", "cleanup_workspace", "is_active",
            "svn_push_enabled", "svn_url", "svn_credential", "svn_credential_id", "svn_credential_name",
            "svn_path_template", "svn_commit_mode", "svn_commit_mode_display",
            "clone_submodules", "inject_git_credential",
            "my_role",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "project_id", "project_name", "repository_id", "repository_name",
            "image_id", "image_name", "image_ref", "image_source",
            "executor_type_display", "node_id", "node_name", "node_host",
            "svn_credential_id", "svn_credential_name", "svn_commit_mode_display", "my_role",
            "created_at", "updated_at",
        ]

    @staticmethod
    def _resolve_image_info(image_info: dict) -> PackageImage:
        """按镜像坐标查找或创建打包镜像记录。"""
        source = (image_info.get("source") or "").strip()
        if source not in ("nexus", "local"):
            raise serializers.ValidationError({"image_info": "镜像来源仅支持 nexus / local"})
        image_name = (image_info.get("image_name") or "").strip()
        image_tag = (image_info.get("image_tag") or "").strip()
        if not image_name or not image_tag:
            raise serializers.ValidationError({"image_info": "镜像信息缺少镜像名或标签"})
        if len(image_name) > 300 or len(image_tag) > 300:
            raise serializers.ValidationError({"image_info": "镜像名或标签过长"})
        if source == "nexus":
            registry_host = (image_info.get("registry_host") or "").strip()[:300]
            repository = (image_info.get("repository") or "").strip()[:300]
        else:
            # 本地镜像坐标固定为空，保证唯一约束稳定
            registry_host = ""
            repository = ""
        image, _created = PackageImage.objects.get_or_create(
            source=source,
            registry_host=registry_host,
            repository=repository,
            image_name=image_name,
            image_tag=image_tag,
            defaults={"name": f"{image_name}:{image_tag}"[:200]},
        )
        return image

    def get_my_role(self, obj: PackageConfig) -> str | None:
        """当前请求用户在配置所属项目中的角色。

        与 `ProjectSerializer.get_my_role` 保持一致：超管与项目负责人均视为 manager；
        成员记录为 software_admin 时优先生效；非成员返回 None。
        前端 `ConfigList`/`PackageConfigModal` 同时接受 manager / software_admin
        作为可维护信号，因此超管返回 manager 不会影响 UI 放行。
        列表场景下视图已通过 Prefetch(to_attr="_my_member") 预取当前用户
        的成员记录，避免逐条查询产生 N+1。
        """
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        if user.is_superuser:
            return "manager"
        # 视图通过 Prefetch(to_attr="_my_member") 预取当前用户成员记录；
        # 嵌套调用或未 prefetch 时回退到直接查询（仅单条，无 N+1 风险）
        members = getattr(obj.project, "_my_member", None)
        if members is None:
            member = obj.project.members.filter(user=user).only("role").first()
        else:
            member = members[0] if members else None
        if member and member.role == "software_admin":
            return "software_admin"
        if str(obj.project.leader_id) == str(user.id):
            return "manager"
        return member.role if member else None

    def validate_project(self, value):
        """校验打包配置维护权限（项目管理员 / 软件管理员）。"""
        user = self.context["request"].user
        if user.is_superuser:
            return value
        member = ProjectMember.objects.filter(project=value, user=user).first()
        if not member or member.role not in ("manager", "software_admin"):
            raise serializers.ValidationError("只有项目管理员或软件管理员才能维护打包配置")
        return value

    def validate_build_path(self, value: str) -> str:
        return validate_safe_rel_path(value, "build_path")

    def validate_output_path(self, value: str) -> str:
        return validate_safe_rel_path(value, "output_path")

    def validate_cpu_cores(self, value: int) -> int:
        if not (0 <= value <= 64):
            raise serializers.ValidationError("CPU 核数必须在 0-64 之间（0 为跟随节点）")
        return value

    def validate_mem_limit_mb(self, value: int) -> int:
        if not (0 <= value <= 1024 * 1024):
            raise serializers.ValidationError("内存上限必须在 0-1048576 MB 之间（0 为不限）")
        return value

    def validate(self, attrs: dict) -> dict:
        """校验仓库、镜像和脚本约束。"""
        project = attrs.get("project", getattr(self.instance, "project", None))
        repository = attrs.get("repository", getattr(self.instance, "repository", None))
        image_info = attrs.pop("image_info", None)
        if image_info:
            attrs["image"] = self._resolve_image_info(image_info)
        image = attrs.get("image", getattr(self.instance, "image", None))
        env_vars = attrs.get("env_vars", getattr(self.instance, "env_vars", {}))

        if repository and project and repository.project_id != project.id:
            raise serializers.ValidationError({"repository": "关联仓库必须属于当前项目"})
        if repository and repository.repo_type != "git":
            raise serializers.ValidationError({"repository": "打包配置第一阶段仅支持 Git 仓库"})
        if not isinstance(env_vars, dict):
            raise serializers.ValidationError({"env_vars": "环境变量必须为 JSON 对象"})

        executor_type = attrs.get("executor_type", getattr(self.instance, "executor_type", "local_docker")) or "local_docker"
        node = attrs.get("node", getattr(self.instance, "node", None))
        if executor_type == "remote_node":
            if node is None:
                raise serializers.ValidationError({"node": "远程节点打包必须选择打包节点"})
            if not node.is_active:
                raise serializers.ValidationError({"node": "打包节点已停用"})
        else:
            if node is not None:
                raise serializers.ValidationError({"node": "本地 Docker 打包不需要选择打包节点"})
            if image is None:
                raise serializers.ValidationError({"image": "必须选择打包镜像"})
            if not image.is_active:
                raise serializers.ValidationError({"image": "打包镜像已停用"})

        # SVN 推送配置校验
        svn_push_enabled = attrs.get("svn_push_enabled", getattr(self.instance, "svn_push_enabled", False))
        if svn_push_enabled:
            svn_url = attrs.get("svn_url", getattr(self.instance, "svn_url", ""))
            svn_credential = attrs.get("svn_credential", getattr(self.instance, "svn_credential", None))
            if not svn_url:
                raise serializers.ValidationError({"svn_url": "启用 SVN 推送时必须填写 SVN 仓库地址"})
            if not (
                svn_url.startswith("svn://")
                or svn_url.startswith("http://")
                or svn_url.startswith("https://")
            ):
                raise serializers.ValidationError({"svn_url": "SVN 仓库地址必须以 svn://、http:// 或 https:// 开头"})
            if not svn_credential:
                raise serializers.ValidationError({"svn_credential": "启用 SVN 推送时必须选择 SVN 凭证"})
            if svn_credential.cred_type != "svn_password":
                raise serializers.ValidationError({"svn_credential": "SVN 凭证类型必须为 svn_password"})
            if not svn_credential.is_active:
                raise serializers.ValidationError({"svn_credential": "SVN 凭证已停用"})
            # SVN 凭证全系统共享，任意归属人的 SVN 凭证均可绑定，无需再校验项目归属

        # 「自动压缩产物」依赖「构建后自动收集产物」，未开启时禁止单独开启
        auto_collect_output = attrs.get(
            "auto_collect_output", getattr(self.instance, "auto_collect_output", False)
        )
        if attrs.get("auto_compress") and not auto_collect_output:
            raise serializers.ValidationError(
                {"auto_compress": "自动压缩产物需先开启「构建后自动收集产物」"}
            )

        return attrs


class PackageKnowledgeSerializer(serializers.ModelSerializer):
    """AI 打包通用知识库条目序列化器。"""

    created_by_name = serializers.CharField(source="created_by.nickname", read_only=True, default="")

    class Meta:
        model = PackageKnowledge
        fields = [
            "id", "title", "content", "is_active",
            "created_by_name", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by_name", "created_at", "updated_at"]

    def validate_title(self, value: str) -> str:
        title = (value or "").strip()
        if not title:
            raise serializers.ValidationError("请输入知识标题")
        return title

    def validate_content(self, value: str) -> str:
        content = (value or "").strip()
        if not content:
            raise serializers.ValidationError("请输入知识内容")
        if len(content) > 20000:
            raise serializers.ValidationError("知识内容不能超过 20000 字符")
        return content


class PackageTaskSerializer(serializers.ModelSerializer):
    """打包任务序列化器。"""

    config_name = serializers.CharField(source="config.name", read_only=True, default="")
    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True)
    release_version = serializers.CharField(source="release.version", read_only=True)
    triggered_by_name = serializers.CharField(source="triggered_by.nickname", read_only=True, default="")
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    release_type_display = serializers.CharField(source="get_release_type_display", read_only=True)
    can_push_svn = serializers.SerializerMethodField()

    class Meta:
        model = PackageTask
        fields = [
            "id", "config", "config_name", "release", "release_version",
            "project", "project_name", "repository", "repository_name",
            "triggered_by", "triggered_by_name", "name",
            "build_type", "release_type", "release_type_display",
            "tag_name", "version", "commit_hash", "config_snapshot",
            "status", "status_display", "progress", "stage_info", "can_push_svn",
            "artifact_info", "duration", "error_message",
            "started_at", "finished_at", "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_can_push_svn(self, obj: PackageTask) -> bool:
        """任务是否具备手动推送 SVN 的条件。"""
        snapshot = obj.config_snapshot or {}
        return bool(
            obj.status == "success"
            and obj.artifact_info
            and snapshot.get("svn_push_enabled")
            and snapshot.get("svn_url")
            and snapshot.get("svn_credential_id")
        )
