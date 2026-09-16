"""
项目管理序列化器

包含项目、产品组件、项目成员的序列化器，以及支持字符串/数字双格式的状态字段。
"""
import re
from typing import Any

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers

from apps.account.serializers import UserSerializer
from apps.project.models import ProductComponent, Project, ProjectMember
from apps.project.services import ProjectService, visible_repository_ids
from apps.repository.models import Repository
from apps.repository.serializers import RepositoryListSerializer

User = get_user_model()


def resolve_my_role(obj: Project, user) -> str | None:
    """
    计算用户在项目中的有效角色（列表 / 详情序列化器共用）

    超管与项目负责人（leader）均视为 manager；成员记录为 software_admin 时
    优先生效；非成员返回 None。列表场景优先读取视图
    Prefetch(to_attr="_my_member") 预取的成员记录，避免逐项目查询产生 N+1。
    """
    if not user or not user.is_authenticated:
        return None
    if user.is_superuser:
        return "manager"
    members = getattr(obj, "_my_member", None)
    if members is None:
        member = obj.members.filter(user=user).only("role").first()
    else:
        member = members[0] if members else None
    if member and member.role == "software_admin":
        return "software_admin"
    if str(obj.leader_id) == str(user.id):
        return "manager"
    return member.role if member else None


class ProjectStatusField(serializers.IntegerField):
    """
    项目状态字段

    同时支持 "active"/"inactive" 字符串和 1/0 数字输入，便于前端直接传字符串状态。
    """

    ACTIVE = 1
    INACTIVE = 0

    def to_internal_value(self, data: Any) -> int:
        """
        将外部值转换为内部整数状态

        Args:
            data: 输入值，可以是字符串或数字

        Returns:
            整数状态值
        """
        if isinstance(data, str):
            if data == "active":
                data = self.ACTIVE
            elif data == "inactive":
                data = self.INACTIVE
        return super().to_internal_value(data)

    def to_representation(self, value: int) -> int:
        """
        内部值原样输出

        Args:
            value: 内部整数状态

        Returns:
            原值
        """
        return value


class ProjectSerializer(serializers.ModelSerializer):
    """
    项目序列化器

    读取时展开负责人名称，状态字段支持字符串/数字双格式。
    详情场景下附带仓库 / 打包配置 / 成员 / 累计发布数量（由视图 annotate 注入）。
    """

    leader_id = serializers.PrimaryKeyRelatedField(
        source="leader", queryset=User.objects.all()
    )
    leader_name = serializers.CharField(source="leader.nickname", read_only=True)
    status = ProjectStatusField()
    repo_count = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    package_count = serializers.SerializerMethodField()
    release_count = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id", "code", "name", "leader_id", "leader_name", "description",
            "version_rule", "release_rule", "status",
            "created_at", "updated_at",
            "repo_count", "member_count", "package_count", "release_count",
            "my_role",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def _count(self, obj: Project, attr: str) -> int:
        """读取视图 annotate 注入的计数字段，未注入时回退为 0。"""
        return getattr(obj, attr, 0) or 0

    def get_repo_count(self, obj: Project) -> int:
        """关联仓库数"""
        return self._count(obj, "repo_count")

    def get_member_count(self, obj: Project) -> int:
        """项目成员数"""
        return self._count(obj, "member_count")

    def get_package_count(self, obj: Project) -> int:
        """关联打包配置数"""
        return self._count(obj, "package_count")

    def get_release_count(self, obj: Project) -> int:
        """累计发布数"""
        return self._count(obj, "release_count")

    def get_my_role(self, obj: Project) -> str | None:
        """当前请求用户在该项目中的有效角色（逻辑见 resolve_my_role）。"""
        request = self.context.get("request")
        return resolve_my_role(obj, getattr(request, "user", None))

    def create(self, validated_data: dict) -> Project:
        """
        创建项目时自动生成编码

        若调用方未提供 code，则按 PROJ + 年月日 + 4位自增序号规则生成。
        发布审批流程随仓库创建时写入，不再挂在产品上。

        Args:
            validated_data: 已校验的数据

        Returns:
            新创建的项目实例
        """
        if not validated_data.get("code"):
            validated_data["code"] = ProjectService.generate_project_code()
        return super().create(validated_data)

    def update(self, instance: Project, validated_data: dict) -> Project:
        """
        更新项目时保留原编码

        防止前端未传 code 时意外清空已有编码。

        Args:
            instance: 待更新的项目实例
            validated_data: 已校验的数据

        Returns:
            更新后的项目实例
        """
        validated_data.pop("code", None)
        return super().update(instance, validated_data)


class ProjectListSerializer(serializers.ModelSerializer):
    """
    项目列表序列化器

    字段精简，适合列表展示；附带仓库 / 成员数量（由视图 annotate 注入）。
    """

    leader_name = serializers.CharField(source="leader.nickname", read_only=True)
    status = ProjectStatusField()
    repo_count = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = ["id", "code", "name", "leader_name", "status", "created_at",
                  "repo_count", "member_count", "my_role"]

    def _count(self, obj: Project, attr: str) -> int:
        """读取视图 annotate 注入的计数字段，未注入时回退为 0。"""
        return getattr(obj, attr, 0) or 0

    def get_repo_count(self, obj: Project) -> int:
        """关联仓库数"""
        return self._count(obj, "repo_count")

    def get_member_count(self, obj: Project) -> int:
        """项目成员数"""
        return self._count(obj, "member_count")

    def get_my_role(self, obj: Project) -> str | None:
        """当前请求用户在该项目中的有效角色（打包配置等场景按角色过滤项目下拉）。"""
        request = self.context.get("request")
        return resolve_my_role(obj, getattr(request, "user", None))


