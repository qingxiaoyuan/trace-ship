"""
打包任务生命周期：创建、调度、节点并发闸门与取消
"""
import logging
import re
import threading
from datetime import timedelta
from typing import TYPE_CHECKING

from django.db import close_old_connections, transaction
from django.db.models import Avg, Count, Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from apps.package.models import PackageConfig, PackageNode, PackageTask
from apps.package.services.configurations import lock_package_config, require_shared_config
from apps.package.services.svn import (
    TRIGGER_SOURCE_AUTO_RELEASE,
    TRIGGER_SOURCE_MANUAL_BRANCH,
    TRIGGER_SOURCE_MANUAL_RELEASE,
    apply_svn_push_policy,
)
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from apps.account.models import User
    from apps.release.models import ReleaseRecord


class PackageTaskDispatchError(RuntimeError):
    """任务已提交，但所有投递方式失败；调用者仍可查看失败任务。"""

    def __init__(self, task: PackageTask) -> None:
        self.task = task
        super().__init__("打包任务投递失败，请稍后重试")


class TaskLifecycleMixin:
    """任务创建、调度与取消相关方法。"""

    @classmethod
    def _snapshot(cls, config: PackageConfig) -> dict:
        """生成配置快照，避免执行时配置变更影响历史任务。"""
        image = config.image
        node = config.node
        identity = {
            "software_name": config.software.name,
            "software_slug": config.software.slug,
        } if config.software_id else {}
        return {
            **identity,
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
            "node_arch": node.arch if node else "",
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
    @transaction.atomic
    def create_task_for_release(
        cls,
        config: PackageConfig,
        release: "ReleaseRecord",
        request_user: "User | None" = None,
        *,
        auto_triggered: bool = False,
    ) -> PackageTask:
        """为已发布版本创建打包任务。

        auto_triggered=True 表示发布推 tag 后的自动打包。自动与手动打包的
        正式版、RC / 测试版均按 SVN 总开关决定是否推送，并固定在本次任务快照中。
        """
        from apps.repository.models import Repository
        from utils.permissions import IsProjectReleasePackager

        Repository.objects.select_for_update(no_key=True).get(pk=release.repository_id)
        # 仓库锁先于配置锁；仅锁配置行，避免可空镜像/节点关联产生外连接锁错误。
        config = lock_package_config(config)
        release.refresh_from_db()
        if config.software_id:
            raise serializers.ValidationError({"config": "请选择与发布匹配的打包配置"})
        # 配置归属与成员角色可能在视图验权后变化，按锁定的当前归属重新核验。
        if not auto_triggered and (
            request_user is None
            or not request_user.is_authenticated
            or not IsProjectReleasePackager()._check(config.project_component.project, request_user)
        ):
            raise PermissionDenied("没有在当前项目补打已发布版本的权限")
        if release.status != "released":
            raise serializers.ValidationError({"release": "只有已发布版本才能触发打包"})
        if release.software_id:
            raise serializers.ValidationError({"release": "共享软件版本暂未接入打包，请使用已接入的软件打包入口"})
        if not config.is_active:
            raise serializers.ValidationError({"config": "打包配置已停用"})
        if config.project_component.repository_id != release.repository_id:
            raise serializers.ValidationError({"repository": "打包配置与发布仓库不一致"})

        if config.project_component.project_id != release.project_id:
            raise serializers.ValidationError({"project": "打包配置与发布项目不一致"})
        snapshot = apply_svn_push_policy(
            cls._snapshot(config),
            trigger_source=(
                TRIGGER_SOURCE_AUTO_RELEASE if auto_triggered else TRIGGER_SOURCE_MANUAL_RELEASE
            ),
            release_type=release.release_type or "formal",
        )
        task = PackageTask.objects.create(
            config=config,
            release=release,
            project=release.project,
            repository=release.repository,
            triggered_by=request_user,
            name=f"{config.name} / {release.version}",
            tag_name=release.tag_name,
            source_ref=release.tag_name,
            version=release.version,
            release_type=release.release_type,
            commit_hash=release.git_hash,
            config_snapshot=snapshot,
        )
        transaction.on_commit(lambda: cls._dispatch_release_task(task, auto_triggered=auto_triggered))
        return task

    @staticmethod
    def log_release_trigger(
        user: "User | None", *, config: PackageConfig | None = None,
        release: "ReleaseRecord | None" = None, task: PackageTask | None = None,
        result: str, reason: str = "",
    ) -> None:
        """只记录已授权资源的业务身份，不写入客户端参数或执行凭据。"""
        from apps.system.services import OperationLogService

        detail = {"reason": reason} if reason else {}
        if config is not None:
            detail.update({
                "config_id": str(config.id),
            })
            if config.project_component_id:
                detail["project_id"] = str(config.project_component.project_id)
        if release is not None:
            detail.update({"release_id": str(release.id), "version": release.version})
        if task is not None:
            detail.update({"task_id": str(task.id), "project_id": str(task.project_id), "status": task.status})
        OperationLogService.log(
            user=user, module="package", action="trigger_release", resource_type="package_task",
            resource_id=str(task.id) if task is not None else "",
            description="补打已发布版本" if result == "success" else "补打已发布版本失败",
            result=result, detail=detail,
        )

    @classmethod
    def _dispatch_release_task(cls, task: PackageTask, *, auto_triggered: bool) -> None:
        """提交后投递并记录真实结果，完整保留既有 Celery / 本地回退策略。"""
        try:
            cls.dispatch_task(task)
        except Exception as exc:
            logger.exception("打包任务全部投递方式失败 task_id=%s", task.id)
            task.status = "failure"
            task.error_message = "打包任务投递失败，请稍后重试"
            task.finished_at = timezone.now()
            task.stage_info = {"stage": "dispatch_failed", "progress": 0}
            task.save(update_fields=["status", "error_message", "finished_at", "stage_info", "updated_at"])
            if not auto_triggered:
                cls.log_release_trigger(
                    task.triggered_by, config=task.config, release=task.release, task=task,
                    result="failure", reason="任务投递失败",
                )
            raise PackageTaskDispatchError(task) from exc
        if not auto_triggered:
            cls.log_release_trigger(
                task.triggered_by, config=task.config, release=task.release, task=task, result="success",
            )

    @classmethod
    def create_task_for_branch(cls, config: PackageConfig, branch_name: str, request_user=None, *,
                               project=None, software_id=None) -> PackageTask:
        """在显式项目内保存共享分支任务；旧配置沿用原项目组件。"""
        from apps.project.models import Project
        from apps.repository.services import RepositoryService
        from utils.permissions import IsProjectPackager

        branch_name = (branch_name or "").strip()
        if not branch_name:
            raise serializers.ValidationError({"branch": "必须指定分支名"})
        if len(branch_name) > 100:
            raise serializers.ValidationError({"branch": "分支名过长（不能超过 100 字符）"})

        with transaction.atomic():
            config = lock_package_config(config)
            repository = config.source_repository
            if config.software_id:
                if project is None or config.software_id != software_id:
                    raise serializers.ValidationError({"software": "必须显式指定项目和配置所属软件"})
                project = Project.objects.select_for_update(no_key=True).filter(pk=project.pk).first()
                link = require_shared_config(
                    config, project=project, software=config.software,
                    user=request_user, permission=IsProjectPackager(),
                )
                project = link.project
                commit_hash = cls._shared_branch_head(repository, project, branch_name, request_user)
            else:
                if project is not None or software_id is not None:
                    raise serializers.ValidationError({"config": "此配置尚未归属共享软件"})
                project = config.project_component.project
                if request_user is not None and not IsProjectPackager()._check(project, request_user):
                    raise PermissionDenied("没有在当前项目触发打包的权限")
                if not config.is_active:
                    raise serializers.ValidationError({"config": "打包配置已停用"})
                commit_hash = ""
                try:
                    for branch in RepositoryService.list_branches(repository, request_user):
                        if branch.get("name") == branch_name:
                            commit_hash = branch.get("last_commit_hash") or ""
                            break
                except Exception:
                    logger.warning("获取旧配置的分支最新提交信息失败，忽略 branch=%s", branch_name)

            snapshot = apply_svn_push_policy(
                cls._snapshot(config), trigger_source=TRIGGER_SOURCE_MANUAL_BRANCH, release_type="formal",
            )
            task = PackageTask.objects.create(
                config=config, project=project, repository=repository,
                software_id=config.software_id, triggered_by=request_user,
                name=f"{config.name} / {branch_name}"[:200],
                tag_name=branch_name, source_ref=branch_name if config.software_id else "",
                version=branch_name, release_type="formal", commit_hash=commit_hash,
                config_snapshot=snapshot,
            )
            if config.software_id:
                transaction.on_commit(lambda: cls._dispatch_release_task(task, auto_triggered=True))
        if not config.software_id:
            cls.dispatch_task(task)
        return task

    @staticmethod
    def _shared_branch_head(repository, project, branch_name, user) -> str:
        from apps.repository.services import RepositoryService

        try:
            credential = resolve_credential(repository, user, project=project, operation="read")
            provider = get_provider(repository.vendor, RepositoryService._resolve_server_url(repository), credential)
            branch = provider.get_branch(repository.external_identity, branch_name)
        except ProviderError as exc:
            raise serializers.ValidationError({"branch": "无法核验分支和仓库凭证，请检查配置后重试"}) from exc
        if branch.name != branch_name or not re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", branch.last_commit_hash or ""):
            raise serializers.ValidationError({"branch": "分支缺少有效的完整提交"})
        return branch.last_commit_hash

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
            project_component__project=release.project,
            project_component__repository=release.repository,
            auto_package_on_release=True,
            is_active=True,
        ).select_related(
            "project_component__project", "project_component__repository", "image", "node"
        )
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
            tasks.append(
                cls.create_task_for_release(
                    config, release, request_user=request_user, auto_triggered=True
                )
            )
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

    @staticmethod
    def my_task_stats(user, days_raw=None) -> dict:
        """当前用户发起的打包任务统计（工作台口径）。

        只统计本人触发且已结束（success / failure / canceled）的任务，
        时间窗口为最近 days 天（默认 30，合法范围 1-365，非法值回默认）。
        avg_duration_seconds 取有耗时（duration > 0）任务的均值，单位秒。
        """
        try:
            days = int(days_raw)
        except (TypeError, ValueError):
            days = 30
        if not 1 <= days <= 365:
            days = 30

        from apps.project.services import visible_project_ids

        since = timezone.now() - timedelta(days=days)
        queryset = PackageTask.objects.filter(
            triggered_by=user,
            project_id__in=visible_project_ids(user),
            status__in=("success", "failure", "canceled"),
            created_at__gte=since,
        )
        agg = queryset.aggregate(
            total=Count("id"),
            success=Count("id", filter=Q(status="success")),
            failure=Count("id", filter=Q(status="failure")),
            canceled=Count("id", filter=Q(status="canceled")),
            avg_duration=Avg("duration", filter=Q(duration__gt=0)),
        )
        total = agg["total"]
        success = agg["success"]
        success_rate = round(success / total * 100, 1) if total else 0
        avg_duration_seconds = int(round(agg["avg_duration"] / 1000)) if agg["avg_duration"] else 0
        return {
            "days": days,
            "total": total,
            "success": success,
            "failure": agg["failure"],
            "canceled": agg["canceled"],
            "success_rate": success_rate,
            "avg_duration_seconds": avg_duration_seconds,
        }
