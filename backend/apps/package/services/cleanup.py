"""
打包工作区清理服务

- 任务结束：删除本地工作区源码与临时目录（产物、日志保留）
- 每日 8:00：删除超过保留天数的打包产物（仅 artifacts，日志保留）
- 每日 0:00：清理远程 Windows 节点上残留的任务目录（跳过运行中任务）
"""
import logging
import shutil
from pathlib import Path, PureWindowsPath
from typing import Any

from django.conf import settings
from django.utils import timezone

from apps.credential.models import Credential
from apps.package.models import PackageNode, PackageTask
from apps.package.remote_windows import RemoteNodeError, RemoteWindowsClient, cmd_quote

logger = logging.getLogger(__name__)

# 「系统配置」页面可维护的打包产物保留天数配置键
CONFIG_KEY_RETENTION_DAYS = "package_artifact_retention_days"
DEFAULT_RETENTION_DAYS = 30


def get_artifact_retention_days() -> int:
    """读取打包产物保留天数：系统配置页面优先，环境变量兜底，非法值回退默认 30 天。"""
    from apps.system.services import SystemConfigService

    raw = SystemConfigService.get(CONFIG_KEY_RETENTION_DAYS) or str(
        getattr(settings, "PACKAGE_ARTIFACT_RETENTION_DAYS", "") or ""
    )
    try:
        days = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_RETENTION_DAYS
    return days if days > 0 else DEFAULT_RETENTION_DAYS


def cleanup_task_source(task: PackageTask, workspace: Path) -> None:
    """任务结束后删除本地工作区中的源码与临时目录（产物 artifacts、日志 logs 保留）。

    tmp 中的 svn_upload 是 artifacts 的完整副本，推送完成后同样属于冗余占用，一并删除。
    成功 / 失败 / 取消都执行；失败时构建日志仍在，不影响排查。
    """
    removed: list[str] = []
    for name in ("source", "tmp"):
        path = workspace / name
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
            if not path.exists():
                removed.append(name)
    if removed:
        from apps.package.services import PackageService

        PackageService._append_log(task, f"已清理工作区源码与临时目录（{', '.join(removed)}），产物与日志保留")


def cleanup_expired_artifacts() -> dict[str, Any]:
    """删除超过保留天数的打包产物（仅 artifacts 目录，构建日志保留）。

    删除后清空任务 artifact_info：下载列表与手动推 SVN 入口随之不可用，
    stage_info.artifacts_cleaned_at 记录清理时间供追溯。

    Returns:
        清理统计 {retention_days, cleaned, errors}
    """
    days = get_artifact_retention_days()
    cutoff = timezone.now() - timezone.timedelta(days=days)
    tasks = (
        PackageTask.objects.filter(
            status__in=("success", "failure", "canceled"),
            finished_at__lt=cutoff,
        )
        .exclude(workspace_path="")
        # 已清理过的任务 artifact_info 为空，不再重复处理
        .exclude(artifact_info=[])
        .only("id", "name", "workspace_path", "artifact_info", "stage_info")
    )

    cleaned = 0
    errors: list[str] = []
    for task in tasks:
        artifacts = Path(task.workspace_path) / "artifacts"
        try:
            if artifacts.exists():
                shutil.rmtree(artifacts)
            # 产物已删：清空产物索引，避免前端继续展示可下载/可推送的假象
            if task.artifact_info:
                stage_info = dict(task.stage_info or {})
                stage_info["artifacts_cleaned_at"] = timezone.now().isoformat()
                task.artifact_info = []
                task.stage_info = stage_info
                task.save(update_fields=["artifact_info", "stage_info", "updated_at"])
            cleaned += 1
        except Exception as exc:  # noqa: BLE001 - 单任务失败不阻塞整体清理
            errors.append(f"{task.name}: {exc}")
            logger.warning("清理过期打包产物失败: task=%s err=%s", task.id, exc)
    result = {"retention_days": days, "cleaned": cleaned, "errors": errors}
    logger.info("过期打包产物清理完成: %s", result)
    return result


def _running_task_dirs_on_node(node: PackageNode) -> set[str]:
    """该节点上仍在运行的任务对应的远程目录名（任务 id）。"""
    running_ids = PackageTask.objects.filter(
        status="running",
        config_snapshot__node_id=str(node.id),
    ).values_list("id", flat=True)
    return {str(task_id) for task_id in running_ids}


def _safe_work_root(work_root: str) -> PureWindowsPath:
    """校验节点工作根目录，拒绝盘符根目录等危险配置。

    每日清理会对 work_root 下所有子目录执行 rmdir /s /q，若节点被误配置为
    盘符根目录（如 C:\\）将删除整盘目录，必须防御。
    """
    root = (work_root or r"C:\trace-ship\workspaces").strip()
    path = PureWindowsPath(root)
    # parts 形如 ('C:\\', 'trace-ship', 'workspaces')；仅盘符根（如 'C:\\'）时长度为 1
    if len(path.parts) < 2:
        raise RemoteNodeError(f"节点工作目录配置过于危险，拒绝清理: {root}")
    return path


def _cleanup_one_node(node: PackageNode) -> dict[str, Any]:
    """清理单个节点 work_root 下的任务目录（跳过运行中任务）。

    Raises:
        RemoteNodeError: 凭证或连接问题
    """
    if not node.credential_id:
        raise RemoteNodeError("节点未配置登录凭证")
    try:
        credential = Credential.objects.get(id=node.credential_id)
    except Credential.DoesNotExist as exc:
        raise RemoteNodeError("登录凭证不存在") from exc
    if not credential.is_active:
        raise RemoteNodeError("登录凭证已停用")
    data = credential.get_data()
    username = data.get("username") or ""
    password = data.get("password") or ""
    if not username or not password:
        raise RemoteNodeError("凭证缺少用户名或密码")

    work_root = _safe_work_root(node.work_root)
    protected = _running_task_dirs_on_node(node)
    removed: list[str] = []
    with RemoteWindowsClient(host=node.host, port=int(node.port or 22), username=username, password=password) as client:
        lines: list[str] = []
        # run 合并了 stderr：work_root 不存在时 dir 输出 "File Not Found" 且退出码非零，
        # 必须按退出码判断，否则会把错误行当目录名处理
        code = client.run(f"dir /b /ad {cmd_quote(str(work_root))}", on_line=lines.append)
        if code != 0:
            return {"removed": [], "skipped": sorted(protected)}
        for name in (line.strip() for line in lines):
            if not name or name in protected:
                continue
            client.remove_dir(work_root / name)
            removed.append(name)
    return {"removed": removed, "skipped": sorted(protected)}


def cleanup_remote_node_workspaces() -> dict[str, Any]:
    """清理所有启用节点上残留的打包任务目录（每天 0 点执行）。

    节点任务目录命名约定为 {work_root}\\{task.id}；正在运行的任务目录跳过不删。
    单节点失败仅记日志，不影响其他节点。

    Returns:
        清理统计 {nodes, errors}
    """
    nodes: list[dict[str, Any]] = []
    errors: list[str] = []
    for node in PackageNode.objects.filter(is_active=True):
        try:
            result = _cleanup_one_node(node)
            nodes.append({"node": node.name, **result})
            if result["removed"]:
                logger.info("节点工作目录清理完成: node=%s removed=%s", node.name, result["removed"])
        except Exception as exc:  # noqa: BLE001 - 单节点失败不阻塞整体
            errors.append(f"{node.name}: {exc}")
            logger.warning("节点工作目录清理失败: node=%s err=%s", node.name, exc)
    return {"nodes": nodes, "errors": errors}
