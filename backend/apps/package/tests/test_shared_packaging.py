"""通过打包 API 验证共享配置和真实发起项目边界。"""

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.package.models import PackageConfig, PackageImage
from apps.project.models import Project, ProjectMember
from apps.project.services import ensure_repository_component
from apps.repository.models import Repository
from apps.software.models import ProjectSoftware, Software, SoftwareMaintainer


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def shared():
    owner = User.objects.create_user(username="shared-owner")
    admin = User.objects.create_user(username="shared-admin")
    collaborator = User.objects.create_user(username="shared-collaborator")
    reader = User.objects.create_user(username="shared-reader")
    repository = Repository.objects.create(
        name="共享仓库", repo_type="git", vendor="gitlab", url="https://gitlab.example.test",
        external_identity="test/shared", created_by=owner,
    )
    software = Software.objects.create(repository=repository, owner=owner, slug="client", name="客户端")
    SoftwareMaintainer.objects.create(software=software, user=collaborator, granted_by=owner)
    projects = [
        Project.objects.create(code=code, name=code, status=1)
        for code in ("SHARED-A", "SHARED-B", "SHARED-C")
    ]
    for project in projects:
        ProjectMember.objects.create(project=project, user=owner, role="developer")
        ProjectMember.objects.create(project=project, user=admin, role="software_admin")
        ensure_repository_component(repository, project)
    ProjectMember.objects.create(project=projects[1], user=reader, role="maintainer")
    for project in projects[:2]:
        ProjectSoftware.objects.create(project=project, software=software)
    image = PackageImage.objects.create(name="共享镜像", image="trace-ship/shared:latest")
    return owner, admin, collaborator, reader, software, projects, image


def create_shared_config(user, software, image, **extra):
    return client_for(user).post(
        "/api/packages/configs/",
        {
            "software": str(software.pk), "name": "共享构建", "image": str(image.pk),
            "env_vars": {"BUILD_OPTION": "saved"}, **extra,
        },
        format="json",
    )


@pytest.mark.django_db
def test_explicit_software_maintenance_and_project_config_use(shared):
    owner, admin, collaborator, reader, software, (a, b, c), image = shared
    denied = create_shared_config(admin, software, image)
    assert denied.status_code == 403
    for project in (a, c):
        component = project.project_components.get(repository=software.repository)
        legacy = client_for(admin).post("/api/packages/configs/", {
            "project_component": str(component.pk), "name": "兼容配置", "image": str(image.pk),
        }, format="json")
        assert legacy.status_code == 400, legacy.data

    created = create_shared_config(collaborator, software, image)
    assert created.status_code == 200, created.data
    data = created.data["data"]
    assert str(data["software"]) == str(software.pk)
    assert data["project_component"] is None
    assert data["can_maintain"] is True
    config_url = f"/api/packages/configs/{data['id']}/"

    for project in (a, b, c):
        listed = client_for(admin).get("/api/packages/configs/", {
            "project": str(project.pk), "software": str(software.pk),
        })
        assert listed.status_code == 200
        results = listed.data["data"]["results"]
        assert [str(item["id"]) for item in results] == ([str(data["id"])] if project != c else [])
        if results:
            assert results[0]["can_maintain"] is False
            assert "env_vars" not in results[0]
    assert client_for(admin).patch(config_url, {"name": "改名"}, format="json").status_code == 403
    assert client_for(reader).post(
        f"{config_url}favorite/", {"project": str(b.pk)}, format="json",
    ).status_code == 403
    assert client_for(admin).post(
        f"{config_url}favorite/", {"project": str(b.pk)}, format="json",
    ).data["data"]["is_favorite"]
    assert client_for(admin).get(f"{config_url}svn-entries/").status_code == 403

    software.maintainer_grants.filter(user=collaborator).delete()
    assert client_for(collaborator).patch(config_url, {"name": "已撤销"}, format="json").status_code in (403, 404)
    assert client_for(owner).patch(config_url, {"name": "负责人修改"}, format="json").status_code == 200


@pytest.mark.django_db
def test_legacy_config_keeps_its_original_component_when_edited(shared):
    _, admin, _, _, software, (a, _, c), image = shared
    old_component = a.project_components.get(repository=software.repository)
    old = PackageConfig.objects.create(project_component=old_component, name="待归属配置", image=image)
    client = client_for(admin)
    url = f"/api/packages/configs/{old.pk}/"
    assert client.patch(url, {"name": "更新配置参数"}, format="json").status_code == 200
    assert client.patch(url, {"software": str(software.pk)}, format="json").status_code == 400
    other = c.project_components.get(repository=software.repository)
    assert client.patch(url, {"project_component": str(other.pk)}, format="json").status_code == 400
    detail = client.get(url).data["data"]
    assert detail["software"] is None
    assert str(detail["project_component"]) == str(old_component.pk)
    assert detail["name"] == "更新配置参数"


