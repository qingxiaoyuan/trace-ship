"""已发布正式版的软件归档准备；此模块不向 OA 发送请求。"""
import re
from pathlib import Path, PurePosixPath
from typing import NoReturn
from urllib.parse import quote

from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from apps.account.models import User
from apps.package.models import PackageTask
from apps.package.services import PackageService
from apps.package.services.artifacts import (
    ArtifactQueryError,
    local_artifact_available,
    task_artifact_manifest,
    validate_artifact_path,
    verify_task_svn_artifact,
    verify_task_artifact_directory,
)
from apps.project.models import ProjectComponent
from apps.release.models import ReleaseRecord
from apps.system.oa_archive import OaArchiveConfig
from utils.permissions import IsProjectManager, ProjectRolePermission


class ArchiveFormInput(serializers.Serializer):
    """OA 资料白名单；项目字段不接收，申请数量固定为一。"""
    docCreator = serializers.CharField()
    soft_name = serializers.CharField()
    soft_version = serializers.CharField()
    developer = serializers.CharField()
    soft_source = serializers.ChoiceField(choices=["", "内部自制", "外购"], required=False, default="")
    git_svn = serializers.CharField(allow_blank=True, required=False, default="")
    sn_code = serializers.CharField(allow_blank=True, required=False, default="")
    edit_content = serializers.CharField(allow_blank=True, required=False, default="", trim_whitespace=False)
    edit_reason = serializers.CharField(allow_blank=True, required=False, default="", trim_whitespace=False)
    other_description = serializers.CharField(allow_blank=True, required=False, default="", trim_whitespace=False)
    soft_number = serializers.CharField(allow_blank=True, required=False, default="")

    def validate(self, attrs: dict) -> dict:
        return {**attrs, "applyCount": 1}


class ArchiveSelectionInput(serializers.Serializer):
    task_id = serializers.UUIDField()
    artifact_id = serializers.CharField(max_length=200, required=False, allow_null=True)
    path = serializers.CharField(required=False, max_length=4096)
    source_kind = serializers.ChoiceField(choices=["local", "svn"], required=False)
    scope = serializers.ChoiceField(choices=["file", "directory"], required=False)
    form = ArchiveFormInput(required=False)

    def validate(self, attrs: dict) -> dict:
        if attrs.get("scope") == "directory":
            if attrs.get("path") != "." or "artifact_id" in attrs:
                raise ValidationError({"detail": "请选择本次打包的完整产物目录，不接受单文件或子目录"})
            return attrs
        if not attrs.get("artifact_id") and not attrs.get("path"):
            raise ValidationError({"detail": "请选择一个任务产物或 SVN 文件"})
        return attrs


def archive_file_error(error: ArtifactQueryError) -> NoReturn:
    """保留文件缺失、认证与网络错误的分类及状态。"""
    failure = APIException({"detail": str(error), "state": error.state})
    failure.status_code = error.status_code
    raise failure from error


def extract_archive_changes(doc: str) -> tuple[str, str]:
    """只识别生成器的两列表格行；不确定时完整保留原文供人工核对。"""
    # 围栏中的表格可能只是示例；此格式尚不能可靠判定归档更新区域。
    if re.search(r"^[ \t]*(?:`{3,}|~{3,})", doc, re.MULTILINE):
        return doc, "release_doc_original"
    matches = list(re.finditer(r"^\|[ \t]*(?:变更内容|更新内容)[ \t]*\| (.*?) (?<!\\)\|[ \t]*$", doc, re.MULTILINE | re.DOTALL))
    if len(matches) == 1 and not re.search(r"(?<!\\)\|", matches[0][1]):
        return matches[0][1].replace("\\|", "|"), "release_doc_changes"
    return doc, "release_doc_original"


class ArchivePublisherPermission(ProjectRolePermission):
    """历史发布人仍须具有本项目业务写入身份。"""
    required_roles = ["developer", "tester", "manager"]