class ProductComponentSerializer(serializers.ModelSerializer):
    """产品组件序列化器：维护产品内配置，不修改物理仓库本身。"""

    repository = serializers.PrimaryKeyRelatedField(queryset=Repository.objects.all())
    component_code = serializers.CharField(required=False, allow_blank=True, max_length=100)
    display_name = serializers.CharField(required=False, allow_blank=True, max_length=200)
    repository_detail = RepositoryListSerializer(source="repository", read_only=True)
    version_scope_display = serializers.CharField(source="get_version_scope_display", read_only=True)
    product_count = serializers.IntegerField(read_only=True, default=1)
    current_version = serializers.SerializerMethodField()
    current_tag = serializers.SerializerMethodField()
    package_configs = serializers.SerializerMethodField()
    credential_loans = serializers.SerializerMethodField()
    credential_status = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    owner_in_product = serializers.SerializerMethodField()

    class Meta:
        model = ProductComponent
        fields = [
            "id", "project", "repository", "repository_detail", "component_code",
            "display_name", "default_branch", "source_subdir", "required",
            "version_scope", "version_scope_display", "tag_namespace",
            "product_config", "sort_order", "is_active", "product_count",
            "current_version", "current_tag", "package_configs",
            "credential_loans", "credential_status",
            "owner_name", "owner_in_product",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "project", "product_count",
            "version_scope", "version_scope_display", "tag_namespace",
            "created_at", "updated_at",
        ]

    @staticmethod
    def _latest_release(obj: ProductComponent):
        releases = getattr(obj.repository, "_latest_project_releases", [])
        return releases[0] if releases else None

    def get_current_version(self, obj: ProductComponent) -> str:
        release = self._latest_release(obj)
        return release.version if release else ""

    def get_current_tag(self, obj: ProductComponent) -> str:
        release = self._latest_release(obj)
        return release.tag_name if release else ""

    def get_package_configs(self, obj: ProductComponent) -> list[dict]:
        configs = getattr(obj, "_component_package_configs", [])
        return [
            {"id": str(config.id), "name": config.name, "is_active": config.is_active}
            for config in configs
        ]

    def get_owner_name(self, obj: ProductComponent) -> str:
        from apps.project.services import repository_owner

        owner = repository_owner(obj.repository)
        if owner is None:
            return ""
        return owner.nickname or owner.username

    def get_owner_in_product(self, obj: ProductComponent) -> bool:
        from apps.project.services import is_repository_owner_in_product

        return is_repository_owner_in_product(obj.repository, obj.project)

    def get_credential_loans(self, obj: ProductComponent) -> list[dict]:
        """仅展示借用元数据，不返回用户名、Token 等敏感字段。"""
        now = timezone.now()
        values = []
        for loan in getattr(obj.repository, "_available_credential_loans", []):
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

    def get_credential_status(self, obj: ProductComponent) -> str:
        """凭证随仓库所有者进入产品：所有者在成员中且绑定凭证有效即为可用。"""
        from apps.project.services import is_repository_owner_in_product

        credential = obj.repository.credential
        if not credential or not credential.is_active:
            return "unavailable"
        if not is_repository_owner_in_product(obj.repository, obj.project):
            return "unavailable"
        now = timezone.now()
        if credential.expires_at and credential.expires_at <= now:
            return "unavailable"
        if credential.expires_at and (credential.expires_at - now).days < 7:
            return "expiring"
        return "available"

    def validate_repository(self, value: Repository) -> Repository:
        """只允许关联当前用户有权查看的仓库。"""
        user = self.context["request"].user
        if user.is_superuser:
            return value
        if not visible_repository_ids(user).filter(id=value.id).exists():
            raise serializers.ValidationError("只能关联你有权查看的仓库")
        return value

    def validate_component_code(self, value: str) -> str:
        """组件编码作为配置键，仅允许小写字母、数字及常见分隔符。"""
        value = (value or "").strip().lower()
        if not value:
            return value
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", value):
            raise serializers.ValidationError("组件编码仅支持小写字母、数字、点、下划线和短横线")
        return value

    def validate_source_subdir(self, value: str) -> str:
        """源码子目录必须位于仓库根目录内。"""
        value = (value or "").strip().replace("\\", "/").strip("/")
        if any(part == ".." for part in value.split("/")):
            raise serializers.ValidationError("源码子目录不能包含 ..")
        return value

    def validate(self, attrs: dict) -> dict:
        """校验产品内唯一性，以及仓库所有者必须已在产品成员中。"""
        project = self.context.get("project") or getattr(self.instance, "project", None)
        component_code = attrs.get("component_code", getattr(self.instance, "component_code", ""))
        if self.instance and "component_code" in attrs and not component_code:
            raise serializers.ValidationError({"component_code": "组件编码不能为空"})
        if project and component_code:
            duplicates = ProductComponent.objects.filter(project=project, component_code=component_code)
            if self.instance:
                duplicates = duplicates.exclude(id=self.instance.id)
            if duplicates.exists():
                raise serializers.ValidationError({"component_code": "当前产品内组件编码已存在"})
        repository = attrs.get("repository", getattr(self.instance, "repository", None))
        if project and repository and self.instance is None:
            from apps.project.services import repository_owner_association_error

            error = repository_owner_association_error(repository, project)
            if error:
                raise serializers.ValidationError({"repository": error})
        return attrs


class ProjectMemberSerializer(serializers.ModelSerializer):
    """
    项目成员序列化器

    读取时展开用户信息，写入时通过 user_id 指定用户。
    """

    user = UserSerializer(read_only=True)
    user_id = serializers.UUIDField(write_only=True)

    class Meta:
        model = ProjectMember
        fields = ["id", "user", "user_id", "role", "created_at"]
        read_only_fields = ["id", "created_at"]
