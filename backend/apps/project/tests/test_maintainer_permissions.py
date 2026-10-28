"""通过公开接口验证维保项目的权限边界与跨项目兼任。"""
from types import SimpleNamespace

import pytest
from rest_framework.test import APIClient

from apps.account.models import Permission, Role, User, UserRole
from apps.package.models import PackageConfig, PackageImage, PackageTask
from apps.project.models import Project, ProjectComponent, ProjectMember
from apps.release.models import ReleaseRecord, ReleaseReviewIssue
from apps.repository.models import Repository
from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask

pytestmark = pytest.mark.django_db


@pytest.fixture
def context():
    """维保成员具有旧全局权限，便于发现按项目授权的绕过入口。"""
    manager = User.objects.create_user(username="manager", password="pass")
    member = User.objects.create_user(username="maintainer", password="pass")
    project = Project.objects.create(code="MAINT", name="维保项目", leader=manager)
    ProjectMember.objects.create(project=project, user=manager, role="manager")
    ProjectMember.objects.create(project=project, user=member, role="maintainer")
    repository = Repository.objects.create(
        name="软件", vendor="gitlab", url="https://gitlab.example.com", external_identity="group/software",
        repo_type="git", created_by=manager,
    )
    component = ProjectComponent.objects.create(
        project=project, repository=repository, component_code="software", display_name="软件",
    )
    image = PackageImage.objects.create(name="镜像", image="example/software:latest")
    config = PackageConfig.objects.create(project_component=component, image=image, name="已有配置")
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, version="V1.0.0", tag_name="V1.0.0", branch="main",
        status="released", release_doc="完整发布说明", publisher=manager,
    )
    task = PackageTask.objects.create(
        project=project, repository=repository, config=config, release=release,
        name="失败任务", status="failure", triggered_by=manager,
    )
    role = Role.objects.create(code="legacy", name="旧全局维护权限")
    for code in ("package.task.delete", "repository.manage", "system.package_image", "release.audit"):
        permission, _ = Permission.objects.get_or_create(code=code, defaults={"name": code, "module": "system"})
        role.permissions.add(permission)
    UserRole.objects.create(user=member, role=role)
    client = APIClient()
    client.force_authenticate(member)
    return SimpleNamespace(
        manager=manager, member=member, project=project, repository=repository, component=component,
        image=image, config=config, release=release, task=task, client=client,
    )


def test_global_delete_permission_does_not_allow_maintainer_to_delete_task(context):
    """全局删除权限不能替代任务所属项目的维保只读授权。"""
    url = f"/api/packages/tasks/{context.task.id}/"
    response = context.client.delete(url)

    assert response.status_code == 403
    assert context.client.get(url).status_code == 200


def test_mixed_roles_cannot_register_repository_into_maintainer_project(context):
    """仓库登记附带项目时，不能隐式绕过组件创建权限。"""
    other = Project.objects.create(code="DEVELOPER", name="兼任开发项目", leader=context.manager)
    ProjectMember.objects.create(project=other, user=context.member, role="developer")
    response = context.client.post("/api/repositories/", {
        "project": str(context.project.id), "name": "新软件", "vendor": "gitlab", "repo_type": "git",
        "url": "https://gitlab.example.com/new.git", "external_identity": "group/new",
    }, format="json")
    assert response.status_code == 403


def test_mixed_roles_cannot_create_workflow_for_maintainer_project(context):
    """其他项目的开发权限不能用共享流程给维保项目发起审批。"""
    other = Project.objects.create(code="DEV", name="开发项目", leader=context.manager)
    ProjectMember.objects.create(project=other, user=context.member, role="developer")
    ProjectMember.objects.create(project=other, user=context.manager, role="manager")
    ProjectComponent.objects.create(
        project=other, repository=context.repository, component_code="shared", display_name="共享软件",
    )
    definition = WorkflowDefinition.objects.create(
        project=other, repository=context.repository, name="共享流程",
        node_config=[{"node_id": "approval", "approvers": [{"type": "user", "user_id": str(context.manager.id)}]}],
    )
    response = context.client.post("/api/workflow/instances/", {
        "definition_id": str(definition.id), "biz_type": "release", "biz_id": str(context.release.id),
    }, format="json")

    assert response.status_code == 403


@pytest.mark.parametrize("action", ["approve", "reject", "transfer", "rollback"])
def test_assigned_maintainer_cannot_mutate_approval_task(context, action):
    """任务分配不能绕过发布所在项目的维保限制。"""
    definition = WorkflowDefinition.objects.create(
        repository=context.repository, project=context.project, name="审批", node_config=[],
    )
    instance = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id=str(context.release.id),
        current_node_id="approval", node_status={"approval": "running"}, created_by=context.member,
    )
    task = WorkflowTask.objects.create(
        instance=instance, node_id="approval", node_name="审批", approver=context.member,
    )
    response = context.client.post(
        f"/api/workflow/tasks/{task.id}/{action}/",
        {"comment": "维保不能审批", "to_user_id": str(context.manager.id)}, format="json",
    )

    assert response.status_code == 403
    assert context.client.get(f"/api/workflow/tasks/{task.id}/").data["data"]["status"] == "pending"


