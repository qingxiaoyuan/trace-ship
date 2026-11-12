"""生产生成说明加人工保存内容的 OA 归档样本，供所有真实浏览器场景复用。"""
import hashlib
import json
import uuid


def create_oa_sample(runtime, password):
    from django.utils import timezone

    from apps.account.models import User
    from apps.credential.models import Credential
    from apps.package.models import PackageConfig, PackageTask
    from apps.package.services import PackageService
    from apps.project.models import Project, ProjectComponent, ProjectMember
    from apps.release.models import ReleaseRecord
    from apps.release.services import ReleaseDocGenerator
    from apps.repository.models import Repository

    external = json.loads((runtime / "external.json").read_text(encoding="utf-8"))
    owner = User.objects.create_superuser(username="smoke_oa", password=password, nickname="归档实际操作人")
    project = Project.objects.create(name="OA 隔离归档项目", code="OA-SMOKE", leader=owner, status=1)
    ProjectMember.objects.create(project=project, user=owner, role="manager")
    maintainer = User.objects.create_user(username="smoke_oa_maintainer", password=password, nickname="归档只读维保")
    ProjectMember.objects.create(project=project, user=maintainer, role="maintainer")
    repository = Repository.objects.create(
        name="归档物理仓库", repo_type="git", vendor="gitlab",
        url="https://example.invalid/oa/software.git", external_identity="oa/software", created_by=owner,
    )
    component = ProjectComponent.objects.create(
        project=project, repository=repository, component_code="oa-software", display_name="项目内归档软件名称",
    )
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=owner, version="VA.88.1.0", tag_name="VA.88.1.0_oa",
        branch="main", release_type="formal", status="released", released_at=timezone.now(),
        git_hash="8" * 40, updates=[{"type": "A", "content": "过时的结构化内容不得用于归档预填"}],
    )
    generated = ReleaseDocGenerator._build_markdown_doc(release)
    changes = (
        "人工保存首行：支持 A | B\n<br>**归档重点**与[说明链接](https://example.invalid/oa/help)\n"
        "    缩进配置说明\n\n"
        + "\n".join(f"人工保存第 {index:03d} 行：完整保留多行更新内容与中文字段。" for index in range(1, 61))
        + "\n人工保存长文末尾：不能截断到列表摘要。"
    )
    release.release_doc = generated.replace("A 过时的结构化内容不得用于归档预填", changes.replace("|", "\\|"))
    release.save(update_fields=["release_doc"])
    credential = Credential.objects.create(
        name="本次隔离 SVN 凭证", owner=owner, cred_type="svn_password", auth_mode="password",
    )
    credential.set_data({"username": external["svn"]["username"], "password": external["svn"]["password"]})
    credential.save()
    config = PackageConfig.objects.create(
        project_component=component, name="归档隔离打包配置", is_active=True,
        svn_push_enabled=True, svn_url=external["svn"]["url"], svn_credential=credential,
    )
    tasks = {}
    for key in ("first", "history", "supplement"):
        workspace = runtime / "workspaces" / f"oa-{key}"
        artifacts = workspace / "artifacts"
        artifacts.mkdir(parents=True)
        manifest = []
        for relative in external["svn"]["files"]:
            if not relative.startswith(f"{key}/") or relative.endswith(".md"):
                continue
            filename = relative.removeprefix(f"{key}/")
            content = ("首次归档产物\n" if filename.startswith("目录") and key == "first"
                       else f"{filename.removesuffix('.zip')} 场景产物\n").encode()
            target = artifacts / filename
            if key == "first":
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content)
            if key != "supplement":
                manifest.append({
                    "id": str(uuid.uuid4()), "name": target.name, "path": filename,
                    "size": len(content) if key == "first" else None,
                    "sha256": hashlib.sha256(content).hexdigest() if key == "first" else None,
                })
        task = PackageTask.objects.create(
            project=project, repository=repository, release=release, config=config,
            name={"first": "首次归档成功任务", "history": "保留清单的历史任务", "supplement": "无清单 SVN 补录任务"}[key],
            status="success", triggered_by=owner, version=release.version, tag_name=release.tag_name,
            release_type="formal", commit_hash=release.git_hash, workspace_path=str(workspace), artifact_info=manifest,
            config_snapshot={**PackageService._snapshot(config), "id": str(config.id), "name": config.name},
            stage_info={"svn_push": {"status": "success", "remote_url": f"{external['svn']['url']}/{key}"}},
        )
        PackageTask.objects.filter(id=task.id).update(started_at=timezone.now(), finished_at=timezone.now())
        tasks[key] = {"id": str(task.id), "name": task.name, "artifacts": manifest,
                      "root_url": f"{external['svn']['url']}/{key}"}
    return {
        "username": owner.username, "maintainer_username": maintainer.username, "actor_id": str(owner.id), "actor_name": owner.nickname,
        "release_id": str(release.id), "version": release.version, "git_hash": release.git_hash,
        "software_name": component.display_name, "changes": changes, "release_doc": release.release_doc,
        "document_source": "ReleaseDocGenerator._build_markdown_doc 原始两列表格；人工编辑后保存完整变更内容，保留旧 updates 对照",
        "oa_url": external["oa_url"], "control_url": external["control_url"], "tasks": tasks,
    }
