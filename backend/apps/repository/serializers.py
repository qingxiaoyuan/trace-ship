"""
仓库管理序列化器

包含仓库（Repository）和提交记录（CommitRecord）的序列化器。
"""
from typing import Set
from urllib.parse import urlparse

from rest_framework import serializers

from apps.project.models import ProjectMember
from apps.repository.models import CommitRecord, Repository


def _parse_owner_repo_from_url(url: str) -> str | None:
    """
    从 Git 仓库地址解析 owner/repo

    支持 http(s)://host/owner/repo.git 和 git@host:owner/repo.git 等格式，
    同时兼容 GitLab 嵌套 group，如 https://gitlab.com/group/subgroup/repo.git。

    Args:
        url: 仓库地址

    Returns:
        owner/repo 字符串，解析失败返回 None
    """
    if not url:
        return None
    # SSH 格式 git@host:owner/repo.git
    if url.startswith("git@") and ":" in url:
        path = url.split(":", 1)[1]
    else:
        parsed = urlparse(url)
        path = parsed.path
    path = path.strip("/")
    path = path.removesuffix(".git")
    parts = path.split("/")
    if len(parts) >= 2:
        return "/".join(parts)
    return None


class RepositorySerializer(serializers.ModelSerializer):
    """
    仓库序列化器

    读取时展开项目名称和凭证 ID，写入时校验项目归属、vendor 与凭证模式一致性。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    credential_id = serializers.UUIDField(source="credential.id", read_only=True)
    credential_name = serializers.CharField(source="credential.name", read_only=True, default="")
    credential_owner_name = serializers.CharField(source="credential.owner.nickname", read_only=True, default="")
    credential_mode_display = serializers.CharField(source="get_credential_mode_display", read_only=True)
    specified_user_name = serializers.CharField(source="specified_user.nickname", read_only=True, default="")
    clone_url = serializers.SerializerMethodField()

    class Meta:
        model = Repository
        fields = [
            "id", "project", "project_name",
            "repo_type", "vendor", "name", "url", "clone_url", "external_identity",
            "default_branch", "credential", "credential_id", "credential_mode",
            "credential_mode_display", "credential_name", "credential_owner_name",
            "specified_user", "specified_user_name",
            "health_status", "last_sync_at", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "health_status", "last_sync_at", "created_at", "updated_at",
            "credential_name", "credential_owner_name", "credential_mode_display",
            "specified_user_name", "clone_url",
        ]

    def get_clone_url(self, obj: Repository) -> str:
        """
        返回仓库克隆地址

        如果 url 字段本身已是克隆地址则直接返回；
        否则根据服务器地址和外部标识拼出 http(s)://host/owner/repo.git。
        """
        url = obj.url or ""
        if url.endswith(".git") or (obj.external_identity and obj.external_identity in url):
            return url
        if obj.repo_type == "svn" or not obj.external_identity:
            return url
        base = url.rstrip("/")
        return f"{base}/{obj.external_identity}.git"

    def validate_project(self, value):
        """
        校验用户只能为所属项目创建仓库

        Args:
            value: 项目实例

        Returns:
            项目实例

        Raises:
            ValidationError: 用户无权限时抛出
        """
        user = self.context["request"].user
        if user.is_superuser:
            return value
        if not ProjectMember.objects.filter(project=value, user=user).exists():
            raise serializers.ValidationError("你只能为所属项目创建仓库")
        return value

    def validate(self, attrs):
        """
        校验仓库类型与 vendor、凭证模式的一致性，并规范化 Git 仓库地址。

        Args:
            attrs: 待校验属性

        Returns:
            校验通过的数据
        """
        repo_type = attrs.get("repo_type", getattr(self.instance, "repo_type", None))
        vendor = attrs.get("vendor", getattr(self.instance, "vendor", None))
        credential_mode = attrs.get("credential_mode", getattr(self.instance, "credential_mode", "fixed"))
        credential = attrs.get("credential", getattr(self.instance, "credential", None))
        specified_user = attrs.get("specified_user", getattr(self.instance, "specified_user", None))

        if repo_type == "svn" and vendor != "svn":
            raise serializers.ValidationError({"vendor": "SVN 仓库的 vendor 必须为 svn"})
        if repo_type == "git" and vendor == "svn":
            raise serializers.ValidationError({"vendor": "Git 仓库不能使用 svn vendor"})
        if credential_mode == "fixed" and credential is None:
            raise serializers.ValidationError({"credential": "fixed 凭证模式必须选择凭证"})
        if credential_mode != "fixed" and credential is not None:
            raise serializers.ValidationError({"credential": "非 fixed 凭证模式不能直接绑定凭证"})
        if credential_mode == "specified_user" and specified_user is None:
            raise serializers.ValidationError({"specified_user": "specified_user 凭证模式必须指定用户"})
        if credential_mode != "specified_user" and specified_user is not None:
            raise serializers.ValidationError({"specified_user": "仅 specified_user 凭证模式可以指定用户"})

        # Git 仓库地址规范化：把克隆地址统一解析为服务器根地址 + owner/repo
        url = attrs.get("url")
        external_identity = attrs.get("external_identity")
        if url and repo_type == "git" and vendor != "svn":
            parsed = urlparse(url.rstrip("/"))
            path = parsed.path.strip("/")
            if path and ".git" in path:
                # 用户填的是克隆地址，提取服务器根地址
                attrs["url"] = f"{parsed.scheme}://{parsed.netloc}"
            if not external_identity:
                # 未填写外部标识时，从地址自动解析 owner/repo
                parsed_identity = _parse_owner_repo_from_url(url)
                if parsed_identity:
                    attrs["external_identity"] = parsed_identity

        return attrs


class RepositoryListSerializer(serializers.ModelSerializer):
    """
    仓库列表序列化器

    字段精简，适合列表展示。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    clone_url = serializers.SerializerMethodField()
    credential_name = serializers.CharField(source="credential.name", read_only=True, default="")
    credential_owner_name = serializers.CharField(source="credential.owner.nickname", read_only=True, default="")
    credential_mode_display = serializers.CharField(source="get_credential_mode_display", read_only=True)

    class Meta:
        model = Repository
        fields = [
            "id", "project", "project_name", "repo_type", "vendor",
            "name", "url", "clone_url", "external_identity", "default_branch",
            "credential_mode", "credential_mode_display",
            "credential_name", "credential_owner_name",
            "health_status", "last_sync_at", "created_at",
        ]

    def get_clone_url(self, obj: Repository) -> str:
        """
        返回仓库克隆地址

        如果 url 字段本身已是克隆地址则直接返回；
        否则根据服务器地址和外部标识拼出 http(s)://host/owner/repo.git。
        """
        url = obj.url or ""
        # url 已包含 .git 后缀或外部标识，说明用户填的就是克隆地址
        if url.endswith(".git") or (obj.external_identity and obj.external_identity in url):
            return url
        if obj.repo_type == "svn" or not obj.external_identity:
            return url
        base = url.rstrip("/")
        return f"{base}/{obj.external_identity}.git"


