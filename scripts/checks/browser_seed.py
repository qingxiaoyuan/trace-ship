"""真实浏览器冒烟的隔离数据与服务；不读取开发数据库，不执行打包。"""

import argparse
import hashlib
import json
import os
import secrets
import sys
import uuid
from datetime import timedelta
from pathlib import Path

from backend import git_value


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
    from apps.credential.models import Credential
    from apps.package.models import PackageConfig, PackageTask
    from apps.package.services import PackageService
    from apps.project.models import Project, ProjectComponent, ProjectMember
    from apps.release.models import ReleaseRecord
    from apps.release.services import ReleaseDocGenerator, ReleaseService
    from apps.repository.models import Repository, RepositoryBranch
    from apps.workflow.models import WorkflowDefinition
    from utils.provider.base import CommitInfo, TagInfo

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
    project = Project.objects.create(name="隔离冒烟项目_用于手机窄屏完整阅读的超长项目名称", code="SMOKE", leader=owner, status=1)
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
        project=project, repository=repository, component_code="software", display_name="冒烟软件_用于手机树形筛选的超长软件名称"
    )
    RepositoryBranch.objects.create(
        repository=repository, name="main", is_default=True, last_commit_hash="a" * 40,
        last_commit_at=timezone.now(),
    )
    WorkflowDefinition.objects.create(
        repository=repository, project=project, name="冒烟正式发布流程", release_type="formal",
        node_config=[{
            "node_id": f"approval_{index}", "node_name": f"第 {index} 轮审批", "mode": "any",
            "approvers": [{"type": "user", "user_id": str(owner.id)}],
        } for index in range(1, 4)],
    )
    manual_additions = (
        "# 手机完整阅读验收\n\n表格外首段：在生产生成说明后追加的合法手动编辑边界样本。\n\n"
        "| 项目 | 内容 |\n| --- | --- |\n"
        "| 软件名称 | 冒烟软件 \\| 多模块 |\n"
        "| 更新说明 | 第一行<br>**重要更新**与[安全链接](https://example.invalid/help) |\n"
        "| 额外字段 | 原始额外字段必须保留 |\n\n"
        "<br>**换行后强调**\n\n"
        "`<br><script>字面代码</script>`\n\n"
        "```html\n<br><img src=x onerror=alert(1)>\n```\n\n"
        "[危险链接](javascript:alert(1))\n<script>window.smokeUnsafe=true</script>\n"
        "<img src=x onerror=alert(1)>\n\n"
        "| 长字段一 | 长字段二 | 长字段三 | 长字段四 |\n| --- | --- | --- | --- |\n"
        "| " + "甲" * 70 + " | " + "乙" * 70 + " | " + "丙" * 70 + " | 表格末列完整 |\n\n"
        + "\n\n".join(f"阅读段落{line:02d}：" + "本段验证长文档信息完整与底部导航安全留白。" * 5 for line in range(1, 21))
        + "\n\n长文档结尾：全部发布说明完整可读。\n\n"
        "[mr]: https://example.invalid/mr/44 \"关联说明\"\n\n"
        "[^config]: 配置脚注定义不应吞掉字段内的缩进代码\n\n"
        "<br>\n```text\n末尾代码示例"
    )
    generated_fields = {
        "updates": [{"type": "A", "content": "支持 A | B"}, {"type": "F", "content": "修复终端故障"}],
        "has_config_changes": True,
        "config_change_doc": (
            "    smoke_config --check\n    smoke_config --verify\n\n[配置引用][mr]\n\n"
            "```text\n配置代码示例\n```"
        ),
        "related_changes": [{"key": "依赖软件", "value": "runtime | stable"}],
        "impact_other": True, "impact_desc": "\n**首尾空行说明**\n\n<br>\n[关联 MR][mr]\n",
        "self_test_passed": True, "retest_passed": True,
    }
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
        git_hash="1" * 40,
        **generated_fields,
    )
    reading_releases = [release]
    for number in range(2, 15):
        reading_releases.append(ReleaseRecord.objects.create(
            project=project, repository=repository, publisher=owner,
            version=f"VA.39.1.{number}", tag_name=f"VA.39.1.{number}_smoke",
            branch="main", release_type="formal", status="released", git_hash="1" * 40,
            released_at=timezone.now() - timedelta(minutes=number), **generated_fields,
        ))
    generated_documents = []
    for item in reading_releases:
        # 保留业务生成器原始输出，再追加合法手动编辑内容，不预处理物理续行或转义。
        generated = ReleaseDocGenerator._build_markdown_doc(item)
        item.release_doc = generated + "\n\n" + manual_additions
        item.save(update_fields=["release_doc"])
        generated_documents.append({
            "release_id": str(item.id), "version": item.version, "tag_name": item.tag_name,
            "git_hash": item.git_hash, "publisher": item.publisher.nickname,
            "fields": generated_fields, "markdown": generated,
            "sha256": hashlib.sha256(generated.encode("utf-8")).hexdigest(),
        })
    # 只替换外部任务投递边界；HTTP、权限、任务创建与操作日志均运行生产实现。
    # 隔离样本使用 example.invalid，入口绝不执行真实构建或访问远端仓库。
    dispatch_receipts = runtime / "dispatch.jsonl"

    def record_dispatch(task: PackageTask) -> None:
        with dispatch_receipts.open("a", encoding="utf-8") as receipt:
            receipt.write(json.dumps({"task_id": str(task.id)}) + "\n")

    PackageService.dispatch_task = staticmethod(record_dispatch)

    class SampleRepository:
        """固定远端 Tag / 提交样本，发布与审批业务仍走生产实现。"""

        def list_tags(self, repo_identity: str) -> list[TagInfo]:
            if repo_identity != repository.external_identity:
                raise RuntimeError("冒烟样本禁止查询其他仓库")
            return [TagInfo(name=item.tag_name, commit_hash=item.git_hash) for item in reading_releases]

        def get_branch(self, repo_identity: str, branch_name: str):
            from utils.provider.base import BranchInfo

            if repo_identity != repository.external_identity or branch_name != "main":
                raise RuntimeError("冒烟样本禁止查询其他分支")
            return BranchInfo(name="main", last_commit_hash="a" * 40)

        def list_release_commits(self, repo_identity: str, base: str, head: str) -> list[CommitInfo]:
            if base not in ("", "1" * 40) or head != "a" * 40:
                raise RuntimeError("冒烟样本禁止查询其他提交区间")
            return self.list_commits(repo_identity, "main")

        def list_release_merge_requests(self, repo_identity: str) -> list:
            if repo_identity != repository.external_identity:
                raise RuntimeError("冒烟样本禁止查询其他仓库")
            return []

        def list_commits(self, repo_identity: str, branch: str, **kwargs) -> list[CommitInfo]:
            if repo_identity != repository.external_identity or branch != "main":
                raise RuntimeError("冒烟样本禁止查询其他分支")
            return [CommitInfo(hash="a" * 40, author="冒烟管理员", author_email="isolated@example.invalid",
                               message="更新内容：\n1. A 正式版分支发布冒烟", committed_at=timezone.now())]

        def compare_commits(self, repo_identity: str, base: str, head: str) -> list[CommitInfo]:
            return self.list_commits(repo_identity, head)

        def list_merge_requests(self, *args, **kwargs) -> list:
            return []

        def get_merge_base(self, repo_identity: str, refs: list[str]) -> str:
            return refs[0]

    ReleaseService._get_provider = staticmethod(lambda *_args, **_kwargs: SampleRepository())
    svn_credential = Credential.objects.create(
        name="冒烟虚构 SVN 凭证", owner=owner, cred_type="svn_password", auth_mode="password",
    )
    svn_credential.set_data({"username": "isolated", "password": secrets.token_urlsafe(24)})
    svn_credential.save()
    repackage_config = PackageConfig.objects.create(
        project_component=component, name="已发布版本补打配置", is_active=True,
        custom_script="exit 27", env_vars={"FIXED_SAMPLE": "configured"},
        svn_push_enabled=True, svn_url="https://example.invalid/smoke/artifacts",
        svn_push_rc=True, svn_push_beta=True, svn_credential=svn_credential,
    )
    PackageConfig.objects.create(project_component=component, name="已停用配置不得选择", is_active=False)
    other_project = Project.objects.create(name="隔离的共享仓库项目", code="SMOKE-OTHER", leader=owner, status=1)
    ProjectMember.objects.create(project=other_project, user=owner, role="manager")
    other_component = ProjectComponent.objects.create(
        project=other_project, repository=repository, component_code="shared", display_name="隔离软件"
    )
    PackageConfig.objects.create(project_component=other_component, name="其他项目配置不得选择", is_active=True)
    manifest = {
        "username": reader.username, "password": password,
        "operator": {"username": owner.username, "role": "manager", "id": str(owner.id)}, "tasks": {},
        "release_flow": {"project_id": str(project.id), "repository_name": repository.name,
                         "branch": "main", "git_hash": "a" * 40},
        "reading": {"project_id": str(project.id), "project_name": project.name,
                    "repository_id": str(repository.id), "software_name": component.display_name,
                    "release_ids": [str(item.id) for item in reading_releases],
                    "document_source": {
                        "method": "apps.release.services.ReleaseDocGenerator._build_markdown_doc",
                        "file": "backend/apps/release/services.py", "commit": git_value("rev-parse", "HEAD"),
                        "mode": "真实生成器原始输出 + 合法手动编辑追加；未调用完整 generate 流程",
                        "documents": generated_documents,
                    }},
        "repackage": {
            "release_id": str(release.id), "config_id": str(repackage_config.id),
            "config_name": repackage_config.name, "project_id": str(project.id),
            "repository_id": str(repository.id), "actor_id": str(owner.id),
            "version": release.version, "tag_name": release.tag_name,
            "commit_hash": release.git_hash, "dispatch_receipts": str(dispatch_receipts),
        },
    }
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
