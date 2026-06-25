"""
工作流引擎服务

提供串行审批流程的创建、推进、审批、驳回、转交、撤销能力。
"""
from typing import List, Optional

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.account.models import User
from apps.notification.services import NotificationService
from apps.project.models import Project, ProjectMember
from apps.system.services import OperationLogService
from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask


class WorkflowEngine:
    """
    工作流引擎

    基于 LogicFlow graph_data 解析串行审批节点，驱动实例状态流转。
    """

    APPROVAL_NODE_TYPE = "approval-node"
    START_NODE_TYPE = "start-node"
    END_NODE_TYPE = "end-node"

    @classmethod
    def create_instance(
        cls,
        definition: WorkflowDefinition,
        biz_type: str,
        biz_id: str,
        user,
    ) -> WorkflowInstance:
        """
        根据定义创建实例并生成第一个审批任务

        Args:
            definition: 工作流定义
            biz_type: 业务类型
            biz_id: 业务单据 ID
            user: 发起人

        Returns:
            WorkflowInstance 实例

        Raises:
            serializers.ValidationError: 流程图中没有审批节点时抛出
        """
        with transaction.atomic():
            instance = WorkflowInstance.objects.create(
                definition=definition,
                biz_type=biz_type,
                biz_id=biz_id,
                status="running",
                graph_data=definition.graph_data,
                node_status={},
                created_by=user,
            )
            first_node = cls._find_first_approval_node(definition.graph_data)
            if not first_node:
                raise serializers.ValidationError({"graph_data": "流程定义中未找到审批节点"})

            instance.current_node_id = first_node["id"]
            instance.save(update_fields=["current_node_id"])

            approvers = cls._resolve_approvers(first_node, definition.project, instance)
            if not approvers:
                raise serializers.ValidationError(
                    {"graph_data": f"节点 {first_node.get('text')} 未解析到有效审批人"}
                )

            # 串行审批：每个节点只创建一个任务给第一个审批人
            task = WorkflowTask.objects.create(
                instance=instance,
                node_id=first_node["id"],
                node_name=cls._node_name(first_node),
                approver=approvers[0],
            )
            NotificationService.notify_task_created(task)
            return instance

    @classmethod
    def process_task(
        cls,
        task: WorkflowTask,
        action: str,
        comment: str = "",
        to_user: Optional[User] = None,
    ) -> WorkflowInstance:
        """
        处理审批任务

        Args:
            task: 审批任务
            action: approve / reject / transfer
            comment: 审批意见
            to_user: 转交目标用户

        Returns:
            关联的 WorkflowInstance

        Raises:
            serializers.ValidationError: 非法操作或实例已结束时抛出
        """
        if task.status != "pending":
            raise serializers.ValidationError({"task": "该任务已处理"})

        instance = task.instance
        if instance.status != "running":
            raise serializers.ValidationError({"instance": "流程实例已结束"})

        now = timezone.now()

        with transaction.atomic():
            if action == "approve":
                task.status = "approved"
                task.comment = comment
                task.action_time = now
                task.save(update_fields=["status", "comment", "action_time", "updated_at"])
                cls._advance(instance, task.node_id)
                if instance.status == "completed":
                    NotificationService.notify_task_approved(task, comment)
                OperationLogService.log_workflow(
                    user=task.approver,
                    task=task,
                    action="approve",
                    detail={"comment": comment, "instance_status": instance.status},
                )
            elif action == "reject":
                task.status = "rejected"
                task.comment = comment
                task.action_time = now
                task.save(update_fields=["status", "comment", "action_time", "updated_at"])
                cls._finish_instance(instance, "rejected")
                NotificationService.notify_task_rejected(task, comment)
                OperationLogService.log_workflow(
                    user=task.approver,
                    task=task,
                    action="reject",
                    detail={"comment": comment},
                )
            elif action == "transfer":
                if not to_user:
                    raise serializers.ValidationError({"to_user": "转交时必须指定目标用户"})
                task.status = "transferred"
                task.comment = comment
                task.action_time = now
                task.save(update_fields=["status", "comment", "action_time", "updated_at"])
                new_task = WorkflowTask.objects.create(
                    instance=instance,
                    node_id=task.node_id,
                    node_name=task.node_name,
                    approver=to_user,
                    transferred_from=task.approver,
                )
                NotificationService.notify_task_created(new_task)
                OperationLogService.log_workflow(
                    user=task.approver,
                    task=task,
                    action="transfer",
                    detail={"comment": comment, "to_user_id": str(to_user.id)},
                )
            else:
                raise serializers.ValidationError({"action": "不支持的审批动作"})

        return instance

    @classmethod
    def revoke_instance(cls, instance: WorkflowInstance, user) -> WorkflowInstance:
        """
        发起人撤销流程实例

        Args:
            instance: 流程实例
            user: 当前用户

        Returns:
            WorkflowInstance
        """
        if instance.status != "running":
            raise serializers.ValidationError({"instance": "流程实例已结束，无法撤销"})
        if instance.created_by_id != user.id:
            raise serializers.ValidationError({"instance": "仅发起人可撤销"})
        cls._finish_instance(instance, "revoked")
        OperationLogService.log(
            user=user,
            module="工作流审批",
            action="revoke",
            resource_type="workflow_instance",
            resource_id=str(instance.id),
            description=f"撤销流程实例 {instance.biz_id}",
        )
        return instance

    @classmethod
    def _advance(cls, instance: WorkflowInstance, current_node_id: str) -> None:
        """
        从当前节点推进到下一个审批节点

        Args:
            instance: 流程实例
            current_node_id: 当前节点 ID
        """
        graph_data = instance.graph_data
        next_node = cls._find_next_approval_node(graph_data, current_node_id)

        if not next_node:
            # 无后续审批节点，流程完成
            cls._finish_instance(instance, "completed")
            return

        instance.current_node_id = next_node["id"]
        node_status = instance.node_status or {}
        node_status[current_node_id] = "approved"
        instance.node_status = node_status
        instance.save(update_fields=["current_node_id", "node_status", "updated_at"])

        approvers = cls._resolve_approvers(next_node, instance.definition.project, instance)
        if not approvers:
            raise serializers.ValidationError(
                {"graph_data": f"节点 {next_node.get('text')} 未解析到有效审批人"}
            )

        new_task = WorkflowTask.objects.create(
            instance=instance,
            node_id=next_node["id"],
            node_name=cls._node_name(next_node),
            approver=approvers[0],
        )
        NotificationService.notify_task_created(new_task)

    @classmethod
    def _finish_instance(cls, instance: WorkflowInstance, status: str) -> None:
        """
        结束流程实例

        Args:
            instance: 流程实例
            status: completed / rejected / revoked
        """
        instance.status = status
        instance.completed_at = timezone.now()
        instance.save(update_fields=["status", "completed_at", "updated_at"])

    @classmethod
    def _find_first_approval_node(cls, graph_data: dict) -> Optional[dict]:
        """
        查找开始节点后的第一个审批节点

        Args:
            graph_data: 流程图数据

        Returns:
            第一个审批节点字典或 None
        """
        nodes = {n["id"]: n for n in graph_data.get("nodes", [])}
        start_node_id = None
        for node in graph_data.get("nodes", []):
            if node.get("type") == cls.START_NODE_TYPE:
                start_node_id = node["id"]
                break
        if not start_node_id:
            # 如果没有开始节点，取第一个审批节点
            for node in graph_data.get("nodes", []):
                if node.get("type") == cls.APPROVAL_NODE_TYPE:
                    return node
            return None

        current_id = start_node_id
        visited = set()
        edges = graph_data.get("edges", [])
        while current_id and current_id not in visited:
            visited.add(current_id)
            next_id = cls._find_next_node_id(edges, current_id)
            if not next_id:
                return None
            node = nodes.get(next_id)
            if node and node.get("type") == cls.APPROVAL_NODE_TYPE:
                return node
            current_id = next_id
        return None

    @classmethod
    def _find_next_approval_node(cls, graph_data: dict, current_node_id: str) -> Optional[dict]:
        """
        查找当前审批节点的下一个审批节点

        Args:
            graph_data: 流程图数据
            current_node_id: 当前节点 ID

        Returns:
            下一个审批节点字典或 None
        """
        nodes = {n["id"]: n for n in graph_data.get("nodes", [])}
        edges = graph_data.get("edges", [])
        current_id = current_node_id
        visited = set()
        while current_id and current_id not in visited:
            visited.add(current_id)
            next_id = cls._find_next_node_id(edges, current_id)
            if not next_id:
                return None
            node = nodes.get(next_id)
            if node and node.get("type") == cls.APPROVAL_NODE_TYPE:
                return node
            if node and node.get("type") == cls.END_NODE_TYPE:
                return None
            current_id = next_id
        return None

    @staticmethod
    def _find_next_node_id(edges: List[dict], current_node_id: str) -> Optional[str]:
        """
        查找当前节点的下一个节点 ID

        Args:
            edges: 边列表
            current_node_id: 当前节点 ID

        Returns:
            下一个节点 ID 或 None
        """
        for edge in edges:
            source = edge.get("sourceNodeId") or edge.get("source")
            target = edge.get("targetNodeId") or edge.get("target")
            if source == current_node_id:
                return target
        return None

    @classmethod
    def _resolve_approvers(
        cls,
        node: dict,
        project: Project,
        instance: WorkflowInstance,
    ) -> List[User]:
        """
        解析节点审批人

        Args:
            node: 节点字典
            project: 所属项目
            instance: 流程实例

        Returns:
            User 列表
        """
        properties = node.get("properties", {})
        approver_type = properties.get("approver_type", "leader")

        if approver_type == "leader":
            if project.leader:
                return [project.leader]
            return []

        if approver_type == "role":
            role = properties.get("role", "")
            members = ProjectMember.objects.filter(
                project=project,
                role=role,
            ).select_related("user")
            return [m.user for m in members]

        if approver_type == "user":
            user_id = properties.get("user_id")
            if not user_id:
                return []
            user = User.objects.filter(id=user_id).first()
            return [user] if user else []

        if approver_type == "self":
            # 发起人自己审批
            if instance.created_by:
                return [instance.created_by]
            return []

        return []

    @staticmethod
    def _node_name(node: dict) -> str:
        """
        获取节点展示名称

        Args:
            node: 节点字典

        Returns:
            节点名称
        """
        text = node.get("text") or {}
        if isinstance(text, dict):
            return text.get("value", node.get("id", ""))
        return text or node.get("id", "")
