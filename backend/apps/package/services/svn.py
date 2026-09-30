"""
打包产物 SVN 推送与发布文档同步
"""
import logging
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from django.utils import timezone
from rest_framework import serializers

from apps.credential.models import Credential
from apps.package.models import PackageTask
from utils.markdown_table import table_newlines_to_br
from utils.provider.factory import get_provider

logger = logging.getLogger(__name__)

# 任务快照 trigger_source：决定本次打包是否允许推 SVN
TRIGGER_SOURCE_AUTO_RELEASE = "auto_release"
TRIGGER_SOURCE_MANUAL_RELEASE = "manual_release"
TRIGGER_SOURCE_MANUAL_BRANCH = "manual_branch"

# 默认目录模板。渲染时改为 {release_type}/{version}，三类版本分目录存放。
DEFAULT_SVN_PATH_TEMPLATE = "{version}"


def release_type_allows_svn(snapshot: dict[str, Any], release_type: str) -> bool:
    """总开关打开后，正式版直接允许；RC / 测试版还要看各自开关。

    历史快照没有 svn_push_rc / svn_push_beta 时按关闭处理。
    """
    if not snapshot.get("svn_push_enabled"):
        return False
    kind = release_type or "formal"
    if kind == "formal":
        return True
    if kind == "rc":
        return bool(snapshot.get("svn_push_rc"))
    if kind == "beta":
        return bool(snapshot.get("svn_push_beta"))
    return False


def apply_svn_push_policy(
    snapshot: dict[str, Any],
    *,
    trigger_source: str,
    release_type: str,
) -> dict[str, Any]:
    """按触发来源与发布类型写入快照。

    仅发布后自动打包可推 SVN。正式版看总开关；RC、测试版在总开关之外还要打开
    对应开关。结果写回 svn_push_enabled，后续执行只认这个生效值。
    """
    snapshot = dict(snapshot)
    snapshot["trigger_source"] = trigger_source
    allow = (
        trigger_source == TRIGGER_SOURCE_AUTO_RELEASE
        and release_type_allows_svn(snapshot, release_type)
    )
    snapshot["svn_push_enabled"] = allow
    return snapshot


def task_allows_svn_push(task: PackageTask) -> bool:
    """任务是否允许自动/手动推送 SVN。

    创建任务时已按发布类型把是否推送写入 svn_push_enabled。
    这里只认该生效值，以及 trigger_source=auto_release。
    历史任务无 trigger_source 的不允许补推，避免旧手动包再推上 SVN。
    """
    snapshot = task.config_snapshot or {}
    if not snapshot.get("svn_push_enabled"):
        return False
    return snapshot.get("trigger_source") == TRIGGER_SOURCE_AUTO_RELEASE


