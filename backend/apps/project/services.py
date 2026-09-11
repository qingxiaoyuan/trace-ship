"""
项目业务服务

封装项目创建者自动加入项目、产品组件初始化与可见范围等逻辑。
"""
import re

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.project.models import ProductComponent, Project, ProjectMember


class ProjectService:
    """
    项目相关业务规则服务
    """

    @staticmethod
    def generate_project_code() -> str:
        """
        自动生成项目编码

        格式：PROJ + 年月日 + 4位自增序号，如 PROJ202506250001。
        使用 select_for_update 保证并发安全。

        Returns:
            新生成的项目编码
        """
        prefix = "PROJ"
        today = timezone.now().strftime("%Y%m%d")
        base_code = f"{prefix}{today}"

        with transaction.atomic():
            latest = (
                Project.objects.select_for_update()
                .filter(code__startswith=base_code)
                .order_by("-code")
                .first()
            )
            if latest and len(latest.code) >= len(base_code) + 4:
                seq_str = latest.code[-4:]
                try:
                    seq = int(seq_str) + 1
                except ValueError:
                    seq = 1
            else:
                seq = 1

            return f"{base_code}{seq:04d}"

    @staticmethod
    def add_creator_as_manager(project, user) -> None:
        """
        将项目创建者自动添加为项目管理员

        Args:
            project: 新创建的项目实例
            user: 创建者用户
        """
        ProjectMember.objects.get_or_create(
            project=project,
            user=user,
            defaults={"role": "manager"},
        )


def normalize_component_code(name: str, fallback: str = "component") -> str:
    """将仓库名称转换为稳定、可用于配置键的组件编码。"""
    normalized = re.sub(r"[^a-z0-9._-]+", "-", (name or "").lower()).strip("-._")
    return (normalized or fallback)[:100]


def next_component_code(project: Project, preferred: str, exclude_id=None) -> str:
    """在产品内生成不重复的组件编码。"""
    base_code = normalize_component_code(preferred)
    existing = ProductComponent.objects.filter(project=project)
    if exclude_id:
        existing = existing.exclude(id=exclude_id)
    codes = set(existing.values_list("component_code", flat=True))
    component_code = base_code
    suffix = 2
    while component_code in codes:
        suffix_text = f"-{suffix}"
        component_code = f"{base_code[:100 - len(suffix_text)]}{suffix_text}"
        suffix += 1
    return component_code


def repository_owner(repository):
    """仓库所有者：创建者优先，其次为绑定凭证的归属人。"""
    if getattr(repository, "created_by_id", None):
        return repository.created_by
    credential = getattr(repository, "credential", None)
    if credential is not None:
        return credential.owner
    return None


def is_product_member(project, user) -> bool:
    """判断用户是否为产品成员（含负责人，不含仅凭超管身份）。"""
    if project is None or user is None:
        return False
    if str(getattr(project, "leader_id", "") or "") == str(user.id):
        return True
    return ProjectMember.objects.filter(project=project, user=user).exists()


def is_repository_owner_in_product(repository, product) -> bool:
    """仓库所有者是否已在该产品成员中。"""
    owner = repository_owner(repository)
    if owner is None:
        return False
    return is_product_member(product, owner)


def repository_owner_association_error(repository, product) -> str | None:
    """关联仓库到产品的前置条件；通过返回 None。"""
    owner = repository_owner(repository)
    if owner is None:
        return "仓库尚未指定所有者。请先由所有者登记仓库或绑定个人凭证。"
    if not is_product_member(product, owner):
        name = owner.nickname or owner.username
        return f"请先将仓库所有者「{name}」加入当前产品成员，才能关联该仓库并使用其凭证"
    return None


def user_can_use_repository_credential(repository, user) -> bool:
    """当前用户是否可使用该仓库绑定凭证。

    仓库所有者本人可用；否则必须属于某个已关联产品，且仓库所有者仍是该产品成员。
    """
    if user is None:
        return False
    if getattr(user, "is_superuser", False):
        return True
    owner = repository_owner(repository)
    if owner is not None and str(owner.id) == str(user.id):
        return True
    components = ProductComponent.objects.filter(
        repository=repository, is_active=True,
    ).select_related("project")
    for component in components:
        if not is_product_member(component.project, user):
            continue
        if owner is None or is_product_member(component.project, owner):
            return True
    if repository.project_id and is_product_member(repository.project, user):
        if owner is None or is_product_member(repository.project, owner):
            return True
    return False


def ensure_repository_component(repository, project=None) -> ProductComponent:
    """为旧项目 + 仓库调用补齐默认产品组件，供兼容接口平滑迁移。"""
    project = project or repository.project
    existing = ProductComponent.objects.filter(
        project=project,
        repository=repository,
    ).first()
    if existing:
        return existing
    return ProductComponent.objects.create(
        project=project,
        repository=repository,
        component_code=next_component_code(project, repository.name),
        display_name=repository.name,
        default_branch=repository.default_branch or "main",
    )


def visible_repository_ids(user):
    """
    返回用户可见的物理仓库 ID。

    非超管仅可查看本人创建的仓库，以及显式加入产品后该产品关联的仓库；
    同时兼容旧的 Repository.project 归属和 ProductComponent 关联。
    """
    from apps.repository.models import Repository

    if user.is_superuser:
        return Repository.objects.values("id")
    project_ids = visible_project_ids(user)
    return Repository.objects.filter(
        Q(created_by=user)
        | Q(project_id__in=project_ids)
        | Q(product_components__project_id__in=project_ids, product_components__is_active=True)
    ).values("id").distinct()


# 全部可授予的项目角色
ALL_GRANTABLE_ROLES = [role for role, _ in ProjectMember.ROLE_CHOICES]
# 软件管理员可授予的角色（除项目负责人、软件管理员）
SOFTWARE_ADMIN_GRANTABLE_ROLES = [
    role for role in ALL_GRANTABLE_ROLES if role not in ("manager", "software_admin")
]
# 普通成员拉人进项目时可授予的角色（仅开发 / 测试）
MEMBER_GRANTABLE_ROLES = ["developer", "tester"]


def get_grantable_roles(project, user) -> list[str]:
    """
    按操作者在项目中的有效角色返回其可授予的成员角色集合

    规则：超管 / 项目负责人（leader）/ manager 可授全部角色；
    software_admin 可授除 manager、software_admin 之外的角色；
    其余成员角色（developer/tester/auditor/viewer）拉人进项目仅能授 developer/tester；
    非项目成员返回空列表。

    Args:
        project: 项目实例
        user: 操作者用户

    Returns:
        可授予的角色值列表
    """
    if user.is_superuser:
        return ALL_GRANTABLE_ROLES
    from utils.permissions import ProjectRolePermission

    role = ProjectRolePermission._effective_role(project, user)
    if role == "manager":
        return ALL_GRANTABLE_ROLES
    if role == "software_admin":
        return SOFTWARE_ADMIN_GRANTABLE_ROLES
    if role is None:
        return []
    return MEMBER_GRANTABLE_ROLES


def visible_project_ids(user):
    """
    用户可见的项目 ID 查询集

    超管可查看全部产品；其他用户仅可查看存在显式 ProjectMember 记录的产品，
    供各业务视图的 get_queryset 统一过滤使用。产品负责人若需要看到产品，
    同样需要加入产品成员。

    Args:
        user: 当前请求用户

    Returns:
        可见项目的 id 子查询集
    """
    if user.is_superuser:
        return Project.objects.values("id")
    member_ids = ProjectMember.objects.filter(user=user).values("project_id")
    return Project.objects.filter(id__in=member_ids).values("id")
