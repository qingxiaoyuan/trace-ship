"""
仓库管理序列化器

包含仓库（Repository）和提交记录（CommitRecord）的序列化器。
"""
from urllib.parse import urlparse

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.project.models import Project, ProjectMember
from apps.project.services import ensure_repository_component, visible_project_ids
from apps.repository.models import CommitRecord, Repository
from utils.provider.credential_resolver import VENDOR_TO_CRED_TYPE


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


def _credential_loan_summaries(obj: Repository) -> list[dict]:
    """生成当前用户可见的借用元数据，不返回任何凭证明文。"""
    now = timezone.now()
    values = []
    for loan in getattr(obj, "_visible_credential_loans", []):
        effective_expiry = min(
            [value for value in (loan.expires_at, loan.credential.expires_at) if value],
            default=None,
        )
        if not loan.is_active or loan.revoked_at or not loan.credential.is_active:
            state = "revoked"
        elif effective_expiry and effective_expiry <= now:
            state = "expired"
        elif effective_expiry and (effective_expiry - now).days < 7:
            state = "expiring"
        else:
            state = "valid"
        values.append({
            "id": str(loan.id),
            "credential_name": loan.credential.name,
            "lender_name": loan.lender.nickname or loan.lender.username,
            "permission_scope": loan.permission_scope,
            "expires_at": effective_expiry,
            "state": state,
        })
    return values


class RepositoryProductVisibilityMixin:
    """隐藏当前用户无权查看的产品关联元数据。"""

    def _visible_project_ids(self) -> set:
        if "visible_project_ids" in self.context:
            return self.context["visible_project_ids"]
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated or user.is_superuser:
            return set()
        values = set(visible_project_ids(user).values_list("id", flat=True))
        self.context["visible_project_ids"] = values
        return values

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user and user.is_authenticated and not user.is_superuser:
            if instance.project_id not in self._visible_project_ids():
                data["project"] = None
                data["project_name"] = ""
        return data