@pytest.mark.parametrize("resource", ["repository", "image", "node", "review", "revoke", "definition"])
def test_global_or_owner_permissions_do_not_allow_maintainer_writes(context, resource):
    """全局权限、仓库所有权和原流程发起人身份不授予维保写能力。"""
    if resource == "repository":
        response = context.client.patch(f"/api/repositories/{context.repository.id}/", {"name": "不应修改"})
    elif resource == "image":
        response = context.client.patch(f"/api/packages/images/{context.image.id}/", {"name": "不应修改"})
    elif resource == "node":
        response = context.client.post("/api/packages/nodes/", {}, format="json")
    elif resource == "review":
        response = context.client.post(
            f"/api/releases/{context.release.id}/review-issues/", {"content": "不应发起整改"}, format="json"
        )
    else:
        context.repository.created_by = context.member
        context.repository.save(update_fields=["created_by"])
        definition = WorkflowDefinition.objects.create(
            repository=context.repository, project=context.project, name="原流程", node_config=[],
        )
        if resource == "definition":
            response = context.client.patch(f"/api/workflow/definitions/{definition.id}/", {"name": "不应修改"})
        else:
            instance = WorkflowInstance.objects.create(
                definition=definition, biz_type="release", biz_id=str(context.release.id), created_by=context.member,
            )
            response = context.client.post(f"/api/workflow/instances/{instance.id}/revoke/", {}, format="json")

    assert response.status_code == 403


def test_detail_capabilities_are_read_only_for_maintainer(context):
    """详情能力标志与服务端授权一致，旧全局权限不能产生写按钮。"""
    task = context.client.get(f"/api/packages/tasks/{context.task.id}/").data["data"]
    assert task["my_role"] == "maintainer"
    assert task["can_delete"] is False
    assert task["can_cancel"] is False
    release = context.client.get(f"/api/releases/{context.release.id}/").data["data"]
    assert release["can_review"] is False


@pytest.mark.parametrize("export_type", ["md", "pdf", "word"])
def test_maintainer_cannot_export_release_documents(context: SimpleNamespace, monkeypatch: pytest.MonkeyPatch, export_type: str) -> None:
    """导出路径在生成文件前拒绝，在线正文和已关联变更仍能读取。"""
    def unexpected_export(*args: object, **kwargs: object) -> None:
        pytest.fail("维保请求不能进入文件导出器")

    monkeypatch.setattr("apps.release.views.ReleaseDocExporter.export_pdf", unexpected_export)
    monkeypatch.setattr("apps.release.views.ReleaseDocExporter.export_word", unexpected_export)
    response = context.client.get(f"/api/releases/{context.release.id}/export-{export_type}/")
    assert response.status_code == 403
    assert "Content-Disposition" not in response
    assert context.client.get(f"/api/releases/{context.release.id}/").data["data"]["release_doc"] == "完整发布说明"


@pytest.mark.parametrize("already_favorite", [False, True])
def test_maintainer_favorite_request_preserves_existing_preference(context: SimpleNamespace, already_favorite: bool) -> None:
    """维保不再切换收藏，历史收藏数据也不因收权删除。"""
    from apps.package.models import PackageConfigFavorite

    if already_favorite:
        PackageConfigFavorite.objects.create(user=context.member, config=context.config)
    response = context.client.post(f"/api/packages/configs/{context.config.id}/favorite/", {}, format="json")
    assert response.status_code == 403
    assert PackageConfigFavorite.objects.filter(user=context.member, config=context.config).exists() is already_favorite


@pytest.mark.parametrize("payload", [{"project": "not-a-uuid"}, [], "not-an-object"])
def test_favorite_permission_uses_real_config_not_request_body(context: SimpleNamespace, payload: object) -> None:
    """旧调用或构造请求体不能改变配置所属项目，也不能触发权限检查内部错误。"""
    response = context.client.post(f"/api/packages/configs/{context.config.id}/favorite/", payload, format="json")
    assert response.status_code == 403