@pytest.mark.django_db
def test_shared_branch_task_keeps_its_project_and_software_snapshot(shared, monkeypatch, django_capture_on_commit_callbacks):
    from types import SimpleNamespace

    from apps.credential.models import Credential
    from apps.package.services import PackageService

    owner, admin, collaborator, reader, software, (a, b, c), image = shared
    credential = Credential.objects.create(name="分支凭证", cred_type="gitlab_token", owner=owner)
    credential.set_data({"token": "fixture-token"})
    credential.save()
    software.repository.credential = credential
    software.repository.save(update_fields=["credential"])
    provider = SimpleNamespace(
        get_branch=lambda identity, branch: SimpleNamespace(name=branch, last_commit_hash="a" * 40)
    )
    monkeypatch.setattr("apps.package.services.tasks.get_provider", lambda *args: provider)
    dispatched = []
    monkeypatch.setattr(PackageService, "dispatch_task", classmethod(lambda cls, task: dispatched.append(task.pk)))

    config = create_shared_config(collaborator, software, image).data["data"]
    base = f"/api/packages/configs/{config['id']}/"
    payload = {"project": str(b.pk), "software": str(software.pk), "branch": "feature/demo"}
    for invalid in ({**payload, "project": str(c.pk)}, {**payload, "software": None}, {"branch": "main"}):
        assert client_for(admin).post(f"{base}trigger-branch/", invalid, format="json").status_code == 400
    assert client_for(reader).post(f"{base}trigger-branch/", payload, format="json").status_code == 403

    with django_capture_on_commit_callbacks(execute=True):
        created = client_for(admin).post(f"{base}trigger-branch/", payload, format="json")
    assert created.status_code == 201, created.data
    task = created.data["data"]
    assert [str(pk) for pk in dispatched] == [str(task["id"])]
    assert str(task["project"]) == str(b.pk)
    assert str(task["triggered_by"]) == str(admin.pk)
    assert str(task["software"]) == str(software.pk)
    assert task["release"] is None
    assert task["source_ref"] == "feature/demo"
    assert task["commit_hash"] == "a" * 40

    assert client_for(collaborator).patch(base, {"name": "新配置名称"}, format="json").status_code == 200
    software.name = "新软件名称"
    software.save(update_fields=["name"])
    task_url = f"/api/packages/tasks/{task['id']}/"
    detail = client_for(reader).get(task_url)
    assert detail.status_code == 200
    assert detail.data["data"]["software_name"] == "客户端"
    assert detail.data["data"]["config_name"] == "共享构建"
    assert "env_vars" not in detail.data["data"]["config_snapshot"]
    assert client_for(reader).get(f"{task_url}logs/").status_code == 403
    assert client_for(collaborator).get(task_url).status_code == 404

    with django_capture_on_commit_callbacks(execute=True):
        other_task = client_for(admin).post(f"{base}trigger-branch/", {
            **payload, "project": str(a.pk),
        }, format="json")
    assert other_task.status_code == 201
    other_id = other_task.data["data"]["id"]
    other_task_url = f"/api/packages/tasks/{other_id}/"
    member = client_for(reader)
    for suffix in ("", "logs/?tail=4096", "svn-artifacts/", "download-all/"):
        result = member.get(other_task_url + suffix)
        assert result.status_code == 404
    listed_tasks = member.get(f"/api/packages/tasks/?config={config['id']}").data["data"]
    assert [item["id"] for item in listed_tasks["results"]] == [task["id"]]

    admin_client = client_for(admin)
    assert admin_client.post(f"{base}favorite/", {"project": str(b.pk)}, format="json").status_code == 200
    favorites = admin_client.get(f"/api/packages/configs/favorites/?project={b.pk}").data["data"]
    assert favorites[0]["last_task"]["id"] == str(task["id"])


