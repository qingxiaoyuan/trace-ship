"""隔离真实打包验收的 Linux 执行端；生产业务实现不打补丁。"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import platform
import secrets
import shutil
import subprocess
import sys
import threading
import traceback
import zipfile
from datetime import UTC, datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit
from wsgiref.simple_server import WSGIRequestHandler, make_server

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "scripts" / "checks" / "fixtures" / "package-real"
REPORT = Path("/reports")


def write_json(path: Path, value: object) -> None:
    """只保存脱敏证据，不保存数据库、密码和令牌。"""
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def command(args: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> str:
    """命令失败保留真实错误；调用方仅传入不含凭据的参数。"""
    return subprocess.check_output(args, cwd=cwd, env=env, text=True, encoding="utf-8", stderr=subprocess.STDOUT).strip()


def prepare_git(runtime: Path) -> tuple[Path, str, str]:
    """创建固定发布提交和更晚的分支提交，真正通过 HTTP 克隆裸仓库。"""
    seed = runtime / "seed"
    seed.mkdir()
    (seed / "application").mkdir()
    shutil.copyfile(FIXTURE / "app.py", seed / "application" / "__main__.py")
    shutil.copyfile(FIXTURE / "build.py", seed / "build.py")
    (seed / "sample.txt").write_text("fixed-release", encoding="utf-8")
    command(["git", "init", "--initial-branch=main", str(seed)])
    command(["git", "-C", str(seed), "config", "user.name", "隔离验收"])
    command(["git", "-C", str(seed), "config", "user.email", "isolated@example.invalid"])
    command(["git", "-C", str(seed), "add", "."])
    command(["git", "-C", str(seed), "commit", "-m", "固定发布样本"])
    fixed_sha = command(["git", "-C", str(seed), "rev-parse", "HEAD"])
    command(["git", "-C", str(seed), "tag", "VA.27.42.0"])
    (seed / "sample.txt").write_text("moving-branch-not-release", encoding="utf-8")
    command(["git", "-C", str(seed), "commit", "-am", "分支后续变化"])
    branch_sha = command(["git", "-C", str(seed), "rev-parse", "HEAD"])
    bare = runtime / "git" / "smoke" / "software.git"
    bare.parent.mkdir(parents=True)
    command(["git", "clone", "--bare", str(seed), str(bare)])
    return bare, fixed_sha, branch_sha


def git_sample_server(runtime: Path, bare: Path, token: str, observations: dict[str, int]) -> ThreadingHTTPServer:
    """最小 GitLab Tag 协议样本 + 真实 Git smart HTTP，不替换生产 Provider。"""
    authorization = "Basic " + base64.b64encode(f"oauth2:{token}".encode()).decode("ascii")

    class GitHandler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *args: object) -> None:
            """请求头含临时凭据，不写入访问日志。"""

        def do_GET(self) -> None:
            self.handle_request()

        def do_POST(self) -> None:
            self.handle_request()

        def handle_request(self) -> None:
            parsed = urlsplit(self.path)
            if unquote(parsed.path) == "/api/v4/projects/smoke/software/repository/tags":
                if self.headers.get("PRIVATE-TOKEN") != token:
                    self.send_error(401)
                    return
                observations["authenticated_tag_queries"] += 1
                rows = command(["git", "--git-dir", str(bare), "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/tags"])
                data = [{"name": name, "commit": {"id": sha}} for name, sha in (row.split() for row in rows.splitlines())]
                content = json.dumps(data).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(content)))
                self.send_header("X-Next-Page", "")
                self.end_headers()
                self.wfile.write(content)
                return
            if not parsed.path.startswith("/smoke/software.git/"):
                self.send_error(404)
                return
            if self.headers.get("Authorization") != authorization:
                self.send_response(401)
                self.send_header("WWW-Authenticate", 'Basic realm="isolated-package-check"')
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            observations["authenticated_git_requests"] += 1
            content_length = int(self.headers.get("Content-Length", "0"))
            env = {
                **os.environ, "GIT_PROJECT_ROOT": str(runtime / "git"), "GIT_HTTP_EXPORT_ALL": "1",
                "PATH_INFO": parsed.path, "QUERY_STRING": parsed.query, "REQUEST_METHOD": self.command,
                "CONTENT_TYPE": self.headers.get("Content-Type", ""), "CONTENT_LENGTH": str(content_length),
                "REMOTE_USER": "oauth2", "REMOTE_ADDR": "127.0.0.1",
            }
            response = subprocess.run(["git", "http-backend"], env=env, input=self.rfile.read(content_length),
                                      capture_output=True, check=False)
            if response.returncode:
                self.send_error(500, "隔离 Git HTTP 执行失败")
                return
            headers, separator, content = response.stdout.partition(b"\r\n\r\n")
            if not separator:
                headers, separator, content = response.stdout.partition(b"\n\n")
            if not separator:
                self.send_error(500, "隔离 Git HTTP 未生成响应头")
                return
            status = 200
            parsed_headers = []
            for line in headers.decode().splitlines():
                name, value = line.split(":", 1)
                if name.lower() == "status":
                    status = int(value.strip().split()[0])
                else:
                    parsed_headers.append((name, value.strip()))
            self.send_response(status)
            for name, value in parsed_headers:
                self.send_header(name, value)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

    return ThreadingHTTPServer(("127.0.0.1", 0), GitHandler)


class QuietWSGIHandler(WSGIRequestHandler):
    """验收结果单独留证，不记录登录请求中的任何凭据。"""

    def log_message(self, _format: str, *args: object) -> None:
        pass


def verify(runtime: Path, image: str) -> dict[str, Any]:
    """完整 HTTP 任务创建、真实执行、下载、审计及漂移阻断。"""
    sys.path.insert(0, str(ROOT / "backend"))
    os.environ["DJANGO_SETTINGS_MODULE"] = "config.settings.test"
    from django.conf import settings

    settings.DATABASES["default"]["NAME"] = str(runtime / "package.sqlite3")
    settings.SECRET_KEY = secrets.token_urlsafe(48)
    settings.CREDENTIAL_SECRET_KEY = secrets.token_urlsafe(32)
    settings.ALLOWED_HOSTS = ["127.0.0.1"]
    settings.PACKAGE_WORKSPACE_ROOT = str(runtime / "workspaces")
    settings.MEDIA_ROOT = str(runtime / "media")
    import django

    django.setup()
    import requests
    from django.core.management import call_command
    from django.core.wsgi import get_wsgi_application
    from django.utils import timezone

    from apps.account.models import User
    from apps.credential.models import Credential, CredentialUsageLog
    from apps.package.models import PackageConfig, PackageImage, PackageTask
    from apps.project.models import Project, ProjectComponent, ProjectMember
    from apps.release.models import ReleaseRecord
    from apps.repository.models import Repository
    from apps.system.models import OperationLog

    call_command("migrate", verbosity=0)
    password = secrets.token_urlsafe(32)
    token = secrets.token_urlsafe(32)
    owner = User.objects.create_user(username="package_owner", password=password, nickname="隔离仓库所有者")
    actor = User.objects.create_user(username="package_developer", password=password, nickname="隔离实际开发操作人")
    reader = User.objects.create_user(username="package_maintainer", password=password, nickname="隔离只读维保")
    project = Project.objects.create(name="隔离真实构建项目", code="REAL-PACKAGE", leader=owner, status=1)
    ProjectMember.objects.create(project=project, user=owner, role="manager")
    ProjectMember.objects.create(project=project, user=actor, role="developer")
    ProjectMember.objects.create(project=project, user=reader, role="maintainer")
    credential = Credential(name="仅本次临时凭据", owner=owner, cred_type="gitlab_token", auth_mode="token")
    credential.set_data({"token": token})
    credential.save()
    svn_credential = Credential(name="禁止使用的虚构 SVN 凭据", owner=owner, cred_type="svn_password", auth_mode="password")
    svn_credential.set_data({"username": "isolated", "password": secrets.token_urlsafe(32)})
    svn_credential.save()
    bare, sha, branch_sha = prepare_git(runtime)
    observations = {"authenticated_tag_queries": 0, "authenticated_git_requests": 0}
    git_server = git_sample_server(runtime, bare, token, observations)
    threading.Thread(target=git_server.serve_forever, daemon=True).start()
    repository = Repository.objects.create(
        name="虚构软件真实 Git 仓库", repo_type="git", vendor="gitlab", created_by=owner,
        url=f"http://127.0.0.1:{git_server.server_port}/smoke/software.git", external_identity="smoke/software",
        default_branch="main", credential=credential,
    )
    component = ProjectComponent.objects.create(project=project, repository=repository, component_code="software")
    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=owner, release_type="formal", status="released",
        version="VA.27.42.0", tag_name="VA.27.42.0", git_hash=sha, branch="main",
        release_doc="# 隔离构建验收\n\n固定发布提交的真实产物。", released_at=timezone.now(),
    )
    package_image = PackageImage.objects.create(name="离线虚构软件构建镜像", source="local", image=image)
    config = PackageConfig.objects.create(
        project_component=component, name="虚构软件已有配置", image=package_image, is_active=True,
        # 真实构建样本关闭 SVN；开关开启时的推送与补推由 SVN 专项回归覆盖。
        svn_push_enabled=False, svn_url="https://example.invalid/never-push",
        svn_credential=svn_credential, cleanup_workspace=True,
    )
    app_server = make_server("127.0.0.1", 0, get_wsgi_application(), handler_class=QuietWSGIHandler)
    threading.Thread(target=app_server.serve_forever, daemon=True).start()
    session = requests.Session()
    session.trust_env = False
    base = f"http://127.0.0.1:{app_server.server_port}"

    def request(method: str, path: str, expected: int = 200, **kwargs: Any) -> Any:
        response = session.request(method, base + path, timeout=120, **kwargs)
        assert response.status_code == expected, f"{method} {path}: {response.status_code} {response.text[:300]}"
        return response

    def task_detail(task_id: str) -> dict[str, Any]:
        return request("GET", f"/api/packages/tasks/{task_id}/").json()["data"]

    try:
        read_login = request("POST", "/api/auth/login/", json={"username": reader.username, "password": password}).json()["data"]
        session.headers["Authorization"] = "Bearer " + read_login["access_token"]
        request("POST", f"/api/packages/configs/{config.id}/trigger/", expected=403, json={"release_id": str(release.id)})
        assert not PackageTask.objects.exists()
        assert observations == {"authenticated_tag_queries": 0, "authenticated_git_requests": 0}
        login = request("POST", "/api/auth/login/", json={"username": actor.username, "password": password}).json()["data"]
        session.headers["Authorization"] = "Bearer " + login["access_token"]
        payload = {"release_id": str(release.id)}
        task_id = request("POST", f"/api/packages/configs/{config.id}/trigger/", expected=201, json=payload).json()["data"]["id"]
        task = task_detail(task_id)
        assert task["status"] == "success", task["error_message"]
        for key, expected in {
            "release": str(release.id), "config": str(config.id), "project": str(project.id),
            "repository": str(repository.id), "triggered_by": str(actor.id),
            "version": release.version, "tag_name": release.tag_name, "commit_hash": sha, "source_ref": release.tag_name,
        }.items():
            assert task[key] == expected, (key, task[key], expected)
        assert sha != branch_sha
        assert task["config_snapshot"]["trigger_source"] == "manual_release"
        assert task["config_snapshot"]["svn_push_enabled"] is False
        assert "svn_push" not in task["stage_info"]
        artifacts = task["artifact_info"]
        assert {item["path"] for item in artifacts} == {"software.pyz", "build-info.json", "release.md"}
        downloads = REPORT / "downloads"
        downloads.mkdir()
        hashes: dict[str, str] = {}
        for artifact in artifacts:
            response = request("GET", f"/api/packages/tasks/{task_id}/artifacts/{artifact['id']}/download/")
            actual = hashlib.sha256(response.content).hexdigest()
            assert actual == artifact["sha256"]
            hashes[artifact["path"]] = actual
            (downloads / artifact["path"]).write_bytes(response.content)
        build_info = json.loads((downloads / "build-info.json").read_text())
        assert build_info == {
            "version": release.version, "tag": release.tag_name, "project_code": project.code,
            "commit": sha, "sample": "fixed-release", "app_sha256": hashes["software.pyz"],
        }, build_info
        executable = json.loads(command([sys.executable, str(downloads / "software.pyz")]))
        assert executable == {"message": "隔离软件执行成功", "sample": "fixed-release"}
        archive = request("GET", f"/api/packages/tasks/{task_id}/download-all/").content
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            assert set(bundle.namelist()) == set(hashes)
            for name, digest in hashes.items():
                assert hashlib.sha256(bundle.read(name)).hexdigest() == digest
        (downloads / "all-artifacts.zip").write_bytes(archive)
        log = request("GET", f"/api/packages/tasks/{task_id}/logs/").content
        assert "真实 Docker 编译和 zipapp 打包完成" in log.decode()
        assert "打包完成" in log.decode()
        assert token.encode() not in log and password.encode() not in log
        (REPORT / "successful-build.log").write_bytes(log)
        stored = PackageTask.objects.get(pk=task_id)
        workspace = Path(stored.workspace_path)
        assert not (workspace / "source").exists() and not (workspace / "tmp").exists()
        assert (workspace / "artifacts").is_dir()
        audit = OperationLog.objects.get(module="package", action="trigger_release", resource_id=task_id)
        assert audit.user_id == actor.id and audit.result == "success"
        assert audit.detail["project_id"] == str(project.id) and audit.detail["version"] == release.version
        assert audit.detail["task_id"] == task_id and audit.detail["config_id"] == str(config.id)
        usage = CredentialUsageLog.objects.filter(credential=credential, actor=actor, project=project, repository=repository, result="success")
        assert usage.count() >= 2
        assert not CredentialUsageLog.objects.filter(credential=svn_credential).exists()
        # 将真实 Tag 改到分支新提交；生产引用校验必须阻止执行构建脚本。
        command(["git", "--git-dir", str(bare), "tag", "-f", release.tag_name, branch_sha])
        failed_id = request("POST", f"/api/packages/configs/{config.id}/trigger/", expected=201, json=payload).json()["data"]["id"]
        failed = task_detail(failed_id)
        assert failed["status"] == "failure" and failed["artifact_info"] == []
        assert "快照" in failed["error_message"] or "提交" in failed["error_message"], failed["error_message"]
        failed_log = request("GET", f"/api/packages/tasks/{failed_id}/logs/").content
        assert "真实 Docker 编译和 zipapp 打包完成" not in failed_log.decode()
        assert "docker run" not in failed_log.decode()
        (REPORT / "drift-blocked.log").write_bytes(failed_log)
        request("GET", f"/api/packages/tasks/{failed_id}/download-all/", expected=404)
        session.headers["Authorization"] = "Bearer " + read_login["access_token"]
        request("GET", f"/api/packages/tasks/{task_id}/")
        request("GET", f"/api/packages/tasks/{task_id}/logs/?tail=20")
        request("GET", f"/api/packages/tasks/{task_id}/logs/", expected=403)
        request("GET", f"/api/packages/tasks/{task_id}/download-all/", expected=403)
        request("GET", f"/api/packages/tasks/{task_id}/artifacts/{artifacts[0]['id']}/download/", expected=403)
        request("POST", f"/api/packages/configs/{config.id}/favorite/", expected=403)
        assert PackageTask.objects.count() == 2
        assert observations["authenticated_tag_queries"] >= 2 and observations["authenticated_git_requests"] >= 2
        return {
            "success_task": task_id, "drift_task": failed_id, "actor": str(actor.id), "project": str(project.id),
            "config": str(config.id), "release": str(release.id), "version": release.version, "tag": release.tag_name,
            "fixed_sha": sha, "later_branch_sha": branch_sha, "downloads_sha256": hashes,
            "zip_members_verified": True, "downloaded_software_executed": executable,
            "svn_disabled_by_config": True, "unused_svn_credential": True,
            "credential_audit_count": usage.count(), "operation_audit": {"user": str(audit.user_id), "result": audit.result, "detail": audit.detail},
            "source_and_tmp_cleaned": True, "drift_stopped_before_docker": True, "protocol_sample": observations,
            "actor_role": "developer", "maintainer_readonly": {
                "trigger": 403, "file_log": 403, "single_artifact": 403, "zip": 403, "favorite": 403,
                "task_detail": 200, "online_log": 200, "no_extra_task": True,
            },
        }
    finally:
        session.close()
        app_server.shutdown()
        app_server.server_close()
        git_server.shutdown()
        git_server.server_close()


def main() -> int:
    runtime = Path(os.environ["PACKAGE_REAL_RUNTIME"]).resolve(strict=True)
    run_id = os.environ["PACKAGE_REAL_RUN_ID"]
    if (runtime / ".package-real").read_text() != run_id:
        raise RuntimeError("只允许在入口创建的独立运行目录执行")
    image = os.environ["PACKAGE_REAL_IMAGE"]
    evidence: dict[str, Any] = {
        "run_id": run_id, "started_at": datetime.now(UTC).isoformat(),
        "commit": os.environ["TRACE_SHIP_CHECK_COMMIT"], "python": platform.python_version(),
        "os": platform.freedesktop_os_release(), "docker": json.loads(command(["docker", "version", "--format", "{{json .}}"])),
        "boundaries": [
            "完全隔离的本地虚构软件、随机个人凭据、独立 SQLite、真实 Git smart HTTP",
            "GitLab Tag API 为从真实 Git refs 生成的最小协议样本；未部署或连接组织 GitLab",
            "HTTP 登录和 API、凭证解析及审计、Celery eager、源码校验、Docker 执行及下载均使用生产实现，无 monkeypatch",
            "真实 Docker 镜像离线编译并打包虚构软件；未构建用户业务软件，未验证远程 Windows/麒麟节点，未推 SVN",
        ],
    }
    status = 1
    try:
        (REPORT / "dependencies.txt").write_text(command([sys.executable, "-m", "pip", "freeze"]) + "\n", encoding="utf-8")
        evidence["checks"] = verify(runtime, image)
        events = command([
            "docker", "events", "--since", str(evidence["started_at"]),
            "--until", datetime.now(UTC).isoformat(), "--filter", "type=container",
            "--filter", f"image={image}", "--format", "{{json .}}",
        ])
        container_events = [json.loads(line) for line in events.splitlines() if line]
        starts = [event for event in container_events if event["Action"] == "start"]
        finishes = [event for event in container_events if event["Action"] == "die"]
        assert len(starts) == 1 and len(finishes) == 1, "只有正向任务可以真正启动构建容器"
        assert finishes[0]["Actor"]["Attributes"]["exitCode"] == "0"
        evidence["docker_events"] = container_events
        status = 0
    except Exception as error:
        evidence["failure"] = {"type": type(error).__name__, "message": str(error), "traceback": traceback.format_exc()}
        print(traceback.format_exc(), flush=True)
    finally:
        # Linux runner 的宿主用户未必能删除容器 root 创建的目录；在 helper 内先清掉
        # 本次数据库/随机凭据/源码，宿主只需删除由自己创建的空运行目录和身份标识。
        try:
            if (runtime / ".package-real").read_text() != run_id:
                raise RuntimeError("清理前运行目录身份不符")
            for child in runtime.iterdir():
                if child.name == ".package-real":
                    continue
                if child.is_dir() and not child.is_symlink():
                    shutil.rmtree(child)
                else:
                    child.unlink()
            evidence["runtime_payload_removed"] = True
        except Exception as cleanup_error:
            evidence["runtime_payload_removed"] = False
            evidence["cleanup_failure"] = str(cleanup_error)
            status = status or 1
        evidence.update({"finished_at": datetime.now(UTC).isoformat(), "exit_code": status,
                         "status": "passed" if status == 0 else "failed"})
        write_json(REPORT / "package-real-evidence.json", evidence)
    return status


if __name__ == "__main__":
    raise SystemExit(main())