def test_favorite_rechecks_role_after_object_authorization(context: SimpleNamespace, monkeypatch: pytest.MonkeyPatch) -> None:
    """在视图对象授权后改任维保，收藏服务必须按当前成员关系拒绝。"""
    from apps.package.models import PackageConfigFavorite
    from apps.package.services import PackageService

    membership = ProjectMember.objects.get(project=context.project, user=context.member)
    membership.role = "developer"
    membership.save(update_fields=["role"])
    original_toggle = PackageService.toggle_favorite

    def change_role_then_toggle(config: PackageConfig, user: User) -> bool:
        ProjectMember.objects.filter(pk=membership.pk).update(role="maintainer")
        return original_toggle(config, user)

    monkeypatch.setattr(PackageService, "toggle_favorite", change_role_then_toggle)
    response = context.client.post(f"/api/packages/configs/{context.config.id}/favorite/", {}, format="json")
    assert response.status_code == 403
    assert not PackageConfigFavorite.objects.filter(user=context.member, config=context.config).exists()


@pytest.mark.parametrize("role", ["developer", "tester", "manager", "software_admin", "viewer", "auditor", "leader", "superuser"])
def test_original_roles_keep_exports_and_favorites(context: SimpleNamespace, role: str) -> None:
    """原项目角色、显式成员负责人和超管继续使用既有导出与收藏能力。"""
    membership = ProjectMember.objects.get(project=context.project, user=context.member)
    membership.role = role if role not in ("leader", "superuser") else "maintainer"
    membership.save(update_fields=["role"])
    if role == "leader":
        context.project.leader = context.member
        context.project.save(update_fields=["leader"])
    elif role == "superuser":
        context.member.is_superuser = True
        context.member.save(update_fields=["is_superuser"])

    response = context.client.get(f"/api/releases/{context.release.id}/export-md/")
    assert response.status_code == 200
    assert "完整发布说明" in response.content.decode()
    url = f"/api/packages/configs/{context.config.id}/favorite/"
    assert context.client.post(url, {}, format="json").data["data"]["is_favorite"] is True
    assert context.client.post(url, {}, format="json").data["data"]["is_favorite"] is False


@pytest.mark.parametrize("other_role", ["developer", "tester", "manager"])
def test_mixed_project_roles_keep_only_target_project_exports_and_favorites(
    context: SimpleNamespace, other_role: str,
) -> None:
    """共享仓库不串项目授权，降权后旧链接也立即失效且历史收藏保留。"""
    from apps.package.models import PackageConfigFavorite

    other = Project.objects.create(code="MIXED-FILES", name="兼任项目", leader=context.manager)
    membership = ProjectMember.objects.create(project=other, user=context.member, role=other_role)
    component = ProjectComponent.objects.create(project=other, repository=context.repository, component_code="shared")
    config = PackageConfig.objects.create(project_component=component, image=context.image, name="兼任配置")
    release = ReleaseRecord.objects.create(
        project=other, repository=context.repository, publisher=context.manager,
        version="V2.0.0", status="released", release_doc="兼任项目完整说明",
    )
    export_url = f"/api/releases/{release.id}/export-md/"
    favorite_url = f"/api/packages/configs/{config.id}/favorite/"
    assert context.client.get(export_url).status_code == 200
    assert context.client.post(favorite_url, {}, format="json").status_code == 200
    assert context.client.get(f"/api/releases/{context.release.id}/export-md/").status_code == 403
    assert context.client.post(f"/api/packages/configs/{context.config.id}/favorite/", {}, format="json").status_code == 403
    membership.role = "maintainer"
    membership.save(update_fields=["role"])
    assert context.client.get(export_url).status_code == 403
    assert context.client.post(favorite_url, {}, format="json").status_code == 403
    assert PackageConfigFavorite.objects.filter(user=context.member, config=config).exists()
    assert context.client.get(f"/api/releases/{release.id}/").data["data"]["release_doc"] == "兼任项目完整说明"


def test_project_readonly_does_not_block_personal_profile_or_notifications(context: SimpleNamespace) -> None:
    """项目业务收权不影响维保用户维护个人资料或标记个人通知已读。"""
    from apps.notification.models import Notification

    notification = Notification.objects.create(user=context.member, notification_type="system", title="个人通知", content="可标记已读")
    response = context.client.patch(f"/api/account/users/{context.member.id}/", {"nickname": "更新个人昵称"}, format="json")
    assert response.status_code == 200
    context.member.refresh_from_db()
    assert context.member.nickname == "更新个人昵称"
    assert context.client.post(f"/api/notifications/{notification.id}/read/", {}, format="json").status_code == 200
    notification.refresh_from_db()
    assert notification.is_read is True


def test_workflow_capabilities_are_read_only_even_when_assigned(context):
    """详情不会把任务分配或历史发起人身份展示成维保的审批/撤销能力。"""
    definition = WorkflowDefinition.objects.create(
        repository=context.repository, project=context.project, name="审批", node_config=[],
    )
    instance = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id=str(context.release.id), created_by=context.member,
    )
    task = WorkflowTask.objects.create(instance=instance, node_id="approval", approver=context.member)
    detail = context.client.get(f"/api/workflow/tasks/{task.id}/").data["data"]
    assert detail["can_act"] is False
    workflow = context.client.get(f"/api/workflow/instances/{instance.id}/").data["data"]
    assert workflow["can_revoke"] is False