class OaArchivePreparation:
    @staticmethod
    def can_prepare(release: ReleaseRecord, user: User) -> bool:
        return IsProjectManager()._check(release.project, user) or (
            release.publisher_id == user.id and ArchivePublisherPermission()._check(release.project, user)
        )

    @classmethod
    def require_permission(cls, release: ReleaseRecord, user: User) -> None:
        if not cls.can_prepare(release, user):
            raise PermissionDenied("仅发布人、目标项目管理员或软件管理员可准备归档，且须保持项目业务写入权限")

    @staticmethod
    def require_release(release: ReleaseRecord) -> None:
        if release.release_type != "formal" or release.status != "released":
            raise ValidationError({"detail": "仅已发布的正式版可准备 OA 软件归档"})

    @staticmethod
    def require_task(release: ReleaseRecord, task: PackageTask) -> None:
        if (task.release_id != release.id or task.project_id != release.project_id
                or task.repository_id != release.repository_id):
            raise ValidationError({"detail": "打包任务不属于当前发布及目标项目"})
        if task.status != "success":
            raise ValidationError({"detail": "仅打包成功的任务可准备归档"})
        if task.config_snapshot.get("svn_push_enabled") and task.stage_info.get("svn_push", {}).get("status") != "success":
            raise ValidationError({"detail": "该任务快照启用了 SVN 推送，须推送成功后准备归档"})

    @staticmethod
    def local_artifact(task: PackageTask, artifact_id: str) -> dict:
        artifact = next((item for item in task.artifact_info if item.get("id") == artifact_id), None)
        if not artifact:
            raise NotFound("产物不在该任务清单中")
        workspace = Path(task.workspace_path).resolve() if task.workspace_path else None
        workspace_root = PackageService.workspace_root().resolve()
        if workspace is None or workspace_root not in workspace.parents:
            raise ValidationError({"detail": "任务工作区不可用"})
        root = (workspace / "artifacts").resolve()
        path = artifact.get("path") or ""
        file_path = (root / path).resolve()
        if not local_artifact_available(task, artifact):
            raise ValidationError({"detail": "产物文件已不存在或路径不在任务目录内"})
        return {**artifact, "path": file_path.relative_to(root).as_posix()}

    @staticmethod
    def selection_path(task: PackageTask, selection: dict) -> str:
        """任务与规范相对路径是共同身份；产物 ID 只用于该任务内定位。"""
        if selection.get("scope") == "directory":
            if selection.get("path") != "." or "artifact_id" in selection:
                raise ValidationError({"detail": "归档目录必须是本次打包的完整产物目录"})
            return "."
        _, manifest = task_artifact_manifest(task)
        artifact_id = selection.get("artifact_id")
        original = next((item for item in manifest if item.get("id") == artifact_id), None) if artifact_id else None
        if artifact_id and original is None:
            raise NotFound("产物不在该任务清单中")
        raw_path = original.get("path") if original else selection.get("path")
        try:
            path = validate_artifact_path(PurePosixPath(raw_path or "").as_posix())
            if selection.get("path") and validate_artifact_path(PurePosixPath(selection["path"]).as_posix()) != path:
                raise ArtifactQueryError("invalid_path", "所选文件与任务产物不一致")
        except ArtifactQueryError as error:
            archive_file_error(error)
        return path

    @classmethod
    def selected_artifact(cls, task: PackageTask, selection: dict) -> dict:
        path = cls.selection_path(task, selection)
        if selection.get("scope") == "directory":
            try:
                return verify_task_artifact_directory(task, source_kind=selection.get("source_kind"))
            except ArtifactQueryError as error:
                archive_file_error(error)
        original = next((item for item in task.artifact_info or [] if PurePosixPath(item.get("path") or "").as_posix() == path), None)
        if selection.get("source_kind") != "svn" and original and local_artifact_available(task, original):
            root_path = (Path(task.workspace_path) / "artifacts").resolve()
            artifact = {**original, "path": (root_path / path).resolve().relative_to(root_path).as_posix()}
            svn = (task.stage_info or {}).get("svn_push", {})
            root = svn.get("remote_url", "") if svn.get("status") == "success" else ""
            return {**artifact, "artifact_id": artifact.get("id"), "kind": "local", "supplemented": False,
                    "url": f"{root.rstrip('/')}/{quote(path, safe='/')}" if root else "",
                    "original": {key: artifact.get(key) for key in ("size", "sha256", "revision")}, "current": None}
        try:
            artifact = verify_task_svn_artifact(task, path)
        except ArtifactQueryError as error:
            archive_file_error(error)
        return {**artifact, "kind": "svn", "supplemented": artifact["source"] == "svn_supplement"}

    @classmethod
    def options(cls, release: ReleaseRecord, user: User) -> dict:
        cls.require_permission(release, user)
        cls.require_release(release)
        artifacts = []
        svn_tasks = []
        directories = []
        for task in release.package_tasks.all():
            try:
                cls.require_task(release, task)
            except ValidationError:
                continue
            stage = (task.stage_info or {}).get("svn_push", {})
            if task.config_snapshot.get("svn_push_enabled") or stage.get("remote_url"):
                svn_tasks.append({"task_id": str(task.id), "task_name": task.name})
            source, manifest = task_artifact_manifest(task)
            svn_root = stage.get("remote_url", "") if stage.get("status") == "success" else ""
            if svn_root or any(local_artifact_available(task, item) for item in manifest):
                directories.append({
                    "task_id": str(task.id), "task_name": task.name, "name": "完整产物目录",
                    "scope": "directory", "path": ".", "source_kind": "svn" if svn_root else "local",
                    "created_at": task.created_at.isoformat(),
                    "artifact_count": len(manifest) if source != "svn_supplement" else None, "svn_url": svn_root,
                })
            for candidate in task.artifact_info or []:
                try:
                    artifact = cls.local_artifact(task, candidate.get("id", ""))
                except (NotFound, ValidationError):
                    continue
                artifacts.append({
                    "task_id": str(task.id), "task_name": task.name,
                    "artifact_id": artifact["id"], "name": artifact.get("name") or artifact["path"],
                    "path": artifact["path"], "source_kind": "local",
                })
        return {"artifacts": artifacts, "svn_tasks": svn_tasks, "directories": directories}

    @classmethod
    def prepare(cls, release: ReleaseRecord, user: User, selection: dict) -> dict:
        cls.require_permission(release, user)
        cls.require_release(release)
        task = PackageTask.objects.filter(pk=selection["task_id"]).first()
        if task is None:
            raise NotFound("打包任务不存在")
        cls.require_task(release, task)
        artifact = cls.selected_artifact(task, selection)
        svn_url = artifact["url"]
        content, source = extract_archive_changes(release.release_doc or "")
        component = ProjectComponent.objects.filter(project=release.project, repository=release.repository).first()
        configured = bool(OaArchiveConfig.get_url())
        selected = {"task_id": str(task.id), "path": artifact["path"], "source_kind": artifact["kind"]}
        if artifact.get("scope") == "directory":
            selected["scope"] = "directory"
        else:
            selected["artifact_id"] = artifact.get("artifact_id")
        return {
            "selection": selected,
            "source": artifact,
            "configuration": {
                "configured": configured,
                "reason": "" if configured else "尚未配置 OA 软件归档接口地址，请联系系统配置维护者",
            },
            "content_source": source,
            "form": selection.get("form") or {
                "docCreator": user.username, "applyCount": 1,
                "soft_name": (component.display_name if component else "") or release.repository.name,
                "soft_version": release.version, "developer": release.publisher.username if release.publisher else "",
                "soft_source": "", "git_svn": svn_url,
                "sn_code": release.git_hash if re.fullmatch(r"[a-fA-F0-9]{40}|[a-fA-F0-9]{64}", release.git_hash or "") else "",
                "edit_content": content, "edit_reason": "", "other_description": "", "soft_number": "",
            },
        }
