"""
系统内置打包业务服务

原单文件 services.py 按职责拆分为多个 Mixin：
- base:          工作区、日志与命令执行等基础设施
- tasks:         任务创建、调度、节点并发闸门与取消
- source:        源码拉取与构建环境变量
- runner_local:  本地 Docker 打包执行与产物收集
- runner_remote: 远程节点（Windows / 麒麟 Linux）打包执行与产物回传
- svn:           产物推送 SVN 与发布文档同步
- runner:        任务主执行流程编排
- cleanup:       工作区清理（源码即删 / 产物过期 / 节点目录每日清理）
- favorites:     打包配置收藏（切换收藏与收藏列表聚合）

PackageService 组合全部 Mixin，对外接口与原单类完全一致。
"""
from apps.package.remote_kylin import RemoteKylinClient  # noqa: F401 兼容以包路径 patch 类属性
from apps.package.remote_windows import RemoteWindowsClient  # noqa: F401 兼容以包路径 patch 类属性
from apps.package.services.base import PackageBaseMixin, PackageTaskCanceledError
from apps.package.services.favorites import FavoriteMixin
from apps.package.services.runner import TaskRunnerMixin
from apps.package.services.runner_local import LocalRunnerMixin
from apps.package.services.runner_remote import RemoteRunnerMixin
from apps.package.services.source import SourceCheckoutMixin
from apps.package.services.svn import SvnPushMixin
from apps.package.services.tasks import TaskLifecycleMixin


class PackageService(
    TaskLifecycleMixin,
    SourceCheckoutMixin,
    LocalRunnerMixin,
    RemoteRunnerMixin,
    SvnPushMixin,
    TaskRunnerMixin,
    FavoriteMixin,
    PackageBaseMixin,
):
    """打包配置解析、任务创建与任务执行服务。"""


__all__ = ["PackageService", "PackageTaskCanceledError", "RemoteKylinClient", "RemoteWindowsClient"]