def test_former_reviewer_cannot_judge_after_becoming_maintainer(context):
    """历史意见作者改任维保后，不能把作者身份显示为整改判定能力。"""
    issue = ReleaseReviewIssue.objects.create(release=context.release, author=context.member, content="历史审查意见", status="replied")
    reviews = context.client.get(f"/api/releases/{context.release.id}/review-issues/").data["data"]
    assert next(item for item in reviews if str(item["id"]) == str(issue.id))["can_judge"] is False


@pytest.mark.parametrize("actor_role", ["manager", "software_admin", "superuser"])
def test_authorized_roles_can_grant_and_update_maintainer(context, actor_role):
    """授予维保沿用项目内的授权上限，不限制用户在其他项目的角色。"""
    actor = User.objects.create_user(username=f"actor_{actor_role}", password="pass", is_superuser=actor_role == "superuser")
    if actor_role != "superuser":
        ProjectMember.objects.create(project=context.project, user=actor, role=actor_role)
    newcomer = User.objects.create_user(username="newcomer", password="pass")
    context.client.force_authenticate(actor)
    url = f"/api/projects/{context.project.id}/members/"
    response = context.client.post(url, {"user_id": str(newcomer.id), "role": "maintainer"}, format="json")
    assert response.status_code == 201
    assert response.data["data"]["role_display"] == "维保人员"
    response = context.client.patch(f"{url}{response.data['data']['id']}/", {"role": "developer"}, format="json")
    assert response.status_code == 200
    assert response.data["data"]["role"] == "developer"


@pytest.mark.parametrize("method,path", [
    ("patch", "projects/{project}/"),
    ("post", "projects/{project}/components/"),
    ("patch", "projects/{project}/components/{component}/"),
    ("delete", "projects/{project}/components/{component}/"),
    ("patch", "projects/{project}/members/{member}/"),
    ("delete", "projects/{project}/members/{member}/"),
    ("post", "releases/"),
    ("patch", "releases/{release}/"),
    ("delete", "releases/{release}/"),
    ("post", "releases/{release}/generate-doc/"),
    ("post", "releases/{release}/update-doc/"),
    ("post", "releases/{release}/submit-audit/"),
    ("post", "releases/{release}/push-tag/"),
    ("post", "releases/{release}/retry-push-tag/"),
    ("post", "releases/{release}/cleanup-tag/"),
    ("post", "releases/{release}/delete-released/"),
    ("post", "packages/configs/"),
    ("patch", "packages/configs/{config}/"),
    ("delete", "packages/configs/{config}/"),
    ("post", "packages/configs/{config}/trigger/"),
    ("post", "packages/configs/{config}/trigger-branch/"),
    ("post", "packages/configs/{config}/favorite/"),
    ("post", "packages/tasks/{task}/cancel/"),
    ("post", "packages/tasks/{task}/push-svn/"),
    ("post", "repositories/{repository}/delete-tag/"),
])
def test_maintainer_cannot_write_project_resources(context, method, path):
    """使用旧全局权限直接调用写接口，仍须服从目标项目的角色授权。"""
    values = {name: getattr(context, name).id for name in ("project", "component", "release", "config", "task", "repository")}
    values["member"] = ProjectMember.objects.get(project=context.project, user=context.manager).id
    url = "/api/" + path.format(**values)
    response = getattr(context.client, method)(url, {
        "project": str(context.project.id), "project_component": str(context.component.id), "role": "developer",
    }, format="json")
    assert response.status_code == 403


def test_mixed_roles_keep_developer_actions_in_other_project(context):
    """同一仓库在两个项目发布时，任务和文档写能力按真实所属项目独立计算。"""
    other = Project.objects.create(code="DEV", name="开发项目", leader=context.manager)
    ProjectMember.objects.create(project=other, user=context.member, role="developer")
    ProjectMember.objects.create(project=other, user=context.manager, role="manager")
    ProjectComponent.objects.create(project=other, repository=context.repository, component_code="shared", display_name="共享软件")
    release = ReleaseRecord.objects.create(
        project=other, repository=context.repository, version="V2.0.0", branch="main",
        status="draft", publisher=context.member, release_doc="开发项目说明",
    )
    response = context.client.post(f"/api/releases/{release.id}/update-doc/", {"release_doc": "已更新"}, format="json")
    assert response.status_code == 200
    assert response.data["data"]["release_doc"] == "已更新"
    assert context.client.post(f"/api/releases/{context.release.id}/update-doc/", {"release_doc": "不应更新"}, format="json").status_code == 403
    task = PackageTask.objects.create(project=other, repository=context.repository, name="开发任务", status="failure", triggered_by=context.member)
    assert context.client.get(f"/api/packages/tasks/{task.id}/").data["data"]["can_delete"] is True
    assert context.client.delete(f"/api/packages/tasks/{task.id}/").status_code == 200
    assert context.client.delete(f"/api/packages/tasks/{context.task.id}/").status_code == 403


