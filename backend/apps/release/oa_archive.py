"""已发布正式版的软件归档准备；此模块不向 OA 发送请求。"""
import re
from pathlib import Path
from urllib.parse import quote

from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from apps.package.models import PackageTask
from apps.package.services import PackageService
from apps.project.models import ProjectComponent
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

    def validate(self, attrs):
        return {**attrs, "applyCount": 1}


class ArchiveSelectionInput(serializers.Serializer):
    task_id = serializers.UUIDField()
    artifact_id = serializers.CharField(max_length=200)
    form = ArchiveFormInput(required=False)


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
    def can_prepare(release, user) -> bool:
        return IsProjectManager()._check(release.project, user) or (
            release.publisher_id == user.id and ArchivePublisherPermission()._check(release.project, user)
        )

    @classmethod
    def require_permission(cls, release, user) -> None:
        if not cls.can_prepare(release, user):
            raise PermissionDenied("仅发布人、目标项目管理员或软件管理员可准备归档，且须保持项目业务写入权限")

    @staticmethod
    def require_release(release) -> None:
        if release.release_type != "formal" or release.status != "released":
            raise ValidationError({"detail": "仅已发布的正式版可准备 OA 软件归档"})

    @staticmethod
    def require_task(release, task) -> None:
        if (task.release_id != release.id or task.project_id != release.project_id
                or task.repository_id != release.repository_id):
            raise ValidationError({"detail": "打包任务不属于当前发布及目标项目"})
        if task.status != "success":
            raise ValidationError({"detail": "仅打包成功的任务可准备归档"})
        if task.config_snapshot.get("svn_push_enabled") and task.stage_info.get("svn_push", {}).get("status") != "success":
            raise ValidationError({"detail": "该任务快照启用了 SVN 推送，须推送成功后准备归档"})

    @staticmethod
    def local_artifact(task, artifact_id: str) -> dict:
        artifact = next((item for item in task.artifact_info if item.get("id") == artifact_id), None)
        if not artifact:
            raise NotFound("产物不在该任务清单中")
        workspace = Path(task.workspace_path).resolve() if task.workspace_path else None
        workspace_root = PackageService.workspace_root().resolve()
        if workspace is None or not workspace.is_relative_to(workspace_root):
            raise ValidationError({"detail": "任务工作区不可用"})
        root = (workspace / "artifacts").resolve()
        path = artifact.get("path") or ""
        file_path = (root / path).resolve()
        if not root.is_relative_to(workspace) or not file_path.is_relative_to(root) or not file_path.is_file():
            raise ValidationError({"detail": "产物文件已不存在或路径不在任务目录内"})
        return artifact

    @classmethod
    def options(cls, release, user) -> dict:
        cls.require_permission(release, user)
        cls.require_release(release)
        artifacts = []
        for task in release.package_tasks.all():
            try:
                cls.require_task(release, task)
            except ValidationError:
                continue
            for candidate in task.artifact_info:
                try:
                    artifact = cls.local_artifact(task, candidate.get("id", ""))
                except (NotFound, ValidationError):
                    continue
                artifacts.append({
                    "task_id": str(task.id), "task_name": task.name,
                    "artifact_id": artifact["id"], "name": artifact.get("name") or artifact["path"],
                    "path": artifact["path"],
                })
        return {"artifacts": artifacts}

    @classmethod
    def prepare(cls, release, user, selection: dict) -> dict:
        cls.require_permission(release, user)
        cls.require_release(release)
        task = PackageTask.objects.filter(pk=selection["task_id"]).first()
        if task is None:
            raise NotFound("打包任务不存在")
        cls.require_task(release, task)
        artifact = cls.local_artifact(task, selection["artifact_id"])
        svn = task.stage_info.get("svn_push", {})
        svn_root = svn.get("remote_url", "") if svn.get("status") == "success" else ""
        svn_url = f"{svn_root.rstrip('/')}/{quote(artifact['path'], safe='/')}" if svn_root else ""
        content, source = extract_archive_changes(release.release_doc or "")
        component = ProjectComponent.objects.filter(project=release.project, repository=release.repository).first()
        configured = bool(OaArchiveConfig.get_url())
        return {
            "selection": {"task_id": str(task.id), "artifact_id": selection["artifact_id"]},
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