class RepositorySerializer(RepositoryProductVisibilityMixin, serializers.ModelSerializer):
    """
    仓库序列化器

    读取时展开历史登记项目和凭证 ID。仓库目录可独立登记物理仓库；
    从产品上下文传入 project 时，继续兼容自动创建默认产品组件。
    """

    project = serializers.PrimaryKeyRelatedField(
        queryset=Project.objects.all(), required=False, allow_null=True
    )
    project_name = serializers.CharField(source="project.name", read_only=True, default="")
    external_identity = serializers.CharField(required=False, allow_blank=True)
    credential_id = serializers.UUIDField(source="credential.id", read_only=True)
    credential_name = serializers.CharField(source="credential.name", read_only=True, default="")
    credential_owner_name = serializers.CharField(source="credential.owner.nickname", read_only=True, default="")
    credential_mode_display = serializers.CharField(source="get_credential_mode_display", read_only=True)
    clone_url = serializers.SerializerMethodField()
    product_count = serializers.IntegerField(read_only=True, default=1)
    used_by_products = serializers.SerializerMethodField()
    credential_loans = serializers.SerializerMethodField()
    created_by_name = serializers.CharField(source="created_by.nickname", read_only=True, default="")

    class Meta:
        model = Repository
        # 物理仓库唯一性在 validate 中基于规范化后的地址检查；关闭 DRF 自动
        # UniqueTogetherValidator，避免它在地址解析前把 external_identity 当作必填。
        validators = []
        fields = [
            "id", "project", "project_name",
            "repo_type", "vendor", "name", "url", "clone_url", "external_identity",
            "default_branch", "version_rule", "credential", "credential_id", "credential_mode",
            "credential_mode_display", "credential_name", "credential_owner_name",
            "health_status", "last_sync_at", "created_by", "created_by_name",
            "created_at", "updated_at",
            "product_count",
            "used_by_products",
            "credential_loans",
        ]
        read_only_fields = [
            "id", "health_status", "last_sync_at", "created_by", "created_by_name",
            "created_at", "updated_at",
            "credential_name", "credential_owner_name", "credential_mode_display",
            "clone_url", "product_count",
        ]

    def create(self, validated_data: dict) -> Repository:
        """创建物理仓库并写入内置审批流程；产品上下文登记时补齐默认组件。"""
        request = self.context.get("request")
        if request and getattr(request, "user", None) and request.user.is_authenticated:
            validated_data.setdefault("created_by", request.user)
        with transaction.atomic():
            repository = super().create(validated_data)
            if repository.project_id:
                ensure_repository_component(repository)
            from apps.workflow.services import ensure_builtin_workflow_definitions

            ensure_builtin_workflow_definitions(repository)
        return repository

    def update(self, instance: Repository, validated_data: dict) -> Repository:
        """历史登记项目创建后保持不变，产品归属通过 ProductComponent 维护。"""
        validated_data.pop("project", None)
        return super().update(instance, validated_data)

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

    def get_used_by_products(self, obj: Repository) -> list[dict[str, str]]:
        """列出当前物理仓库被哪些产品及组件角色引用。"""
        components = getattr(obj, "_visible_product_components", None)
        if components is None:
            components = obj.product_components.select_related("project").filter(is_active=True)
            request = self.context.get("request")
            user = getattr(request, "user", None)
            if user and user.is_authenticated and not user.is_superuser:
                components = components.filter(project_id__in=self._visible_project_ids())
        return [
            {
                "product_id": str(component.project_id),
                "product_name": component.project.name,
                "component_id": str(component.id),
                "component_code": component.component_code,
                "component_name": component.display_name,
            }
            for component in components
            if component.is_active
        ]

    def get_credential_loans(self, obj: Repository) -> list[dict]:
        return _credential_loan_summaries(obj)

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
        校验仓库类型与 vendor、凭证来源与绑定凭证的一致性，并规范化 Git 仓库地址。

        凭证归属/类型校验仅在凭证变更时执行，避免修改版本规则等字段时
        因凭证使用人不一致而被拦截（软件负责人与项目负责人均可修改仓库配置）。

        Args:
            attrs: 待校验属性

        Returns:
            校验通过的数据
        """
        repo_type = attrs.get("repo_type", getattr(self.instance, "repo_type", None))
        vendor = attrs.get("vendor", getattr(self.instance, "vendor", None))

        if repo_type == "svn" and vendor != "svn":
            raise serializers.ValidationError({"vendor": "SVN 仓库的 vendor 必须为 svn"})
        if repo_type == "git" and vendor == "svn":
            raise serializers.ValidationError({"vendor": "Git 仓库不能使用 svn vendor"})

        # 凭证校验仅在显式变更凭证时执行
        if "credential" in attrs:
            credential = attrs.get("credential")
            # 凭证必须显式绑定；凭证统一为个人凭证（SVN 凭证全系统共享），
            # 因此只允许绑定本人的凭证或系统共享凭证
            if credential is None:
                raise serializers.ValidationError({"credential": "必须选择凭证"})
            request_user = self.context["request"].user
            if not credential.is_system_shared and credential.owner_id != request_user.id:
                raise serializers.ValidationError({"credential": "只能绑定本人的凭证（SVN 系统共享凭证除外）"})
            owner_id = (
                getattr(self.instance, "created_by_id", None)
                if self.instance is not None
                else request_user.id
            )
            if (
                not credential.is_system_shared
                and owner_id
                and str(credential.owner_id) != str(owner_id)
            ):
                raise serializers.ValidationError({"credential": "只能绑定仓库所有者本人的凭证"})

            # 校验凭证类型与仓库平台一致
            expected_cred_type = VENDOR_TO_CRED_TYPE.get(vendor)
            if expected_cred_type and credential.cred_type != expected_cred_type:
                raise serializers.ValidationError({"credential": f"凭证类型与仓库平台不匹配，应为 {expected_cred_type}"})

        # Git 仓库地址规范化：把克隆地址统一解析为服务器根地址 + owner/repo
        url = attrs.get("url")
        external_identity = attrs.get("external_identity")
        if url and repo_type == "git" and vendor != "svn":
            from apps.repository.services import RepositoryService

            server_url, identity = RepositoryService.normalize_physical_identity(
                url, external_identity or getattr(self.instance, "external_identity", "") or "",
            )
            attrs["url"] = server_url
            if identity:
                attrs["external_identity"] = identity

        if repo_type == "git" and not attrs.get(
            "external_identity", getattr(self.instance, "external_identity", "")
        ):
            raise serializers.ValidationError(
                {"external_identity": "Git 仓库必须提供可唯一识别的项目路径"}
            )

        identity_url = attrs.get("url", getattr(self.instance, "url", ""))
        identity = attrs.get(
            "external_identity", getattr(self.instance, "external_identity", "")
        )
        duplicate = Repository.objects.filter(
            vendor=vendor,
            url=identity_url,
            external_identity=identity,
        )
        if self.instance:
            duplicate = duplicate.exclude(id=self.instance.id)
        if duplicate.exists():
            raise serializers.ValidationError(
                {"external_identity": "该物理仓库已登记，请从仓库目录关联到产品"}
            )

        return attrs


class RepositoryListSerializer(RepositoryProductVisibilityMixin, serializers.ModelSerializer):
    """
    仓库列表序列化器

    字段精简，适合列表展示。
    """

    project_name = serializers.CharField(source="project.name", read_only=True, default="")
    clone_url = serializers.SerializerMethodField()
    credential_id = serializers.UUIDField(source="credential.id", read_only=True)
    credential_name = serializers.CharField(source="credential.name", read_only=True, default="")
    credential_owner_name = serializers.CharField(source="credential.owner.nickname", read_only=True, default="")
    credential_mode_display = serializers.CharField(source="get_credential_mode_display", read_only=True)
    product_count = serializers.IntegerField(read_only=True, default=1)
    used_by_products = serializers.SerializerMethodField()
    credential_loans = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    owner_in_product = serializers.SerializerMethodField()

    class Meta:
        model = Repository
        fields = [
            "id", "project", "project_name", "repo_type", "vendor",
            "name", "url", "clone_url", "external_identity", "default_branch",
            "credential_mode", "credential_mode_display", "credential_id",
            "credential_name", "credential_owner_name",
            "health_status", "last_sync_at", "created_at",
            "product_count",
            "used_by_products",
            "credential_loans",
            "owner_name",
            "owner_in_product",
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

    def get_used_by_products(self, obj: Repository) -> list[dict[str, str]]:
        return RepositorySerializer(context=self.context).get_used_by_products(obj)

    def get_credential_loans(self, obj: Repository) -> list[dict]:
        return _credential_loan_summaries(obj)

    def get_owner_name(self, obj: Repository) -> str:
        from apps.project.services import repository_owner

        owner = repository_owner(obj)
        if owner is None:
            return ""
        return owner.nickname or owner.username

    def get_owner_in_product(self, obj: Repository) -> bool | None:
        product = self.context.get("product")
        if product is None:
            return None
        from apps.project.services import is_repository_owner_in_product

        return is_repository_owner_in_product(obj, product)


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
        types: set[str] = {u.get("type") for u in updates if u.get("type")}
        if types == {"A"}:
            return "A类"
        if types == {"F"}:
            return "F类"
        return "/".join(sorted(types)) + "类"