def test_explicit_maintainer_membership_keeps_leader_effective_role(context):
    """有显式成员记录的负责人仍使用 manager 有效角色，超管也保留原有能力。"""
    context.project.leader = context.member
    context.project.save(update_fields=["leader"])
    assert context.client.get(f"/api/projects/{context.project.id}/").data["data"]["my_role"] == "manager"
    assert context.client.patch(f"/api/projects/{context.project.id}/", {"name": "负责人仍可管理"}).status_code == 200
    assert context.client.patch(f"/api/packages/configs/{context.config.id}/", {
        "project_component": str(context.component.id), "name": "负责人配置",
    }, format="json").status_code == 200


def test_maintainer_in_one_project_can_still_be_external_approver(context):
    """维保职责不会剥夺其他项目按指定人员授予的审批能力。"""
    from apps.workflow.services import WorkflowEngine

    other = Project.objects.create(code="EXTERNAL", name="外部审批项目", leader=context.manager)
    ProjectMember.objects.create(project=other, user=context.manager, role="manager")
    release = ReleaseRecord.objects.create(project=other, repository=context.repository, version="V3.0.0", branch="main", status="pending", publisher=context.manager)
    definition = WorkflowDefinition.objects.create(project=other, repository=context.repository, name="指定人员审批", node_config=[{
        "node_id": "approval", "node_name": "指定人员", "mode": "any",
        "approvers": [{"type": "user", "user_id": str(context.member.id)}],
    }])
    instance = WorkflowEngine.create_instance(definition, "release", str(release.id), context.manager)
    task = instance.tasks.get(approver=context.member)
    assert context.client.get(f"/api/workflow/tasks/{task.id}/").data["data"]["can_act"] is True
    response = context.client.post(f"/api/workflow/tasks/{task.id}/transfer/", {"to_user_id": str(context.manager.id)}, format="json")
    assert response.status_code == 200
    assert response.data["data"]["status"] == "transferred"


@pytest.mark.parametrize("biz_id_style", ["canonical", "upper", "braces", "urn", "hex", "plus", "underscore", "unicode_decimal"])
def test_shared_repository_and_global_permissions_do_not_expand_read_scope(context, biz_id_style):
    """可读取所属项目说明和组件，共享仓库和全局权限不泄漏非成员项目发布/任务。"""
    other = Project.objects.create(code="PRIVATE", name="其他项目", leader=context.manager)
    ProjectMember.objects.create(project=other, user=context.manager, role="manager")
    ProjectComponent.objects.create(project=other, repository=context.repository, component_code="shared", display_name="共享软件")
    release = ReleaseRecord.objects.create(id="01234567-89ab-4def-8123-456789abcdef", project=other, repository=context.repository, version="V9.0.0", branch="main", status="released", publisher=context.manager)
    release.refresh_from_db()
    task = PackageTask.objects.create(project=other, repository=context.repository, name="其他任务", status="failure", triggered_by=context.manager)
    from apps.package.models import PackageConfigFavorite

    component = other.project_components.get(repository=context.repository)
    config = PackageConfig.objects.create(project_component=component, image=context.image, name="曾收藏的配置")
    PackageConfigFavorite.objects.create(user=context.member, config=config)
    assert context.client.get(f"/api/packages/configs/{config.id}/").status_code == 404
    favorites = context.client.get("/api/packages/configs/favorites/").data["data"]
    assert str(config.id) not in [str(item["id"]) for item in favorites]
    for path in (f"projects/{other.id}/", f"releases/{release.id}/", f"packages/tasks/{task.id}/"):
        assert context.client.get("/api/" + path).status_code == 404
    assert context.client.get(f"/api/projects/{context.project.id}/components/").status_code == 200
    export = context.client.get(f"/api/releases/{context.release.id}/export-md/")
    assert export.status_code == 403
    assert "完整发布说明" not in export.content.decode("utf-8")
    for path, hidden_id in (("releases", release.id), ("packages/tasks", task.id)):
        visible = context.client.get(f"/api/{path}/").data["data"]["results"]
        assert str(hidden_id) not in [str(item["id"]) for item in visible]
    definition = WorkflowDefinition.objects.create(project=other, repository=context.repository, name="其他项目流程", node_config=[])
    biz_id = {
        "canonical": str(release.id), "upper": str(release.id).upper(), "braces": "{" + str(release.id) + "}",
        "urn": "urn:uuid:" + str(release.id), "hex": release.id.hex,
        "plus": "+" + release.id.hex[1:],
        "underscore": release.id.hex[1:12] + "_" + release.id.hex[12:],
        "unicode_decimal": release.id.hex.replace("1", "١"),
    }[biz_id_style]
    instance = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=biz_id, created_by=context.manager)
    assert context.client.get(f"/api/workflow/instances/{instance.id}/").status_code == 404
    visible = context.client.get("/api/workflow/instances/").data["data"]["results"]
    assert str(instance.id) not in [str(item["id"]) for item in visible]


