"""
打包任务主执行流程编排
"""
import logging
from typing import Any

from django.utils import timezone

from apps.package.models import PackageTask
from apps.package.remote_windows import RemoteWindowsClient
from apps.package.services.base import PackageTaskCanceledError

logger = logging.getLogger(__name__)


class TaskRunnerMixin:
    """打包任务主流程：拉源码 → 构建 → 收集产物 → 推送 SVN。"""

    @classmethod
    def run_task(cls, task: PackageTask) -> PackageTask:
        """执行打包任务。"""
        if task.is_finished:
            return task
        started = timezone.now()
        task.status = "running"
        task.started_at = started
        task.progress = 0
        task.stage_info = {"stage": "checkout", "progress": 5}
        task.save(update_fields=["status", "started_at", "progress", "stage_info", "updated_at"])
        workspace = cls.prepare_workspace(task)
        snapshot = task.config_snapshot or {}
        svn_push_enabled = bool(snapshot.get("svn_push_enabled"))
        executor_type = snapshot.get("executor_type") or "local_docker"
        # 远程执行全程复用同一条 SSH 连接：分阶段建连在并发/节点繁忙时
        # 容易在握手阶段被 Windows OpenSSH 断开（No existing session）
        remote_client: RemoteWindowsClient | None = None
        try:
            cls._append_log(task, f"开始打包 {task.version} ({task.tag_name})")
            cls._update_stage(task, "checkout", 5, "正在拉取源码…")
            if executor_type == "remote_windows":
                remote_client = RemoteWindowsClient.from_snapshot(snapshot)
                remote_client.connect()
                cls._checkout_source_remote(task, remote_client)
            else:
                cls._checkout_source(task, workspace)
            cls._ensure_task_not_canceled(task)
            build_progress = 25 if svn_push_enabled else 30
            cls._update_stage(task, "build", build_progress, "开始执行打包…")
            artifacts_progress = 65 if svn_push_enabled else 80
            if executor_type == "remote_windows":
                try:
                    cls._run_remote_build(task, remote_client)
                finally:
                    # 构建结束即回收节点工作副本中的 Git 认证头（脚本 push 仅发生在构建期）
                    cls._revoke_remote_git_credential(task, remote_client)
                cls._ensure_task_not_canceled(task)
                cls._update_stage(task, "artifacts", artifacts_progress, "正在回传产物…")
                if snapshot.get("auto_collect_output"):
                    cls._collect_output_remote(task, remote_client)
                cls._collect_remote_artifacts(task, workspace, remote_client)
            else:
                cls._run_container(task, workspace)
                cls._ensure_task_not_canceled(task)
                cls._update_stage(task, "artifacts", artifacts_progress, "正在扫描产物…")
                if snapshot.get("auto_collect_output"):
                    cls._collect_output_local(task, workspace)
            task.artifact_info = cls._scan_artifacts(workspace)
            if not task.artifact_info:
                cls._append_log(
                    task,
                    "警告：未扫描到任何打包产物，请检查产物目录配置或打包脚本输出路径",
                )
            cls._ensure_task_not_canceled(task)

            # SVN 推送阶段
            svn_push_result: dict[str, Any] | None = None
            if svn_push_enabled:
                cls._update_stage(task, "svn_push", 90, "正在推送产物到 SVN…")
                try:
                    result = cls._push_artifacts_to_svn(task, workspace)
                except PackageTaskCanceledError:
                    raise
                except Exception as exc:
                    # SVN 是打包完成后的附加交付动作，失败不应覆盖构建成功结果。
                    svn_push_result = {"status": "failure", "error_message": str(exc)}
                    cls._append_log(task, f"警告：打包成功，但 SVN 推送失败: {exc}")
                else:
                    svn_push_result = {"status": "success", **result}
                    cls._append_log(
                        task,
                        f"SVN 推送完成: {result['remote_url']}"
                        f" ({result['file_count']} 个文件)",
                    )

            task.status = "success"
            task.progress = 100
            done_info: dict[str, Any] = {"stage": "done", "progress": 100}
            if svn_push_result:
                done_info["svn_push"] = svn_push_result
            task.stage_info = done_info
            task.error_message = ""
            cls._append_log(task, "打包完成")
        except PackageTaskCanceledError:
            task.refresh_from_db(fields=["status", "progress", "stage_info", "finished_at", "duration", "updated_at"])
            task.error_message = ""
        except Exception as exc:
            task.status = "failure"
            task.error_message = str(exc)
            cls._append_log(task, f"打包失败: {exc}")
        finally:
            if remote_client is not None:
                # 失败/取消时成功路径的远程目录清理不会执行，在此兜底回收；
                # cleanup_workspace 关闭（调试保留）时跳过，由每日 0 点定时清理兜底
                if task.status in ("failure", "canceled") and snapshot.get("cleanup_workspace", True):
                    try:
                        remote_client.remove_dir(cls._remote_workspace(task))
                        cls._append_log(task, "任务未成功，已清理远程节点工作目录")
                    except Exception as exc:
                        logger.warning("清理远程工作目录失败 task=%s err=%s", task.id, exc)
                remote_client.close()
            # 任务结束即删本地源码与临时目录（成功/失败/取消都删），产物与日志保留
            try:
                from apps.package.services.cleanup import cleanup_task_source

                cleanup_task_source(task, workspace)
            except Exception:
                logger.exception("清理本地工作区源码失败 task=%s", task.id)
            finished = timezone.now()
            task.finished_at = finished
            task.duration = int((finished - started).total_seconds() * 1000)
            task.save(update_fields=[
                "status", "progress", "stage_info", "artifact_info", "error_message", "finished_at",
                "duration", "updated_at",
            ])
            try:
                from apps.notification.services import NotificationService

                NotificationService.notify_package_result(task, task.release)
            except Exception:
                pass
        return task
