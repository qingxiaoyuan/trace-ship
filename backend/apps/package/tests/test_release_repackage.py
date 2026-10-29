"""已发布版本补打的真实 REST、授权、快照和审计回归。"""
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from django.db import transaction
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.test import APIClient

from apps.account.models import User
from apps.package.models import PackageConfig, PackageImage, PackageTask
from apps.package.services import PackageService
from apps.project.models import Project, ProjectComponent, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository
from apps.system.models import OperationLog

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture
def context(monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    """仅替换外部任务投递，不替换业务服务、认证授权与审计。"""
    users = {
        role: User.objects.create_user(username=f"repackage_{role}", nickname=f"补打{role}")
        for role in ("manager", "developer", "tester", "maintainer", "viewer", "auditor", "software_admin")
    }
    project = Project.objects.create(code="REPACKAGE", name="补打项目", leader=users["manager"])
    for role, user in users.items():
        ProjectMember.objects.create(project=project, user=user, role=role)
    repository = Repository.objects.create(
        name="补打软件", vendor="gitlab", url="https://gitlab.example.com",
        external_identity="demo/repackage", created_by=users["manager"],
    )
    component = ProjectComponent.objects.create(
        project=project, repository=repository, component_code="demo", display_name="补打软件",
    )
    image = PackageImage.objects.create(name="补打镜像", image="demo/package:1")
    config = PackageConfig.objects.create(
        project_component=component, image=image, name="正式打包配置", custom_script="echo saved-script",
        env_vars={"BUILD_FLAG": "saved-value"}, svn_push_enabled=True,
        svn_url="https://svn.example.com/releases", clone_submodules=True,
    )
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=users["developer"], status="released",
        version="V2.3.4", tag_name="V2.3.4_20261020", git_hash="a" * 40,
        branch="old-main", release_type="formal",
    )
    dispatched = []
    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", lambda task_id: dispatched.append(task_id))
    client = APIClient()
    client.force_authenticate(users["developer"])
    return SimpleNamespace(
        users=users, client=client, project=project, repository=repository,
        config=config, release=release, dispatched=dispatched,
    )


def trigger(
    context: SimpleNamespace, payload: dict[str, object] | None = None,
    config_id: UUID | str | None = None,
) -> Response:
    """通过真实 REST 路由补打，不直接调用创建服务。"""
    return context.client.post(
        f"/api/packages/configs/{config_id or context.config.id}/trigger/",
        payload if payload is not None else {"release_id": str(context.release.id)}, format="json",
    )


@pytest.mark.parametrize("role", ["developer", "tester", "manager", "software_admin"])
def test_authorized_roles_repackage_fixed_release_with_actual_actor(context: SimpleNamespace, role: str) -> None:
    """既有打包角色创建真实快照任务，并审计实际操作人。"""
    actor = context.users[role]
    context.client.force_authenticate(actor)
    response = trigger(context)

    assert response.status_code == 201, response.data
    task = PackageTask.objects.get(id=response.data["data"]["id"])
    assert task.triggered_by == actor
    assert task.release == context.release
    assert task.config == context.config
    assert task.project == context.project
    assert task.repository == context.repository
    assert (task.version, task.tag_name, task.commit_hash, task.source_ref) == (
        context.release.version, context.release.tag_name, context.release.git_hash, context.release.tag_name,
    )
    assert task.config_snapshot["custom_script"] == "echo saved-script"
    assert task.config_snapshot["env_vars"] == {"BUILD_FLAG": "saved-value"}
    assert task.config_snapshot["image"] == context.config.image.image
    assert task.config_snapshot["trigger_source"] == "manual_release"
    assert task.config_snapshot["svn_push_enabled"] is True
    assert context.dispatched == [str(task.id)]
    log = OperationLog.objects.get(action="trigger_release")
    assert log.user == actor
    assert log.result == "success"
    assert log.detail["project_id"] == str(context.project.id)
    assert log.detail["config_id"] == str(context.config.id)
    assert log.detail["release_id"] == str(context.release.id)
    assert log.detail["version"] == context.release.version
    assert log.detail["task_id"] == str(task.id)