def test_pure_maintainer_owner_cannot_edit_orphan_repository_workflow(context):
    """纯维保的仓库所有权不能授权修改已脱离项目的仓库审批链。"""
    context.repository.created_by = context.member
    context.repository.save(update_fields=["created_by"])
    context.component.is_active = False
    context.component.save(update_fields=["is_active"])
    definition = WorkflowDefinition.objects.create(repository=context.repository, name="历史仓库流程", node_config=[])
    assert context.client.patch(f"/api/workflow/definitions/{definition.id}/", {"node_config": []}, format="json").status_code == 403


def test_release_biz_id_migration_preserves_links_and_invalid_history(context):
    """数据迁移只规范化发布 UUID 文本，历史异常值和其他业务保持不变。"""
    from importlib import import_module

    from django.apps import apps
    from django.db import connection

    definition = WorkflowDefinition.objects.create(project=context.project, repository=context.repository, name="迁移验收流程", node_config=[])
    valid = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(context.release.id), created_by=context.manager)
    original_id = "{" + str(context.release.id).upper() + "}"
    # 模拟迁移前的历史数据库内容，避免新模型 save 提前完成规范化。
    WorkflowInstance.objects.filter(pk=valid.pk).update(biz_id=original_id)
    # 异常 ID 没有可验证的发布归属；仅历史项目级定义可作为可靠项目来源。
    legacy_definition = WorkflowDefinition.objects.create(project=context.project, name="项目级历史流程")
    invalid = WorkflowInstance.objects.create(definition=legacy_definition, biz_type="release", biz_id="无法解析的旧业务", status="revoked", created_by=context.manager)
    other = WorkflowInstance.objects.create(definition=definition, biz_type="legacy", biz_id=original_id, created_by=context.manager)
    migration = import_module("apps.workflow.migrations.0010_normalize_release_biz_ids")
    migration.normalize_release_biz_ids(apps, connection.schema_editor())
    for instance, expected in ((valid, str(context.release.id)), (invalid, "无法解析的旧业务"), (other, original_id)):
        detail = context.client.get(f"/api/workflow/instances/{instance.id}/").data["data"]
        assert detail["biz_id"] == expected
    assert context.client.get(f"/api/workflow/instances/{valid.id}/").data["data"]["release_doc"] == "完整发布说明"
    assert context.client.get(f"/api/workflow/instances/{invalid.id}/").data["data"]["status"] == "revoked"


def test_unparseable_legacy_workflow_uses_explicit_project_not_shared_repository(context):
    """不可解析业务只按旧流程定义项目授权，不能跨共享仓库扩大。"""
    other = Project.objects.create(code="LEGACYPRIVATE", name="其他项目", leader=context.manager)
    ProjectMember.objects.create(project=other, user=context.manager, role="manager")
    ProjectComponent.objects.create(project=other, repository=context.repository, component_code="shared")
    definition = WorkflowDefinition.objects.create(
        project=other, name="其他项目级历史流程", node_config=[],
    )
    history = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id="无法解析的历史业务", status="revoked")
    assert context.client.get(f"/api/workflow/instances/{history.id}/").status_code == 404
    visible = context.client.get("/api/workflow/instances/").data["data"]["results"]
    assert str(history.id) not in [str(item["id"]) for item in visible]
    ProjectMember.objects.create(project=other, user=context.member, role="maintainer")
    authorized = context.client.get(f"/api/workflow/instances/{history.id}/")
    assert authorized.status_code == 200 and authorized.data["data"]["project_name"] == other.name
    definition.project = context.project
    definition.save(update_fields=["project"])
    authorized = context.client.get(f"/api/workflow/instances/{history.id}/")
    assert authorized.status_code == 200 and authorized.data["data"]["project_name"] == other.name
    definition.repository = context.repository
    definition.save(update_fields=["repository"])
    assert context.client.get(f"/api/workflow/instances/{history.id}/").status_code == 404
    definition.repository = None
    definition.save(update_fields=["repository"])
    ProjectMember.objects.filter(project=other, user=context.member).delete()
    assert context.client.get(f"/api/workflow/instances/{history.id}/").status_code == 404


