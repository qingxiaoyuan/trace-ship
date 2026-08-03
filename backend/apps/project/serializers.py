"""
项目管理序列化器

包含项目、项目成员的序列化器，以及支持字符串/数字双格式的状态字段。
"""
from typing import Any
from django.contrib.auth import get_user_model
from rest_framework import serializers
from apps.project.models import Project, ProjectMember
from apps.account.serializers import UserSerializer
from apps.project.services import ProjectService

User = get_user_model()


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
            "version_rule", "release_rule", "status", "created_at", "updated_at",
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
        """
        当前请求用户在该项目中的有效角色

        超管与项目负责人（leader）均视为 manager，非成员返回 None，
        前端据此控制操作按钮可见性。
        """
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return None
        if user.is_superuser or str(obj.leader_id) == str(user.id):
            return "manager"
        member = obj.members.filter(user=user).only("role").first()
        return member.role if member else None

    def create(self, validated_data: dict) -> Project:
        """
        创建项目时自动生成编码与三种发布类型内置审批流程

        若调用方未提供 code，则按 PROJ + 年月日 + 4位自增序号规则生成；
        同时为项目预置 formal/rc/beta 三个发布审批流程定义，仅可后续编辑节点。

        Args:
            validated_data: 已校验的数据

        Returns:
            新创建的项目实例
        """
        if not validated_data.get("code"):
            validated_data["code"] = ProjectService.generate_project_code()
        project = super().create(validated_data)
        from apps.workflow.services import ensure_builtin_workflow_definitions

        ensure_builtin_workflow_definitions(project)
        return project

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

    class Meta:
        model = Project
        fields = ["id", "code", "name", "leader_name", "status", "created_at",
                  "repo_count", "member_count"]

    def _count(self, obj: Project, attr: str) -> int:
        """读取视图 annotate 注入的计数字段，未注入时回退为 0。"""
        return getattr(obj, attr, 0) or 0

    def get_repo_count(self, obj: Project) -> int:
        """关联仓库数"""
        return self._count(obj, "repo_count")

    def get_member_count(self, obj: Project) -> int:
        """项目成员数"""
        return self._count(obj, "member_count")


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