@pytest.mark.parametrize("role", ["maintainer", "viewer", "auditor"])
def test_read_only_roles_cannot_repackage(context: SimpleNamespace, role: str) -> None:
    context.client.force_authenticate(context.users[role])
    assert trigger(context).status_code == 403
    assert not PackageTask.objects.exists()
    assert not context.dispatched
    assert OperationLog.objects.get(action="trigger_release").result == "failure"


def test_maintainer_cannot_trigger_branch_or_edit_config(context: SimpleNamespace) -> None:
    """维保不再授予任何打包触发或配置写权限。"""
    context.client.force_authenticate(context.users["maintainer"])
    url = f"/api/packages/configs/{context.config.id}/"
    assert context.client.post(url + "trigger-branch/", {"branch": "main"}, format="json").status_code == 403
    assert context.client.patch(url, {"custom_script": "echo injected"}, format="json").status_code == 403
    assert not PackageTask.objects.exists()
    assert not context.dispatched


@pytest.mark.parametrize("field,value", [
    ("branch", "main"), ("custom_script", "echo injected"), ("env_vars", {"SECRET": "injected"}),
    ("image", str(uuid4())), ("node", str(uuid4())), ("config_snapshot", {}),
    ("triggered_by", str(uuid4())), ("project", "bad-id"), ("project_component", "bad-id"),
    ("source_ref", "main"),
])
def test_trigger_rejects_parameter_overrides(context: SimpleNamespace, field: str, value: object) -> None:
    response = trigger(context, {"release_id": str(context.release.id), field: value})
    assert response.status_code == 400, response.data
    assert field in str(response.data)
    assert not PackageTask.objects.exists()
    assert not context.dispatched


@pytest.mark.parametrize("payload", [
    {}, {"release_id": "not-a-uuid"}, {"release_id": None}, {"release_id": []},
    {"release": str(uuid4()), "release_id": str(uuid4())},
])
def test_invalid_release_identifiers_are_client_errors(context: SimpleNamespace, payload: dict[str, object]) -> None:
    response = trigger(context, payload)
    assert response.status_code == 400, response.data
    assert not PackageTask.objects.exists()


@pytest.mark.parametrize("payload", [[], ["release_id"], "not-an-object", 123])
def test_non_object_json_body_is_a_client_error(context: SimpleNamespace, payload: object) -> None:
    """发布补打权限不读取客户端项目，非对象请求也应返回标准参数错误。"""
    response = context.client.post(
        f"/api/packages/configs/{context.config.id}/trigger/", payload, format="json",
    )
    assert response.status_code == 400, response.data
    assert response.data["message"] == "参数错误"
    assert not PackageTask.objects.exists()
    assert not context.dispatched
    assert OperationLog.objects.get(action="trigger_release").result == "failure"


def test_release_alias_and_matching_aliases_remain_compatible(context: SimpleNamespace) -> None:
    release_id = str(context.release.id)
    assert trigger(context, {"release": release_id}).status_code == 201
    assert trigger(context, {"release": release_id, "release_id": release_id}).status_code == 201
    assert PackageTask.objects.count() == 2


@pytest.mark.parametrize("change", ["disabled", "draft", "pending", "rejected", "wrong-repository", "wrong-project"])
def test_ineligible_config_release_combinations_do_not_create_tasks(context: SimpleNamespace, change: str) -> None:
    if change == "disabled":
        context.config.is_active = False
        context.config.save(update_fields=["is_active"])
    elif change == "wrong-project":
        other = Project.objects.create(code="SHARED", name="共享仓库项目", leader=context.users["manager"])
        ProjectMember.objects.create(project=other, user=context.users["developer"], role="developer")
        context.release.project = other
        context.release.save(update_fields=["project"])
    elif change == "wrong-repository":
        context.release.repository = Repository.objects.create(
            name="其他软件", vendor="gitlab", url="https://gitlab.example.com", external_identity="demo/other",
        )
        context.release.save(update_fields=["repository"])
    else:
        context.release.status = change
        context.release.save(update_fields=["status"])
    response = trigger(context)
    assert response.status_code == 400, response.data
    assert not PackageTask.objects.exists()
    assert OperationLog.objects.get(action="trigger_release").result == "failure"


