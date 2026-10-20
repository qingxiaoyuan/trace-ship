"""真实浏览器冒烟的隔离数据与服务；不读取开发数据库，不执行打包。"""

import argparse
import hashlib
import json
import os
import secrets
import sys
import uuid
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    runtime = args.runtime.resolve(strict=True)
    if not (runtime / ".browser-smoke").is_file():
        raise RuntimeError("只允许使用入口创建的独立冒烟目录")
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
    os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings.test"
    from django.conf import settings

    settings.DATABASES["default"]["NAME"] = str(runtime / "browser.sqlite3")
    settings.SECRET_KEY = secrets.token_urlsafe(48)
    settings.ALLOWED_HOSTS = ["127.0.0.1"]
    settings.PACKAGE_WORKSPACE_ROOT = str(runtime / "workspaces")
    settings.MEDIA_ROOT = str(runtime / "media")
    settings.ROOT_URLCONF = __name__
    import django

    django.setup()
    from django.core.management import call_command
    from django.http import JsonResponse
    from django.urls import include, path
    from django.utils import timezone

    from apps.account.models import User
    from apps.package.models import PackageConfig, PackageTask
    from apps.project.models import Project, ProjectComponent, ProjectMember
    from apps.release.models import ReleaseRecord
    from apps.repository.models import Repository

    # 随机握手标识保证入口不会误用某个既有业务服务。
    global urlpatterns
    urlpatterns = [
        path(
            "__browser_smoke__/" + os.environ["SMOKE_RUN_ID"],
            lambda request: JsonResponse({"run": os.environ["SMOKE_RUN_ID"]}),
        ),
        path("", include("config.urls")),
    ]
    call_command("migrate", verbosity=0)
    password = secrets.token_urlsafe(24)
    owner = User.objects.create_user(username="smoke_owner", password=password, nickname="冒烟管理员")
    reader = User.objects.create_user(username="smoke_maintainer", password=password, nickname="冒烟维保")
    project = Project.objects.create(name="隔离冒烟项目", code="SMOKE", leader=owner, status=1)
    ProjectMember.objects.create(project=project, user=owner, role="manager")
    ProjectMember.objects.create(project=project, user=reader, role="maintainer")
    repository = Repository.objects.create(
        name="虚构交付仓库",
        repo_type="git",
        vendor="gitlab",
        url="https://example.invalid/smoke/software.git",
        external_identity="smoke/software",
        created_by=owner,
        default_branch="main",
    )
    component = ProjectComponent.objects.create(
        project=project, repository=repository, component_code="software", display_name="冒烟软件"
    )
    release = ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        publisher=owner,
        version="VA.39.1.0",
        tag_name="VA.39.1.0_smoke",
        branch="main",
        release_type="formal",
        status="released",
        released_at=timezone.now(),
        release_doc="仅用于隔离验收的虚构发布。",
    )
    manifest = {"username": reader.username, "password": password, "tasks": {}}
    for key, status, name in [
        ("success", "success", "万行中文日志任务"),
        ("running", "running", "中文增量日志任务"),
        ("expired", "success", "过期产物任务"),
        ("nolog", "failure", "终态日志缺失任务"),
    ]:
        config = PackageConfig.objects.create(project_component=component, name=name + "配置", is_active=True)
        workspace = runtime / "workspaces" / key
        artifacts = workspace / "artifacts"
        artifacts.mkdir(parents=True)
        log = workspace / "build.log"
        if key == "success":
            content = (
                "任务开始：隔离冒烟\r\n"
                + "".join(f"构建日志第 {line:05d} 行：中文校验通过\r\n" for line in range(1, 10001))
                + "任务结束：万行日志末尾完整\r\n"
            )
            log.write_bytes(content.encode("utf-8"))
        elif key == "running":
            log.write_bytes("增量验收：初始日志\r\n".encode())
        elif key != "nolog":
            log.write_bytes("任务结束：产物保留期已过\r\n".encode())
        artifact_info = []
        if key == "success":
            for filename, content in [
                ("中文交付说明.txt", "冒烟软件 VA.39.1.0\r\n中文产物完整可读\r\n"),
                ("nested/build-info.json", '{"version":"VA.39.1.0","verified":true}\n'),
            ]:
                target = artifacts / filename
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(content.encode("utf-8"))
                artifact_info.append(
                    {"id": str(uuid.uuid4()), "name": target.name, "path": filename, "size": target.stat().st_size}
                )
        elif key == "expired":
            artifact_info = [{"id": str(uuid.uuid4()), "name": "过期交付包.zip", "path": "expired.zip", "size": 1024}]
        task = PackageTask.objects.create(
            project=project,
            repository=repository,
            release=release,
            config=config,
            name=name,
            status=status,
            triggered_by=owner,
            version=release.version,
            tag_name=release.tag_name,
            release_type="formal",
            workspace_path=str(workspace),
            log_path=str(log),
            artifact_info=artifact_info,
            config_snapshot={
                "id": str(config.id),
                "name": config.name,
                "trigger_source": "auto_release",
                "project_component_id": str(component.id),
            },
        )
        PackageTask.objects.filter(id=task.id).update(
            started_at=timezone.now(), finished_at=None if key == "running" else timezone.now()
        )
        manifest["tasks"][key] = {
            "id": str(task.id),
            "name": name,
            "log": str(log),
            "artifacts": artifact_info,
            "sha256": hashlib.sha256(log.read_bytes()).hexdigest() if log.exists() else None,
        }
    manifest_path = runtime / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    if os.name != "nt":
        manifest_path.chmod(0o600)
    print("隔离浏览器样本已准备；未连接真实数据库、仓库或构建服务。", flush=True)
    call_command("runserver", f"127.0.0.1:{args.port}", use_reloader=False)


if __name__ == "__main__":
    main()