def test_unparseable_history_backfill_does_not_infer_deleted_release_project(context):
    """迁移只记录无法解析 ID 的旧项目，已删除的合法发布不能按流程项目授权。"""
    import uuid
    from importlib import import_module

    from django.apps import apps
    from django.db import connection

    definition = WorkflowDefinition.objects.create(project=context.project, name="项目级旧流程")
    invalid = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id="旧格式业务", status="revoked")
    deleted = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id=str(uuid.uuid4()), status="revoked")
    WorkflowInstance.objects.filter(pk=invalid.pk).update(legacy_project=None, legacy_biz_id="")
    migration = import_module("apps.workflow.migrations.0014_workflowinstance_legacy_biz_id_and_more")
    migration.backfill_invalid_legacy_projects(apps, connection.schema_editor())
    invalid.refresh_from_db()
    deleted.refresh_from_db()
    assert invalid.legacy_project_id == context.project.id and invalid.legacy_biz_id == "旧格式业务"
    assert deleted.legacy_project_id is None
    assert context.client.get(f"/api/workflow/instances/{invalid.id}/").status_code == 200
    assert context.client.get(f"/api/workflow/instances/{deleted.id}/").status_code == 404
    WorkflowInstance.objects.filter(pk=invalid.pk).update(biz_id=str(uuid.uuid4()))
    assert context.client.get(f"/api/workflow/instances/{invalid.id}/").status_code == 404
    invalid.refresh_from_db()
    invalid.biz_id = str(uuid.uuid4())
    invalid.save(update_fields=["biz_id"])
    invalid.refresh_from_db()
    assert invalid.legacy_project_id is None and invalid.legacy_biz_id == ""


@pytest.mark.parametrize("biz_id_style", ["canonical", "upper", "braces", "urn", "hex", "plus", "underscore", "unicode_decimal"])
def test_changed_legacy_id_cannot_reuse_project_authorization(context, biz_id_style):
    """原异常 ID 与当前 ID 不一致时，不得用旧项目授权读取其他项目发布。"""
    other = Project.objects.create(code="LEGACYTARGET", name="其他项目", leader=context.manager)
    ProjectMember.objects.create(project=other, user=context.manager, role="manager")
    ProjectComponent.objects.create(project=other, repository=context.repository, component_code="shared")
    release = ReleaseRecord.objects.create(
        id="01234567-89ab-4def-8123-456789abcdef", project=other, repository=context.repository,
        version="V9.0.0", branch="main", publisher=context.manager,
    )
    release.refresh_from_db()
    definition = WorkflowDefinition.objects.create(project=context.project, name="项目级旧流程")
    history = WorkflowInstance.objects.create(definition=definition, biz_type="release", biz_id="历史异常", status="revoked")
    assert context.client.get(f"/api/workflow/instances/{history.id}/").status_code == 200
    raw = {
        "canonical": str(release.id), "upper": str(release.id).upper(), "braces": "{" + str(release.id) + "}",
        "urn": "urn:uuid:" + str(release.id), "hex": release.id.hex,
        "plus": "+" + release.id.hex[1:], "underscore": release.id.hex[1:12] + "_" + release.id.hex[12:],
        "unicode_decimal": release.id.hex.replace("1", "١"),
    }[biz_id_style]
    WorkflowInstance.objects.filter(pk=history.pk).update(biz_id=raw)
    assert context.client.get(f"/api/workflow/instances/{history.id}/").status_code == 404


def test_shared_workflow_definition_cannot_authorize_invalid_legacy_id(context):
    """仓库级流程的历史项目字段不能证明异常记录属于该项目。"""
    from importlib import import_module

    from django.apps import apps
    from django.db import connection

    other = Project.objects.create(code="SHARED_B", name="共享仓库另一项目", leader=context.manager)
    ProjectMember.objects.create(project=other, user=context.manager, role="manager")
    ProjectComponent.objects.create(project=other, repository=context.repository, component_code="shared")
    definition = WorkflowDefinition.objects.create(
        project=context.project, repository=context.repository, name="跨项目复用的仓库流程",
    )
    history = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id="无法解析业务", status="revoked", created_by=context.manager,
    )
    assert context.client.get(f"/api/workflow/instances/{history.id}/").status_code == 404
    WorkflowInstance.objects.filter(pk=history.pk).update(legacy_project=None, legacy_biz_id="")
    migration = import_module("apps.workflow.migrations.0014_workflowinstance_legacy_biz_id_and_more")
    migration.backfill_invalid_legacy_projects(apps, connection.schema_editor())
    history.refresh_from_db()
    assert history.legacy_project_id is None
    assert context.client.get(f"/api/workflow/instances/{history.id}/").status_code == 404
    WorkflowTask.objects.create(instance=history, node_id="old", node_name="旧审批", approver=context.member, status="approved")
    assert context.client.get(f"/api/workflow/instances/{history.id}/").status_code == 200