class CommitRecordSerializer(serializers.ModelSerializer):
    """
    提交记录序列化器

    读取时展开项目/仓库名称，并基于 parsed_message 计算变更类型。
    """

    project_name = serializers.CharField(source="project.name", read_only=True)
    repository_name = serializers.CharField(source="repository.name", read_only=True)
    change_type = serializers.SerializerMethodField(read_only=True)
    parsed_result = serializers.JSONField(source="parsed_message", read_only=True)

    class Meta:
        model = CommitRecord
        fields = [
            "id", "project", "project_name", "repository", "repository_name",
            "commit_hash", "author", "author_email", "message", "committed_at",
            "branch", "change_type", "parsed_result", "review_status",
            "review_reason", "created_at",
        ]
        read_only_fields = [
            "id", "project", "repository", "commit_hash", "author", "author_email",
            "message", "committed_at", "branch", "parsed_message", "review_status",
            "review_reason", "created_at",
        ]
    def get_change_type(self, obj: CommitRecord) -> str:
        """
        根据解析结果计算变更类型展示文本

        Args:
            obj: CommitRecord 实例

        Returns:
            变更类型描述，如 "A类"、"A/F类" 或 "-"
        """
        updates = obj.parsed_message.get("updates", [])
        if not updates:
            return "-"
        types: Set[str] = {u.get("type") for u in updates if u.get("type")}
        if types == {"A"}:
            return "A类"
        if types == {"F"}:
            return "F类"
        return "/".join(sorted(types)) + "类"