def test_cross_project_hidden_release_and_forged_ids_do_not_leak_details(context: SimpleNamespace) -> None:
    """共享仓库不扩大项目数据可见性，外部 ID 与不存在 ID 使用相同反馈。"""
    hidden = Project.objects.create(code="HIDDEN", name="不可见项目", leader=context.users["manager"])
    context.release.project = hidden
    context.release.save(update_fields=["project"])
    responses = [trigger(context), trigger(context, {"release_id": str(uuid4())})]
    assert all(response.status_code == 404 for response in responses)
    assert responses[0].data == responses[1].data
    assert not PackageTask.objects.exists()
    for log in OperationLog.objects.filter(action="trigger_release"):
        assert "version" not in log.detail
        assert "不可见项目" not in str(log.detail)


def test_other_project_roles_and_repository_ownership_do_not_grant_trigger(context: SimpleNamespace) -> None:
    """其他项目的管理员身份和仓库所有权均不能替代目标项目成员记录。"""
    actor = User.objects.create_user(username="external_owner")
    context.repository.created_by = actor
    context.repository.save(update_fields=["created_by"])
    other = Project.objects.create(code="OWNER", name="所有者项目", leader=actor)
    ProjectMember.objects.create(project=other, user=actor, role="manager")
    ProjectComponent.objects.create(project=other, repository=context.repository, component_code="shared")
    context.client.force_authenticate(actor)
    assert trigger(context).status_code == 404
    assert not PackageTask.objects.exists()


def test_unknown_or_invalid_config_ids_never_create_tasks(context: SimpleNamespace) -> None:
    for config_id in (str(uuid4()), "not-a-uuid"):
        response = trigger(context, config_id=config_id)
        assert response.status_code == 404, response.data
    assert not PackageTask.objects.exists()
    assert not context.dispatched


def test_superuser_keeps_existing_trigger_permission_without_membership(context: SimpleNamespace) -> None:
    user = User.objects.create_user(username="repackage_super", is_superuser=True)
    context.client.force_authenticate(user)
    response = trigger(context)
    assert response.status_code == 201, response.data
    assert PackageTask.objects.get().triggered_by == user


@pytest.mark.parametrize("change", ["config-project", "actor-role"])
def test_repackage_rechecks_current_project_permission_after_view_authorization(
    context: SimpleNamespace, monkeypatch: pytest.MonkeyPatch, change: str,
) -> None:
    """在对象验权和事务创建之间移动配置或降权，不能沿用旧项目授权。"""
    release = context.release
    if change == "config-project":
        other = Project.objects.create(code="RACE", name="只读项目", leader=context.users["manager"])
        ProjectMember.objects.create(project=other, user=context.users["developer"], role="maintainer")
        component = ProjectComponent.objects.create(
            project=other, repository=context.repository, component_code="shared",
        )
        release = ReleaseRecord.objects.create(
            project=other, repository=context.repository, publisher=context.users["manager"],
            status="released", version="V8.0.0", tag_name="V8.0.0", git_hash="b" * 40,
        )
    original_create = PackageService.create_task_for_release

    def change_after_authorization(
        config: PackageConfig, target_release: ReleaseRecord, request_user: User | None = None,
    ) -> PackageTask:
        if change == "config-project":
            PackageConfig.objects.filter(pk=config.pk).update(project_component=component)
        else:
            ProjectMember.objects.filter(project=context.project, user=request_user).update(role="maintainer")
        return original_create(config, target_release, request_user=request_user)

    monkeypatch.setattr(PackageService, "create_task_for_release", change_after_authorization)
    response = trigger(context, {"release_id": str(release.id)})
    assert response.status_code == 403, response.data
    assert not PackageTask.objects.exists()
    assert not context.dispatched
    assert OperationLog.objects.get(action="trigger_release").result == "failure"