@pytest.mark.django_db
def test_config_confirmation_is_explicit_idempotent_and_preserves_history(shared, tmp_path):
    import io
    import json

    from django.core.management import call_command
    from django.core.management.base import CommandError

    from apps.package.models import PackageConfig, PackageTask
    from apps.release.models import ReleaseRecord

    owner, admin, _, _, software, (a, b, _), image = shared
    root = User.objects.create_superuser(username="config-auditor")
    component = a.project_components.get(repository=software.repository)
    first = PackageConfig.objects.create(
        project_component=component, image=image, name="同名配置", custom_script="echo first",
        env_vars={"MODE": "first"}, svn_url="https://username:secret@svn.example.test/first?token=hidden",
    )
    other = PackageConfig.objects.create(
        project_component=component, image=image, name="同名配置", custom_script="echo second",
        env_vars={"MODE": "second"}, svn_url="https://svn.example.test/second",
    )
    snapshot = {"name": first.name, "env_vars": {"MODE": "historical"}}
    task = PackageTask.objects.create(
        config=first, repository=software.repository, project=a, name="历史任务", tag_name="main",
        version="main", triggered_by=owner, config_snapshot=snapshot,
    )
    mapping = tmp_path / "mapping.json"
    valid = {
        "config": str(first.pk), "software": str(software.pk),
        "projects": [str(a.pk), str(b.pk)], "basis": "已核对两项目共享范围及脚本用途",
    }
    mapping.write_text(json.dumps([valid]), encoding="utf-8")

    def inventory(*, apply=False):
        output = io.StringIO()
        call_command("reconcile_package_configs", mapping=mapping, actor=root.username, apply=apply, stdout=output)
        return json.loads(output.getvalue())

    preview = inventory()
    rows = {row["config"]: row for row in preview["configurations"]}
    assert preview["confirmations"][0]["status"] == "ready"
    assert rows[str(first.pk)]["svn_target"] == "https://svn.example.test/first"
    assert rows[str(other.pk)]["svn_target"] == "https://svn.example.test/second"
    assert client_for(admin).get("/api/packages/configs/", {
        "project": str(b.pk), "software": str(software.pk),
    }).data["data"]["results"] == []

    mapping.write_text(json.dumps([valid, {**valid, "config": str(other.pk), "projects": [str(b.pk)]}]), encoding="utf-8")
    with pytest.raises(CommandError):
        inventory(apply=True)
    assert client_for(admin).get("/api/packages/configs/", {
        "project": str(b.pk), "software": str(software.pk),
    }).data["data"]["results"] == []

    mapping.write_text(json.dumps([valid]), encoding="utf-8")
    release = ReleaseRecord.objects.create(
        project=a, repository=software.repository, publisher=owner, version="V1.0.0",
        tag_name="V1.0.0", release_type="formal", status="draft", package_config_ids=[str(first.pk)],
    )
    blocked = io.StringIO()
    with pytest.raises(CommandError):
        call_command("reconcile_package_configs", mapping=mapping, actor=root.username, apply=True, stdout=blocked)
    assert str(release.pk) in json.loads(blocked.getvalue())["confirmations"][0]["reason"]
    release.status = "released"
    release.save(update_fields=["status"])

    report = inventory(apply=True)
    repeated = inventory(apply=True)
    assert repeated == report
    evidence = next(row["confirmation"] for row in report["configurations"] if row["config"] == str(first.pk))
    assert evidence["confirmed_by"] == root.username
    assert evidence["basis"] == valid["basis"]
    assert evidence["confirmed_at"]

    listed = client_for(admin).get("/api/packages/configs/", {"project": str(b.pk), "software": str(software.pk)})
    assert [item["id"] for item in listed.data["data"]["results"]] == [str(first.pk)]
    detail = client_for(admin).get(f"/api/packages/tasks/{task.pk}/").data["data"]
    assert str(detail["project"]) == str(a.pk)
    assert detail["software"] is None
    assert detail["config_snapshot"] == snapshot


@pytest.mark.django_db
def test_shared_svn_test_needs_software_maintenance_and_usable_project(shared, monkeypatch):
    from types import SimpleNamespace

    from apps.credential.models import Credential

    owner, admin, collaborator, reader, software, (_, project, _), _ = shared
    credential = Credential.objects.create(name="SVN 测试", cred_type="svn_password", owner=owner)
    credential.set_data({"username": "isolated", "password": "fixture"})
    credential.save()
    paths = []

    def list_dir(path):
        paths.append(path)
        return [{"name": "另一项目制品", "kind": "file"}]

    monkeypatch.setattr("apps.package.views.get_provider", lambda *args: SimpleNamespace(list_dir=list_dir))
    url = "/api/packages/configs/test-svn/"
    inputs = {
        "project_id": str(project.pk), "software": str(software.pk), "svn_credential_id": str(credential.pk),
        "svn_url": "https://svn.example.test/shared",
    }
    assert client_for(admin).post(url, inputs, format="json").status_code == 403
    assert client_for(reader).post(url, inputs, format="json").status_code == 403
    assert client_for(collaborator).post(url, inputs, format="json").status_code == 404
    assert client_for(owner).post(url, {**inputs, "project_id": None}, format="json").status_code == 400
    assert paths == []
    result = client_for(owner).post(url, inputs, format="json")
    assert result.status_code == 200, result.data
    assert result.data["data"]["entries"] == []
    assert paths == [inputs["svn_url"]]