@pytest.mark.parametrize("has_source_project", [False, True])
def test_orm_biz_id_change_cannot_infer_legacy_project(context, has_source_project):
    """已有实例修改业务 ID 时清除旧来源，不能从定义项目重新推断。"""
    definition = WorkflowDefinition.objects.create(project=context.project, name="项目级旧流程")
    instance = WorkflowInstance.objects.create(
        definition=definition, source_project=context.project if has_source_project else None,
        biz_type="release", biz_id=str(context.release.id), status="revoked", created_by=context.manager,
    )
    assert context.client.get(f"/api/workflow/instances/{instance.id}/").status_code == 200
    instance.biz_id = "新异常业务"
    instance.save(update_fields=["biz_id"])
    instance.refresh_from_db()
    assert instance.source_project_id is None
    assert instance.legacy_project_id is None and instance.legacy_biz_id == ""
    assert context.client.get(f"/api/workflow/instances/{instance.id}/").status_code == 404


def test_orm_legacy_id_change_clears_authorization(context):
    """项目级历史实例更换异常业务 ID 后，不能继承原异常业务的授权。"""
    definition = WorkflowDefinition.objects.create(project=context.project, name="项目级历史流程")
    instance = WorkflowInstance.objects.create(
        definition=definition, biz_type="release", biz_id="旧异常业务", status="revoked", created_by=context.manager,
    )
    assert context.client.get(f"/api/workflow/instances/{instance.id}/").status_code == 200
    instance.biz_id = "另一异常业务"
    instance.save(update_fields=["biz_id"])
    instance.refresh_from_db()
    assert instance.legacy_project_id is None and instance.legacy_biz_id == ""
    assert context.client.get(f"/api/workflow/instances/{instance.id}/").status_code == 404


def test_orm_definition_change_clears_legacy_authorization(context):
    """历史实例改换定义时不得沿用旧定义项目的授权依据。"""
    other = Project.objects.create(code="OTHER_DEFINITION", name="其他项目", leader=context.manager)
    ProjectMember.objects.create(project=other, user=context.manager, role="manager")
    original = WorkflowDefinition.objects.create(project=context.project, name="原项目级定义")
    replacement = WorkflowDefinition.objects.create(project=other, name="新项目级定义")
    instance = WorkflowInstance.objects.create(
        definition=original, biz_type="release", biz_id="异常历史", status="revoked", created_by=context.manager,
    )
    assert context.client.get(f"/api/workflow/instances/{instance.id}/").status_code == 200
    instance.definition = replacement
    instance.save(update_fields=["definition"])
    instance.refresh_from_db()
    assert instance.legacy_project_id is None and instance.legacy_biz_id == ""
    assert context.client.get(f"/api/workflow/instances/{instance.id}/").status_code == 404


@pytest.mark.parametrize("replacement_id", ["业务标识已损坏", "11111111-1111-4111-8111-111111111111"])
def test_bulk_biz_id_change_cannot_reuse_source_project(context, replacement_id):
    """批量更新绕过模型 save 时，也不能沿用原发布项目快照放权。"""
    definition = WorkflowDefinition.objects.create(project=context.project, repository=context.repository, name="旧仓库流程")
    instance = WorkflowInstance.objects.create(
        definition=definition, source_project=context.project, biz_type="release",
        biz_id=str(context.release.id), status="revoked", created_by=context.manager,
    )
    assert context.client.get(f"/api/workflow/instances/{instance.id}/").status_code == 200
    WorkflowInstance.objects.filter(pk=instance.pk).update(biz_id=replacement_id)
    assert context.client.get(f"/api/workflow/instances/{instance.id}/").status_code == 404


def test_source_project_backfill_only_binds_existing_matching_release(context):
    """来源快照仅在现存发布项目可核实时绑定原 ID，已删除发布不推断。"""
    import uuid
    from importlib import import_module

    from django.apps import apps
    from django.db import connection

    definition = WorkflowDefinition.objects.create(project=context.project, repository=context.repository, name="仓库流程")
    existing = WorkflowInstance.objects.create(
        definition=definition, source_project=context.project, biz_type="release", biz_id=str(context.release.id), status="revoked",
    )
    missing = WorkflowInstance.objects.create(
        definition=definition, source_project=context.project, biz_type="release", biz_id=str(uuid.uuid4()), status="revoked",
    )
    WorkflowInstance.objects.filter(pk__in=[existing.pk, missing.pk]).update(source_biz_id="")
    migration = import_module("apps.workflow.migrations.0014_workflowinstance_legacy_biz_id_and_more")
    migration.backfill_source_project_ids(apps, connection.schema_editor())
    existing.refresh_from_db()
    missing.refresh_from_db()
    assert existing.source_biz_id == str(context.release.id)
    assert missing.source_biz_id == ""
    assert context.client.get(f"/api/workflow/instances/{missing.id}/").status_code == 404