@pytest.mark.parametrize("actor", ["missing", "viewer", "maintainer", "non-member"])
def test_manual_creation_service_requires_current_project_authorization(context: SimpleNamespace, actor: str) -> None:
    """直接调用服务也不能省略实际操作人或绕过当前项目补打权限。"""
    user = None if actor == "missing" else context.users.get(actor)
    if actor == "non-member":
        user = User.objects.create_user(username="unaffiliated_actor")
    with pytest.raises(PermissionDenied):
        PackageService.create_task_for_release(context.config, context.release, request_user=user)
    assert not PackageTask.objects.exists()
    assert not context.dispatched


def test_automatic_creation_keeps_existing_system_trigger_policy(context: SimpleNamespace) -> None:
    """自动打包仍由已完成发布驱动，不套用手动补打的操作人角色限制。"""
    task = PackageService.create_task_for_release(
        context.config, context.release, request_user=None, auto_triggered=True,
    )
    assert task.triggered_by is None
    assert task.config_snapshot["trigger_source"] == "auto_release"
    assert context.dispatched == [str(task.id)]


def test_snapshot_uses_current_saved_config_and_is_immutable_after_creation(context: SimpleNamespace) -> None:
    """重新读取当前配置，任务保存后配置改动不回写历史快照。"""
    PackageConfig.objects.filter(pk=context.config.pk).update(
        custom_script="echo current-script", env_vars={"BUILD_FLAG": "current-value"},
    )
    task = PackageService.create_task_for_release(context.config, context.release, context.users["developer"])
    PackageConfig.objects.filter(pk=context.config.pk).update(
        custom_script="echo future-script", env_vars={"BUILD_FLAG": "future-value"},
    )
    task.refresh_from_db()
    assert task.config_snapshot["custom_script"] == "echo current-script"
    assert task.config_snapshot["env_vars"] == {"BUILD_FLAG": "current-value"}


def test_dispatch_failure_marks_task_failed_and_returns_honest_error(
    context: SimpleNamespace, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Celery 和本地线程都不可用时不返回成功或遗留无投递的排队任务。"""
    def fail_dispatch(*args: object, **kwargs: object) -> None:
        raise RuntimeError("包含敏感连接信息的投递异常")

    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", fail_dispatch)
    monkeypatch.setattr(PackageService, "_start_local_worker", fail_dispatch)
    response = trigger(context)

    assert response.status_code == 503, response.data
    assert "敏感连接" not in str(response.data)
    task = PackageTask.objects.get()
    assert task.status == "failure"
    assert task.finished_at is not None
    assert response.data["data"]["task_id"] == str(task.id)
    assert response.data["data"]["status"] == "failure"
    log = OperationLog.objects.get(action="trigger_release")
    assert log.user == context.users["developer"]
    assert log.result == "failure"
    assert log.detail["task_id"] == str(task.id)
    assert log.detail["version"] == context.release.version


def test_successful_local_fallback_is_still_a_valid_dispatch(
    context: SimpleNamespace, monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_celery(task_id: str) -> None:
        raise ConnectionError("broker unavailable")

    local_tasks = []
    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", fail_celery)
    monkeypatch.setattr(PackageService, "_start_local_worker", lambda task_id, reason="": local_tasks.append(task_id))
    response = trigger(context)
    assert response.status_code == 201
    assert local_tasks == [response.data["data"]["id"]]
    assert OperationLog.objects.get(action="trigger_release").result == "success"


def test_rollback_neither_dispatches_nor_records_false_success(context: SimpleNamespace) -> None:
    """补打仍在事务提交后投递，回滚不会创建任务或成功审计。"""
    with transaction.atomic():
        PackageService.create_task_for_release(context.config, context.release, context.users["developer"])
        assert context.dispatched == []
        assert not OperationLog.objects.filter(action="trigger_release", result="success").exists()
        transaction.set_rollback(True)
    assert context.dispatched == []
    assert not PackageTask.objects.exists()