@pytest.mark.django_db
def test_shared_branch_build_keeps_saved_head(shared, monkeypatch, settings, tmp_path, django_capture_on_commit_callbacks):
    import subprocess
    import sys
    from pathlib import Path
    from types import SimpleNamespace

    from apps.credential.models import Credential
    from apps.package.models import PackageTask
    from apps.package.services import PackageService

    owner, admin, _, _, software, (_, project, _), image = shared
    repo_dir = tmp_path / "fixture.git"
    repo_dir.mkdir()

    def git(*args):
        return subprocess.check_output(
            ["git", "-C", str(repo_dir), *args], stderr=subprocess.STDOUT, text=True,
        ).strip()

    git("init", "-b", "main")
    git("config", "user.email", "case@example.test")
    git("config", "user.name", "隔离测试")
    (repo_dir / "build-version.txt").write_text("准备时的源码")
    git("add", ".")
    git("commit", "-m", "固定源码")
    head = git("rev-parse", "HEAD")
    credential = Credential.objects.create(name="分支执行凭证", cred_type="gitlab_token", owner=owner)
    credential.set_data({"token": "fixture"})
    credential.save()
    repository = software.repository
    repository.credential = credential
    repository.url = repo_dir.as_uri()
    repository.save(update_fields=["credential", "url"])
    settings.PACKAGE_WORKSPACE_ROOT = str(tmp_path / "workspace")

    provider = SimpleNamespace(get_branch=lambda _, name: SimpleNamespace(name=name, last_commit_hash=head))
    monkeypatch.setattr("apps.package.services.tasks.get_provider", lambda *args: provider)
    to_build = []
    monkeypatch.setattr("apps.package.tasks.run_package_task.delay", to_build.append)

    popen = subprocess.Popen

    def run_command(command, *args, **kwargs):
        if command[0] == "docker":
            workspace = Path(kwargs["cwd"])
            output = (workspace / "source" / "build-version.txt").read_bytes()
            (workspace / "artifacts" / "result.txt").write_bytes(output)
            command = [sys.executable, "-c", "print('容器构建输出')"]
        return popen(command, *args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", run_command)
    script = "echo 样本配置脚本"
    config = create_shared_config(owner, software, image, custom_script=script).data["data"]
    trigger = f"/api/packages/configs/{config['id']}/trigger-branch/"
    client = client_for(admin)
    inputs = {"project": str(project.pk), "software": str(software.pk), "branch": "main"}
    with django_capture_on_commit_callbacks(execute=True):
        recorded = client.post(trigger, inputs, format="json")
    assert recorded.status_code == 201, recorded.data
    task_id = to_build.pop()
    PackageService.run_task(PackageTask.objects.get(pk=task_id))
    url = f"/api/packages/tasks/{task_id}/"
    data = client.get(url).data["data"]
    assert data["status"] == "success"
    assert data["commit_hash"] == head
    assert [item["name"] for item in data["artifact_info"]] == ["result.txt"]
    log = client.get(f"{url}logs/?tail=4096").data["data"]["content"]
    assert "打包完成" in log
    assert "容器构建输出" in log
    assert script not in log

    with django_capture_on_commit_callbacks(execute=True):
        recorded = client.post(trigger, inputs, format="json")
    assert recorded.status_code == 201, recorded.data
    (repo_dir / "build-version.txt").write_text("后来变动的源码")
    git("commit", "-am", "移动分支")
    task_id = to_build.pop()
    PackageService.run_task(PackageTask.objects.get(pk=task_id))
    rejected = client.get(f"/api/packages/tasks/{task_id}/").data["data"]
    assert rejected["status"] == "failure"
    assert rejected["commit_hash"] == head
    assert not rejected["artifact_info"]
    assert "分支快照不一致" in rejected["error_message"]
