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


class SvnPushMixin:
    """产物推送 SVN 与发布文档同步相关方法。"""

    @staticmethod
    def _ensure_svn_parent_dirs(provider, svn_url: str, version_dir: str) -> None:
        """svn import 不会自动创建父目录，逐级创建版本目录缺失的中间父目录。

        发布任务的版本号通常为单级（如 V1.0.0），父目录即 svn_url 本身；分支直打包
        任务的 version 即分支名（可能含斜杠，如 feature/demo），目标 releases/feature/demo
        的父目录 releases/feature 需先创建，否则 import 会因路径不存在而失败。
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
        path_template = snapshot.get("svn_path_template", "{version}")

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

        # 渲染版本目录名（支持 {release_type} 占位符区分正式/RC/测试版）
        # 说明：分支直打包任务 version/tag_name 即分支名（如 feature/1.0），
        # 默认模板 {version} 渲染后保留斜杠，会按分支层级生成嵌套 SVN 目录
        # （svn_root/feature/1.0/），这是预期行为，便于按分支组织产物。
        version_dir = path_template.format(
            version=task.version,
            tag_name=task.tag_name,
            build_type=task.build_type,
            project_code=task.project.code or task.project.name,
            release_type=task.release_type or "formal",
        ).strip("/")
        if not version_dir:
            raise RuntimeError("SVN 目录模板渲染结果为空")
        # 默认模板 {version} 下，非正式版目录自动带类型后缀，避免 rc/测试版覆盖正式版目录
        if path_template == "{version}" and task.release_type and task.release_type != "formal":
            version_dir = f"{version_dir}-{task.release_type}"
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

        # 从快照解析 SVN 配置，快照缺失时回退到配置
        snapshot = task.config_snapshot or {}
        if not snapshot.get("svn_url") or not snapshot.get("svn_credential_id"):
            config = task.config
            if not config or not config.svn_push_enabled:
                raise RuntimeError("打包配置未启用 SVN 推送，无法手动推送")
            snapshot = {
                **snapshot,
                "svn_push_enabled": True,
                "svn_url": config.svn_url,
                "svn_credential_id": str(config.svn_credential_id) if config.svn_credential_id else None,
                "svn_path_template": config.svn_path_template or "{version}",
            }
            task.config_snapshot = snapshot
        if not snapshot.get("svn_push_enabled"):
            raise RuntimeError("打包配置未启用 SVN 推送，无法手动推送")

        cls._append_log(task, "开始手动推送产物到 SVN…")
        result = cls._push_artifacts_to_svn(task, workspace)
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
