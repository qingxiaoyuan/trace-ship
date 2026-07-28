"""
操作日志服务

提供业务语义化日志记录能力。
"""
from typing import Any, Dict, Optional

from apps.system.models import OperationLog, SystemConfig


class SystemConfigService:
    """系统参数读取服务，供各业务模块读取「系统配置」页面维护的 key-value。"""

    @staticmethod
    def get_many(keys: list[str]) -> dict[str, str]:
        """
        批量读取系统配置值，返回 {key: value}（不存在的键不出现）。

        数据库不可用（如迁移阶段）时返回空字典，由调用方回退默认值。
        """
        if not keys:
            return {}
        try:
            rows = SystemConfig.objects.filter(key__in=keys).values_list("key", "value")
            return dict(rows)
        except Exception:
            return {}

    @classmethod
    def get(cls, key: str, default: str = "") -> str:
        """读取单个系统配置值，不存在或异常时返回 default。"""
        return cls.get_many([key]).get(key) or default


class OperationLogService:
    """
    操作日志服务
    """

    @staticmethod
    def log(
        user,
        module: str,
        action: str,
        resource_type: str = "",
        resource_id: str = "",
        description: str = "",
        result: str = "success",
        detail: Optional[Dict[str, Any]] = None,
        ip: str = "",
    ) -> OperationLog:
        """
        记录操作日志

        Args:
            user: 操作用户
            module: 模块
            action: 动作
            resource_type: 资源类型
            resource_id: 资源 ID
            description: 操作描述
            result: 结果 success/failure
            detail: 详情字典
            ip: IP 地址

        Returns:
            OperationLog 实例
        """
        return OperationLog.objects.create(
            user=user,
            module=module,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            description=description,
            result=result,
            detail=detail or {},
            ip=ip,
        )

    @staticmethod
    def log_release(user, release, action: str, result: str = "success", detail: Optional[Dict[str, Any]] = None) -> OperationLog:
        """
        记录发布相关操作
        """
        action_map = {
            "create": "创建发布",
            "submit_audit": "提交审批",
            "approve": "审批通过",
            "reject": "审批驳回",
            "revoke": "撤销审批",
            "build": "触发构建",
            "build_success": "构建成功",
            "build_failure": "构建失败",
            "push_tag": "推 tag",
        }
        return OperationLogService.log(
            user=user,
            module="发布管理",
            action=action,
            resource_type="release_record",
            resource_id=str(release.id),
            description=f"{action_map.get(action, action)} {release.version}",
            result=result,
            detail=detail,
        )

    @staticmethod
    def log_workflow(user, task, action: str, result: str = "success", detail: Optional[Dict[str, Any]] = None) -> OperationLog:
        """
        记录审批相关操作
        """
        action_map = {
            "approve": "审批通过",
            "reject": "审批驳回",
            "transfer": "转交审批",
            "revoke": "撤销流程",
        }
        return OperationLogService.log(
            user=user,
            module="工作流审批",
            action=action,
            resource_type="workflow_task",
            resource_id=str(task.id),
            description=f"{action_map.get(action, action)} {task.instance.biz_id}",
            result=result,
            detail=detail,
        )
