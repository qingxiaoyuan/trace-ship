"""产物依据与当前文件可用性：原始清单不随文件清理删除。"""
from pathlib import Path

from apps.package.models import PackageTask
from utils.provider.exceptions import (
    AuthenticationError,
    AuthorizationError,
    ConnectionError,
    NotFoundError,
    ProviderError,
)
from utils.provider.svn import SVNProvider


def local_artifact_available(task: PackageTask, artifact: dict) -> bool:
    """只认工作区内确实存在的文件，不把历史元数据当成本地文件。"""
    from apps.package.services import PackageService

    if not task.workspace_path or (task.stage_info or {}).get("artifacts_cleaned_at"):
        return False
    workspace = Path(task.workspace_path).resolve()
    workspace_root = PackageService.workspace_root().resolve()
    root = (workspace / "artifacts").resolve()
    path = (root / str(artifact.get("path") or "")).resolve()
    return bool(
        workspace_root in workspace.parents
        and workspace in root.parents
        and root in path.parents
        and path.is_file()
    )


class ArtifactQueryError(Exception):
    """可向成员展示的分类错误，不包含服务端地址细节或凭证。"""

    def __init__(self, state: str, message: str, status_code: int = 400):
        super().__init__(message)
        self.state = state
        self.status_code = status_code


def validate_artifact_path(path: str, *, allow_empty: bool = False) -> str:
    """相对路径使用解码后的文件名；拒绝遍历、URL、反斜杠与编码绕过。"""
    from urllib.parse import unquote

    if not isinstance(path, str) or (not path and not allow_empty):
        raise ArtifactQueryError("invalid_path", "请选择任务目录内的相对路径")
    checked = path
    for _ in range(4):
        if (
            checked.startswith("/") or "\\" in checked or ":" in checked
            or any(ord(char) < 32 for char in checked)
            or any(part in (".", "..") for part in checked.split("/"))
        ):
            raise ArtifactQueryError("invalid_path", "路径必须位于当前任务的 SVN 目录内")
        decoded = unquote(checked)
        if decoded == checked:
            break
        checked = decoded
    else:
        raise ArtifactQueryError("invalid_path", "路径编码层级不合法")
    return path


def _svn_context(task: PackageTask) -> tuple[str, SVNProvider]:
    from urllib.parse import quote, unquote, urlsplit, urlunsplit

    from django.core.exceptions import ValidationError

    from apps.credential.models import Credential
    from utils.provider.factory import get_provider

    stage = (task.stage_info or {}).get("svn_push") or {}
    snapshot = task.config_snapshot or {}

    def canonical_url(value: str) -> str:
        try:
            if not isinstance(value, str):
                raise ValueError("目录不是字符串")
            parts = urlsplit(value)
        except (ValueError, TypeError) as exc:
            raise ArtifactQueryError("unverifiable", "任务保存的 SVN 目录依据无效，无法核验") from exc
        if (
            parts.scheme not in ("svn", "http", "https") or not parts.netloc
            or parts.username or parts.password or parts.query or parts.fragment
        ):
            raise ArtifactQueryError("unverifiable", "任务保存的 SVN 目录依据无效，无法核验")
        path = unquote(parts.path).rstrip("/")
        validate_artifact_path(path.lstrip("/"), allow_empty=True)
        return urlunsplit((parts.scheme, parts.netloc, quote(path, safe="/"), "", ""))

    if not stage.get("remote_url") or not snapshot.get("svn_url"):
        raise ArtifactQueryError("unverifiable", "任务未保存 SVN 推送目录，无法恢复文件；不会使用当前配置猜测目录")
    root = canonical_url(stage["remote_url"])
    base = canonical_url(snapshot["svn_url"])
    if root != base and not root.startswith(base + "/"):
        raise ArtifactQueryError("unverifiable", "任务保存的 SVN 目录与凭证授权范围不匹配，无法核验")
    try:
        credential = Credential.objects.get(pk=snapshot.get("svn_credential_id"), cred_type="svn_password")
    except (Credential.DoesNotExist, ValidationError, ValueError, TypeError) as exc:
        raise ArtifactQueryError("unverifiable", "任务的 SVN 凭证依据缺失，无法核验") from exc
    if not credential.is_active:
        raise ArtifactQueryError("credential_invalid", "任务的 SVN 凭证已停用，无法核验")
    try:
        data = credential.get_data()
    except (ValueError, TypeError) as exc:
        raise ArtifactQueryError("credential_invalid", "任务的 SVN 凭证无法解密，无法核验") from exc
    if not isinstance(data, dict) or not data.get("username") or not data.get("password"):
        raise ArtifactQueryError("credential_invalid", "任务的 SVN 凭证缺少用户名或密码，无法核验")
    return root, get_provider("svn", root, data)


def _svn_error(exc: ProviderError) -> ArtifactQueryError:
    """所有只读 SVN 操作共用分类，界面不回显原始命令、地址或凭证。"""
    if isinstance(exc, NotFoundError):
        return ArtifactQueryError("missing", "SVN 当前路径不存在", 409)
    if isinstance(exc, AuthorizationError):
        return ArtifactQueryError("forbidden", "SVN 凭证无权访问该路径，无法核验", 502)
    if isinstance(exc, AuthenticationError):
        return ArtifactQueryError("credential_invalid", "SVN 凭证认证失败，无法核验", 502)
    if isinstance(exc, ConnectionError):
        return ArtifactQueryError("network_error", "SVN 网络连接失败，无法核验", 502)
    return ArtifactQueryError("unverifiable", "SVN 返回结果无法核验", 502)


