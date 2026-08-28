"""
打包任务生命周期：创建、调度、节点并发闸门与取消
"""
import logging
import threading

from django.db import close_old_connections
from django.utils import timezone
from rest_framework import serializers

from apps.package.models import PackageConfig, PackageNode, PackageTask

logger = logging.getLogger(__name__)


class TaskLifecycleMixin:
    """任务创建、调度与取消相关方法。"""

    @classmethod
    def _snapshot(cls, config: PackageConfig) -> dict:
        """生成配置快照，避免执行时配置变更影响历史任务。"""
        image = config.image
        node = config.node
        return {
            "config_id": str(config.id),
            "name": config.name,
            "executor_type": config.executor_type or "local_docker",
            "image": image.image if image else "",
            "image_name": image.name if image else "",
            "script_entry": image.script_entry if image else "",
            "node_id": str(node.id) if node else None,
            "node_name": node.name if node else "",
            "node_host": node.host if node else "",
            "node_port": node.port if node else 22,
            "node_os_type": node.os_type if node else "",
            "node_work_root": node.work_root if node else "",
            "node_credential_id": str(node.credential_id) if node and node.credential_id else None,
            # 资源限制生效值：配置级优先，未设置（0/空串）时跟随节点；内存上限仅配置级
            "cpu_cores": config.cpu_cores or (node.cpu_cores if node else 0),
            "cpu_priority": config.cpu_priority
            or (node.cpu_priority if node else "")
            or "belownormal",
            "mem_limit_mb": config.mem_limit_mb or 0,
            "custom_script": config.custom_script,
            "build_path": cls._safe_rel_path(
                config.build_path,
                image.default_build_path if image else ".",
            ),
            "output_path": cls._safe_rel_path(
                config.output_path,
                image.default_output_path if image else "artifacts",
            ),
            "auto_collect_output": bool(config.auto_collect_output),
            "auto_compress": bool(config.auto_compress),
            "cleanup_workspace": config.cleanup_workspace,
            "env_vars": config.env_vars or {},
            "svn_push_enabled": config.svn_push_enabled,
            "svn_url": config.svn_url or "",
            "svn_credential_id": str(config.svn_credential_id) if config.svn_credential_id else None,
            "svn_path_template": config.svn_path_template or "{version}",
            "svn_commit_mode": config.svn_commit_mode or "new_dir",
            "clone_submodules": bool(config.clone_submodules),
            "inject_git_credential": bool(config.inject_git_credential),
        }

    @classmethod
    def create_task_for_release(cls, config: PackageConfig, release, request_user=None) -> PackageTask:
        """为已发布版本创建打包任务。"""
        if release.status != "released":
            raise serializers.ValidationError({"release": "只有已发布版本才能触发打包"})
        if not config.is_active:
            raise serializers.ValidationError({"config": "打包配置已停用"})
        if config.repository_id != release.repository_id:
            raise serializers.ValidationError({"repository": "打包配置与发布仓库不一致"})

        snapshot = cls._snapshot(config)
        task = PackageTask.objects.create(
            config=config,
            release=release,
            project=release.project,
            repository=release.repository,
            triggered_by=request_user,
            name=f"{config.name} / {release.version}",
            tag_name=release.tag_name,
            version=release.version,
            release_type=release.release_type,
            commit_hash=release.git_hash,
            config_snapshot=snapshot,
        )
        cls.dispatch_task(task)
        return task

    @classmethod
    def create_task_for_branch(cls, config: PackageConfig, branch_name: str, request_user=None) -> PackageTask:
        """直接对仓库某条分支的最新代码创建打包任务（不经发布流程）。

        任务标题与自动编码（version）均按分支名命名，便于在打包看板中识别来源；
        克隆源码时以 ``git clone --branch {branch}`` 拉取该分支最新代码。

        Args:
            config: 打包配置
            branch_name: 仓库分支名（Git 分支最新代码）
            request_user: 触发人

        Returns:
            已投递的打包任务
        """
        if not config.is_active:
            raise serializers.ValidationError({"config": "打包配置已停用"})
        branch_name = (branch_name or "").strip()
        if not branch_name:
            raise serializers.ValidationError({"branch": "必须指定分支名"})
        if len(branch_name) > 100:
            raise serializers.ValidationError({"branch": "分支名过长（不能超过 100 字符）"})

        snapshot = cls._snapshot(config)
        # 分支最新提交哈希仅用于可追溯展示；拉取失败降级为空串，不阻断打包
        commit_hash = ""
        try:
            from apps.repository.services import RepositoryService

            for branch in RepositoryService.list_branches(config.repository, request_user):
                if branch.get("name") == branch_name:
                    commit_hash = branch.get("last_commit_hash") or ""
                    break
        except Exception:
            logger.warning("获取分支最新提交信息失败，忽略 branch=%s", branch_name)

        task = PackageTask.objects.create(
            config=config,
            release=None,
            project=config.project,
            repository=config.repository,
            triggered_by=request_user,
            name=f"{config.name} / {branch_name}",
            tag_name=branch_name,
            version=branch_name,
            release_type="formal",
            commit_hash=commit_hash,
            config_snapshot=snapshot,
        )
        cls.dispatch_task(task)
        return task

    @classmethod
    def dispatch_task(cls, task: PackageTask) -> None:
        """投递打包任务；Celery 不可用时降级为本进程后台执行。"""
        from apps.package.tasks import run_package_task

        try:
            run_package_task.delay(str(task.id))
        except Exception as exc:
            logger.warning("Celery 投递失败，改用本地后台线程执行打包 task_id=%s error=%s", task.id, exc)
            cls._start_local_worker(str(task.id), str(exc))

    # 节点并发占满时的重投间隔（秒）
    NODE_WAIT_RETRY_SECONDS = 30

    @classmethod
    def node_slot_available(cls, task: PackageTask) -> tuple[bool, int, int]:
        """检查远程节点是否有空闲并发槽位。

        Returns:
            (available, running_count, max_concurrency)；
            本地 Docker 任务、未绑定节点的任务、节点已删除的兜底场景直接放行。
        """
        snapshot = task.config_snapshot or {}
        if (snapshot.get("executor_type") or "local_docker") != "remote_node":
            return True, 0, 0
        node_id = snapshot.get("node_id")
        if not node_id:
            return True, 0, 0
        try:
            node = PackageNode.objects.get(id=node_id)
            max_concurrency = max(1, node.max_concurrency or 1)
        except PackageNode.DoesNotExist:
            max_concurrency = 1
        running = (
            PackageTask.objects.filter(status="running", config_snapshot__node_id=str(node_id))
            .exclude(id=task.id)
            .count()
        )
        return running < max_concurrency, running, max_concurrency

    @classmethod
    def run_task_with_gate(cls, task: PackageTask) -> None:
        """带节点并发闸门的任务入口：无空闲槽位时保持排队并延迟重投。"""
        if task.is_finished:
            return
        available, running, max_concurrency = cls.node_slot_available(task)
        if available:
            cls.run_task(task)
            return
        # 排队等待：写日志与阶段标记，延迟后重新投递（不直接失败）
        if not task.workspace_path:
            cls.prepare_workspace(task)
        task.stage_info = {
            "stage": "waiting_node",
            "progress": 0,
            "running": running,
            "max_concurrency": max_concurrency,
        }
        task.save(update_fields=["stage_info", "updated_at"])
        cls._append_log(task, f"节点并发已满（{running}/{max_concurrency}），排队等待空闲槽位…")
        cls._redispatch_delayed(task)

    @classmethod
    def _redispatch_delayed(cls, task: PackageTask) -> None:
        """延迟重投任务；Celery 不可用时用后台线程等待后重试。"""
        from apps.package.tasks import run_package_task

        try:
            run_package_task.apply_async(
                args=[str(task.id)], countdown=cls.NODE_WAIT_RETRY_SECONDS,
            )
        except Exception as exc:
            logger.warning("Celery 延迟重投失败，改用本地后台线程等待 task_id=%s error=%s", task.id, exc)
            cls._start_local_worker(str(task.id), delay=cls.NODE_WAIT_RETRY_SECONDS)

    @classmethod
    def _start_local_worker(cls, task_id: str, reason: str = "", delay: int = 0) -> None:
        """在当前后端进程中启动后台线程执行打包任务。"""

        def runner() -> None:
            if delay > 0:
                threading.Event().wait(delay)
            close_old_connections()
            try:
                task = PackageTask.objects.select_related(
                    "config", "release", "project", "repository", "triggered_by",
                ).get(id=task_id)
                if reason:
                    cls.prepare_workspace(task)
                    cls._append_log(task, f"Celery 不可用，已降级为本地后台执行: {reason}")
                cls.run_task_with_gate(task)
            except PackageTask.DoesNotExist:
                logger.warning("本地后台执行打包时任务不存在 task_id=%s", task_id)
            except Exception:
                logger.exception("本地后台执行打包异常 task_id=%s", task_id)
            finally:
                close_old_connections()

        thread = threading.Thread(target=runner, name=f"package-task-{task_id}", daemon=True)
        thread.start()

    @classmethod
    def trigger_auto_packages_for_release(cls, release, request_user=None) -> list[PackageTask]:
        """发布推 tag 成功后触发同仓库启用的自动打包配置。

        优先按创建发布时勾选的配置（快照）触发；未显式选择（None）时兼容历史逻辑，
        触发该仓库全部启用的自动打包配置。
        """
        configs = PackageConfig.objects.filter(
            repository=release.repository,
            auto_package_on_release=True,
            is_active=True,
        ).select_related("project", "repository", "image", "node")
        selected = release.package_config_ids
        if selected is not None:
            from uuid import UUID

            # 显式选择过：仅触发勾选且仍有效/同仓库的配置（[] 为空即不触发）
            # 防御性过滤：数据被手工篡改/损坏时忽略非法 id，避免查询层抛异常
            valid_ids: list[str] = []
            for value in selected:
                try:
                    UUID(str(value))
                except (ValueError, TypeError, AttributeError):
                    continue
                valid_ids.append(str(value))
            configs = configs.filter(id__in=valid_ids)
        tasks = []
        for config in configs:
            tasks.append(cls.create_task_for_release(config, release, request_user=request_user))
        return tasks

    @classmethod
    def cancel_task(cls, task: PackageTask) -> PackageTask:
        """取消排队中或进行中的打包任务。"""
        if task.is_finished:
            return task
        now = timezone.now()
        task.status = "canceled"
        task.progress = 0
        task.stage_info = {"stage": "canceled", "progress": 0}
        task.finished_at = now
        if task.started_at and not task.duration:
            task.duration = int((now - task.started_at).total_seconds() * 1000)
        cls._append_log(task, "任务已被用户取消")
        task.save(update_fields=[
            "status", "progress", "stage_info", "finished_at", "duration", "updated_at",
        ])
        return task