class SvnPushMixin:
    """产物推送 SVN 与发布文档同步相关方法。"""

    @classmethod
    def _note_svn_directory_change(cls, task: PackageTask, previous_url: str, new_url: str) -> None:
        """上次已推送的目录和本次不同时写入任务日志。

        默认模板从平铺版本号改为 formal/rc/beta 分目录后，历史任务重推会进入新目录，
        旧目录保持原样。两条地址都写进日志。
        """
        previous = (previous_url or "").strip().rstrip("/")
        current = (new_url or "").strip().rstrip("/")
        if not previous or not current or previous == current:
            return
        cls._append_log(
            task,
            "本次 SVN 目录与上次不同："
            f"上次 {previous}，本次 {current}。"
            "上次目录保留，不会被这次推送更新。",
        )

    @staticmethod
    def _ensure_svn_parent_dirs(provider, svn_url: str, version_dir: str) -> None:
        """svn import 不会自动创建父目录，逐级创建版本目录缺失的中间父目录。

        版本目录可能多级，例如默认模板 formal/V1.0.0，或版本号本身含斜杠。
        除最后一级外的父目录需先创建，否则 import 会因路径不存在而失败。
        最后一级目录由 svn import 自动创建，无需预先 mkdir。
        """
        base = svn_url.rstrip("/")
        parts = [part for part in version_dir.split("/") if part]
        for depth in range(1, len(parts)):
            url = f"{base}/{'/'.join(parts[:depth])}"
            if not provider.remote_exists(url):
                provider.mkdir(url, message="trace-ship: 自动创建打包产物 SVN 目录")

    @classmethod
    def _push_artifacts_to_svn(cls, task: PackageTask, workspace: Path) -> dict[str, Any]:
        """将打包产物推送到 SVN 版本号目录。

        提交模式由配置快照 svn_commit_mode 决定：
        - new_dir（默认）：目标目录已存在时报错，svn import 新建提交；
        - overwrite：目录已存在时 checkout 后镜像覆盖提交（新增/修改/删除同步）。

        Args:
            task: 打包任务记录
            workspace: 任务工作区

        Returns:
            推送结果字典，包含 remote_url、file_count、files

        Raises:
            RuntimeError: 配置不完整、凭证失效、目录已存在（new_dir 模式）或推送失败
        """
        snapshot = task.config_snapshot or {}
        svn_url = snapshot.get("svn_url", "")
        cred_id = snapshot.get("svn_credential_id")
        path_template = snapshot.get("svn_path_template") or DEFAULT_SVN_PATH_TEMPLATE

        if not svn_url or not cred_id:
            raise RuntimeError("SVN 推送配置不完整")

        # 解析凭证
        try:
            credential = Credential.objects.get(id=cred_id)
        except Credential.DoesNotExist as exc:
            raise RuntimeError("SVN 凭证不存在") from exc
        if not credential.is_active:
            raise RuntimeError("SVN 凭证已停用")
        credential.last_used_at = timezone.now()
        credential.save(update_fields=["last_used_at", "updated_at"])
        cred_data = credential.get_data()

        # 渲染版本目录，支持 {release_type}。结果可以含斜杠：默认模板会变成
        # formal/版本号，版本号本身也可能带斜杠。父目录由 _ensure_svn_parent_dirs
        # 逐级创建。分支直打不推 SVN，斜杠只描述目录渲染。
        release_type = task.release_type or "formal"
        version_dir = path_template.format(
            version=task.version,
            tag_name=task.tag_name,
            build_type=task.build_type,
            project_code=task.project.code or task.project.name,
            release_type=release_type,
        ).strip("/")
        if not version_dir:
            raise RuntimeError("SVN 目录模板渲染结果为空")
        # 默认模板按发布类型分目录：formal/版本号、rc/版本号、beta/版本号。
        # 自定义模板按原文渲染，不再自动插入类型目录或 -rc/-beta 后缀。
        if path_template == DEFAULT_SVN_PATH_TEMPLATE:
            version_dir = f"{release_type}/{version_dir}"
        remote_url = f"{svn_url.rstrip('/')}/{version_dir}"

        # 创建 provider；提交模式决定目录已存在时的行为：
        # new_dir（默认）报错终止；overwrite 走 checkout→镜像覆盖→commit
        provider = get_provider("svn", svn_url, cred_data)
        commit_mode = snapshot.get("svn_commit_mode") or "new_dir"
        remote_exists = provider.remote_exists(remote_url)
        if remote_exists and commit_mode != "overwrite":
            raise RuntimeError(f"SVN 目录已存在: {remote_url}")
        if not remote_exists:
            # svn import 不会自动创建父目录：分支直打包的版本目录可能含斜杠
            # （如 feature/demo），需先逐级创建缺失的中间目录，否则推送必然失败
            cls._ensure_svn_parent_dirs(provider, svn_url, version_dir)

        artifacts_dir = workspace / "artifacts"
        if not artifacts_dir.exists():
            raise RuntimeError("产物目录不存在，无法推送")

        upload_dir = workspace / "tmp" / "svn_upload"
        if upload_dir.exists():
            shutil.rmtree(upload_dir)
        shutil.copytree(artifacts_dir, upload_dir)

        doc_name = f"release-{cls._doc_filename(task.version)}.md"
        doc_path = upload_dir / doc_name
        if doc_path.exists():
            raise RuntimeError(f"SVN 上传目录已存在发布文档同名文件: {doc_name}")
        release_doc = ""
        if task.release_id:
            release_doc = task.release.release_doc or ""
        # 推送 SVN 的发布文档转为标准 Markdown 表格语法（单元格内换行用 <br>）
        doc_path.write_text(table_newlines_to_br(release_doc), encoding="utf-8")

        message = f"Release {task.version} artifacts ({task.tag_name})"
        if release_doc:
            message += f"\n\n{release_doc}"
        if remote_exists:
            # 覆盖式提交：checkout 目标目录后镜像同步（新增/修改/删除一并提交），
            # 同名发布文档随之上传覆盖
            provider.sync_directory(remote_url, str(upload_dir), message)
        else:
            provider.import_path(str(upload_dir), remote_url, message)

        uploaded_files = sorted(
            file.relative_to(upload_dir).as_posix()
            for file in upload_dir.rglob("*")
            if file.is_file()
        )
        return {
            "remote_url": remote_url,
            "file_count": len(uploaded_files),
            "files": uploaded_files,
        }

    @classmethod
    def sync_release_docs_to_svn(cls, release) -> list[dict[str, Any]]:
        """
        将发布文档同步替换到该发布所有已推送 SVN 的打包任务目录。

        修改发布文档（update-doc）后调用：仅处理已成功推送过 SVN 的打包任务，
        按目录并行执行 SVN 文件替换。任一任务失败不影响其它任务，也不抛出异常，
        结果以列表形式返回供前端提示。

        Args:
            release: 发布记录

        Returns:
            同步结果列表，每项 {task_name, remote_url, ok, error?}
        """
        results: list[dict[str, Any]] = []
        if not (release.release_doc or "").strip():
            return results
        doc_content = table_newlines_to_br(release.release_doc or "")
        message = f"Release {release.version} doc update"

        # 主线程收集任务上下文并解析凭证（避免工作线程操作 ORM 连接）
        jobs: list[dict[str, Any]] = []
        tasks = release.package_tasks.filter(status="success")
        for task in tasks:
            stage = (task.stage_info or {}).get("svn_push")
            if not stage or stage.get("status") != "success":
                continue
            remote_url = (stage.get("remote_url") or "").strip()
            snapshot = task.config_snapshot or {}
            svn_url = (snapshot.get("svn_url") or "").strip()
            cred_id = snapshot.get("svn_credential_id")
            if not remote_url or not svn_url or not cred_id:
                continue
            entry: dict[str, Any] = {
                "task_name": task.name,
                "remote_url": remote_url,
                "ok": False,
            }
            try:
                credential = Credential.objects.get(id=cred_id)
                if not credential.is_active:
                    raise RuntimeError("SVN 凭证已停用")
                credential.last_used_at = timezone.now()
                credential.save(update_fields=["last_used_at", "updated_at"])
                jobs.append({
                    "task_name": task.name,
                    "remote_url": remote_url,
                    "svn_url": svn_url,
                    "cred_data": credential.get_data(),
                    "doc_name": f"release-{cls._doc_filename(task.version)}.md",
                })
            except Exception as exc:  # noqa: BLE001 - 单点失败不阻塞整体
                entry["error"] = str(exc)
                results.append(entry)
        if not jobs:
            return results

        def _run_one(job: dict[str, Any]) -> dict[str, Any]:
            """工作线程：仅做 SVN 替换，无 ORM 操作"""
            provider = get_provider("svn", job["svn_url"], job["cred_data"])
            with tempfile.TemporaryDirectory(prefix="trace-ship-svn-doc-") as tmp:
                doc_path = Path(tmp) / job["doc_name"]
                doc_path.write_text(doc_content, encoding="utf-8")
                provider.replace_file(
                    job["remote_url"], str(doc_path), message=message
                )
            return {"task_name": job["task_name"], "remote_url": job["remote_url"]}

        with ThreadPoolExecutor(max_workers=min(8, len(jobs))) as pool:
            future_map = {pool.submit(_run_one, job): job for job in jobs}
            for future in as_completed(future_map):
                job = future_map[future]
                entry = {
                    "task_name": job["task_name"],
                    "remote_url": job["remote_url"],
                    "ok": False,
                }
                try:
                    future.result()
                    entry["ok"] = True
                except Exception as exc:  # noqa: BLE001 - 单点失败不阻塞整体保存
                    entry["error"] = str(exc)
                    logger.warning(
                        "同步发布文档到 SVN 失败: task=%s remote=%s err=%s",
                        job["task_name"], job["remote_url"], exc,
                    )
                results.append(entry)
        return results

    @classmethod
    def manual_push_svn(cls, task: PackageTask) -> dict[str, Any]:
        """手动将已完成的打包产物推送到 SVN。

        Args:
            task: 已完成的打包任务

        Returns:
            推送结果字典，包含 remote_url、file_count、files

        Raises:
            serializers.ValidationError: 任务状态不满足或缺少产物
            RuntimeError: SVN 配置不完整或推送失败
        """
        if task.status != "success":
            raise serializers.ValidationError({"task": "只有打包成功的任务才能推送 SVN"})
        if not task.artifact_info:
            raise serializers.ValidationError({"task": "没有可推送的产物"})

        # 确保工作区存在
        workspace_path = task.workspace_path
        if not workspace_path or not Path(workspace_path).exists():
            raise RuntimeError("任务工作区不存在，无法推送产物")
        workspace = Path(workspace_path)
        artifacts_dir = workspace / "artifacts"
        if not artifacts_dir.exists():
            raise RuntimeError("产物目录不存在，无法推送")

        # 从快照解析 SVN 配置，快照缺失 URL 时回退到配置（不把手动任务重新打开推送开关）
        snapshot = dict(task.config_snapshot or {})
        if not snapshot.get("svn_url") or not snapshot.get("svn_credential_id"):
            config = task.config
            if not config or not config.svn_push_enabled:
                raise RuntimeError("打包配置未启用 SVN 推送，无法手动推送")
            snapshot.update({
                "svn_url": config.svn_url,
                "svn_credential_id": str(config.svn_credential_id) if config.svn_credential_id else None,
                "svn_path_template": config.svn_path_template or DEFAULT_SVN_PATH_TEMPLATE,
            })
            # 只补 URL/凭证，不把 svn_push_enabled 默认打开
        task.config_snapshot = snapshot
        if not task_allows_svn_push(task):
            raise RuntimeError("仅已允许推送 SVN 的自动打包任务可以推送")

        previous_url = str(((task.stage_info or {}).get("svn_push") or {}).get("remote_url") or "")
        cls._append_log(task, "开始手动推送产物到 SVN…")
        result = cls._push_artifacts_to_svn(task, workspace)
        cls._note_svn_directory_change(task, previous_url, result["remote_url"])
        cls._append_log(
            task,
            f"SVN 推送完成: {result['remote_url']} ({result['file_count']} 个文件)",
        )

        # 更新 stage_info 记录推送结果
        stage_info = dict(task.stage_info) if task.stage_info else {}
        stage_info["svn_push"] = {"status": "success", **result}
        task.stage_info = stage_info
        task.save(update_fields=["stage_info", "config_snapshot", "updated_at"])

        return result