def _current_file(provider: SVNProvider, url: str) -> tuple[str, dict | None, str]:
    try:
        current = provider.inspect_path(url)
        if current["kind"] != "file":
            return "not_file", current, "当前位置是目录，不能作为文件选择"
        return "available", current, "当前文件存在，内容可能已被覆盖"
    except ProviderError as exc:
        error = _svn_error(exc)
        return error.state, None, str(error)


def task_artifact_manifest(task: PackageTask) -> tuple[str, list[dict]]:
    """优先原产物清单，其次已成功推送的上传清单；只排除有生成依据的系统说明。"""
    from apps.package.services import PackageService

    if task.artifact_info:
        return "artifact_manifest", task.artifact_info
    stage = (task.stage_info or {}).get("svn_push") or {}
    if isinstance(stage.get("files"), list):
        system_files = set(stage.get("system_files") or [])
        if stage.get("status") == "success":
            # 历史上传器在成功推送前必定创建该文件，同名产物则会拒绝推送。
            system_files.add(f"release-{PackageService._doc_filename(task.version)}.md")
        return "upload_manifest", [
            {"path": path} for path in stage["files"] if isinstance(path, str) and path not in system_files
        ]
    return "svn_supplement", []


def _browse_task_directory(provider: SVNProvider, root: str, path: str) -> list[dict]:
    from urllib.parse import quote

    url = root + ("/" + quote(path, safe="/") if path else "")
    state, directory, message = _current_file(provider, url)
    if state != "not_file" or not directory or directory.get("kind") != "dir":
        raise ArtifactQueryError("not_directory" if state == "available" else state,
                                 "所选路径是文件，不能作为目录浏览" if state == "available" else message)
    entries = []
    try:
        items = provider.list_dir(url + "@" + directory["repository_revision"])
    except ProviderError as exc:
        raise _svn_error(exc) from exc
    for item in items:
        relative = (path + "/" if path else "") + item["name"]
        validate_artifact_path(relative)
        entries.append({
            "artifact_id": None, "path": relative, "name": item["name"],
            "url": root + "/" + quote(relative, safe="/"), "source": "svn_supplement",
            "state": "directory" if item["kind"] == "dir" else "available",
            "message": "从 SVN 补录；未证明与原构建内容一致", "local_available": False,
            "original": {"size": None, "sha256": None, "revision": None},
            "current": {key: item.get(key) for key in ("kind", "size", "revision", "date")},
        })
    return entries


def query_task_svn_artifacts(task: PackageTask, path: str = "", *, page: int = 1, page_size: int = 50) -> dict:
    """按已保存的清单查询当前文件，原构建证据与当前 SVN 元数据分开返回。"""
    from urllib.parse import quote

    validate_artifact_path(path, allow_empty=True)
    try:
        page, page_size = int(page), int(page_size)
    except (ValueError, TypeError) as exc:
        raise ArtifactQueryError("invalid_page", "分页参数必须为正整数") from exc
    if page < 1 or not 1 <= page_size <= 100:
        raise ArtifactQueryError("invalid_page", "页码须为正整数，每页最多 100 项")
    start = (page - 1) * page_size
    root, provider = _svn_context(task)
    entries = []
    source, manifest = task_artifact_manifest(task)
    if source == "svn_supplement":
        entries = _browse_task_directory(provider, root, path)
        return {"task_id": str(task.pk), "root_url": root, "mode": "browse", "path": path,
                "entries": entries[start:start + page_size], "total": len(entries), "page": page, "page_size": page_size}
    if path:
        raise ArtifactQueryError("invalid_path", "任务已有原清单，只能核验清单中的文件")
    failed_connection = None
    for original in manifest[start:start + page_size]:
        relative = validate_artifact_path(original.get("path") or "")
        url = root + "/" + quote(relative, safe="/")
        state, current, message = failed_connection or _current_file(provider, url)
        if state in ("network_error", "credential_invalid"):
            # 同一次请求凭证或连接已失败，剩余文件保留无法核验，不重复等待相同失败。
            failed_connection = (state, current, message)
        entries.append({
            "artifact_id": original.get("id"), "path": relative, "name": relative.rsplit("/", 1)[-1],
            "url": url, "source": source, "state": state, "message": message,
            "local_available": local_artifact_available(task, original),
            "original": {"size": original.get("size"), "sha256": original.get("sha256"), "revision": original.get("revision")},
            "current": current,
        })
    return {"task_id": str(task.pk), "root_url": root, "mode": "manifest", "path": "", "entries": entries,
            "total": len(manifest), "page": page, "page_size": page_size}


def verify_task_svn_artifact(task: PackageTask, path: str) -> dict:
    """选择或提交时重新核验 SVN 当前文件；已有清单时禁止认领清单之外的路径。"""
    from urllib.parse import quote

    relative = validate_artifact_path(path)
    source, manifest = task_artifact_manifest(task)
    original = next((item for item in manifest if item.get("path") == relative), None)
    if source != "svn_supplement" and original is None:
        raise ArtifactQueryError("invalid_path", "文件不在任务保存的产物清单中")
    root, provider = _svn_context(task)
    url = root + "/" + quote(relative, safe="/")
    state, current, message = _current_file(provider, url)
    if state != "available":
        raise ArtifactQueryError(state, message, 409 if state in ("missing", "not_file") else 502)
    original = original or {}
    return {
        "task_id": str(task.pk), "artifact_id": original.get("id"), "path": relative,
        "name": relative.rsplit("/", 1)[-1], "url": url, "source": source,
        "state": state, "message": message, "local_available": local_artifact_available(task, original),
        "original": {"size": original.get("size"), "sha256": original.get("sha256"), "revision": original.get("revision")},
        "current": current,
    }
