"""
工作流引擎服务

提供基于审批链的串行审批流程的创建、推进、审批、驳回、转交、回退、撤销能力。
支持节点或签（any）与会签（all）模式。
"""
from typing import Any, Dict, List, Optional

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

    基于 WorkflowDefinition.node_config 审批链驱动实例状态流转，
    同时根据 node_config 自动生成 LogicFlow graph_data 用于只读流程图渲染。
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
        根据定义创建实例并生成第一个审批节点的任务

        Args:
            definition: 工作流定义
            biz_type: 业务类型
            biz_id: 业务单据 ID
            user: 发起人

        Returns:
            WorkflowInstance 实例

        Raises:
            serializers.ValidationError: 审批链为空或未解析到审批人时抛出
        """
        node_config = definition.node_config or []
        if not node_config:
            raise serializers.ValidationError({"node_config": "流程定义中未配置审批节点"})

        graph_data = cls._build_graph_data(node_config)

        with transaction.atomic():
            instance = WorkflowInstance.objects.create(
                definition=definition,
                biz_type=biz_type,
                biz_id=biz_id,
                status="running",
                graph_data=graph_data,
                node_status={},
                created_by=user,
            )

            first_node = node_config[0]
            instance.current_node_id = first_node["node_id"]
            instance.save(update_fields=["current_node_id"])

            cls._create_node_tasks(instance, first_node, graph_data)
            return instance

    @classmethod
    def process_task(
        cls,
        task: WorkflowTask,
        action: str,
        comment: str = "",
        to_user: Optional[User] = None,
        rollback_target: Optional[str] = None,
    ) -> WorkflowInstance:
        """
        处理审批任务

        Args:
            task: 审批任务
            action: approve / reject / transfer / rollback
            comment: 审批意见
            to_user: 转交目标用户
            rollback_target: 回退目标节点 ID，默认回退到上一节点

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
                cls._handle_approve(task, comment, now)
            elif action == "reject":
                cls._handle_reject(task, comment, now)
            elif action == "transfer":
                cls._handle_transfer(task, comment, to_user, now)
            elif action == "rollback":
                cls._handle_rollback(task, comment, rollback_target, now)
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
    def _handle_approve(cls, task: WorkflowTask, comment: str, now) -> None:
        """
        处理通过动作

        或签：任一审批人通过即推进到下一节点。
        会签：所有审批人通过才推进到下一节点。
        """
        instance = task.instance
        task.status = "approved"
        task.comment = comment
        task.action_time = now
        task.save(update_fields=["status", "comment", "action_time", "updated_at"])

        node_id = task.node_id

        if task.mode == "any":
            # 或签：当前审批人通过后，将同节点其他 pending 任务标记为 approved
            WorkflowTask.objects.filter(
                instance=instance,
                node_id=node_id,
                status="pending",
            ).exclude(id=task.id).update(
                status="approved",
                action_time=now,
            )
            cls._advance(instance, node_id)
        else:
            # 会签：检查是否全部通过
            pending_count = WorkflowTask.objects.filter(
                instance=instance,
                node_id=node_id,
                status="pending",
            ).count()
            if pending_count == 0:
                cls._advance(instance, node_id)

        if instance.status == "completed":
            NotificationService.notify_task_approved(task, comment)
        OperationLogService.log_workflow(
            user=task.approver,
            task=task,
            action="approve",
            detail={"comment": comment, "instance_status": instance.status},
        )

    @classmethod
    def _handle_reject(cls, task: WorkflowTask, comment: str, now) -> None:
        """处理驳回动作"""
        instance = task.instance
        task.status = "rejected"
        task.comment = comment
        task.action_time = now
        task.save(update_fields=["status", "comment", "action_time", "updated_at"])

        # 会签场景下，其他 pending 任务一并标记为 rejected
        WorkflowTask.objects.filter(
            instance=instance,
            node_id=task.node_id,
            status="pending",
        ).exclude(id=task.id).update(
            status="rejected",
            action_time=now,
        )

        cls._finish_instance(instance, "rejected")
        NotificationService.notify_task_rejected(task, comment)
        OperationLogService.log_workflow(
            user=task.approver,
            task=task,
            action="reject",
            detail={"comment": comment},
        )

    @classmethod
    def _handle_transfer(
        cls,
        task: WorkflowTask,
        comment: str,
        to_user: Optional[User],
        now,
    ) -> None:
        """处理转交动作"""
        if not to_user:
            raise serializers.ValidationError({"to_user": "转交时必须指定目标用户"})

        instance = task.instance
        task.status = "transferred"
        task.comment = comment
        task.action_time = now
        task.save(update_fields=["status", "comment", "action_time", "updated_at"])

        new_task = WorkflowTask.objects.create(
            instance=instance,
            node_id=task.node_id,
            node_name=task.node_name,
            approver=to_user,
            mode=task.mode,
            transferred_from=task.approver,
        )
        NotificationService.notify_task_created(new_task)
        OperationLogService.log_workflow(
            user=task.approver,
            task=task,
            action="transfer",
            detail={"comment": comment, "to_user_id": str(to_user.id)},
        )

    @classmethod
    def _handle_rollback(
        cls,
        task: WorkflowTask,
        comment: str,
        rollback_target: Optional[str],
        now,
    ) -> None:
        """
        处理回退动作

        默认回退到上一审批节点；若指定 rollback_target 且合法，则回退到目标节点。
        回退后流程状态仍为 running，目标节点重新生成 pending 任务。
        """
        instance = task.instance
        node_config = instance.definition.node_config or []
        node_ids = [n["node_id"] for n in node_config]

        if task.node_id not in node_ids:
            raise serializers.ValidationError({"task": "当前任务节点不在审批链中"})

        current_idx = node_ids.index(task.node_id)
        if current_idx <= 0:
            raise serializers.ValidationError({"task": "当前节点已是第一个审批节点，无法回退"})

        if rollback_target and rollback_target in node_ids:
            target_idx = node_ids.index(rollback_target)
        else:
            target_idx = current_idx - 1

        if target_idx < 0 or target_idx >= current_idx:
            raise serializers.ValidationError({"task": "无效的回退目标节点"})

        target_node_id = node_ids[target_idx]
        target_node = node_config[target_idx]

        task.status = "rollbacked"
        task.comment = comment
        task.action_time = now
        task.rollback_target_node_id = target_node_id
        task.save(update_fields=["status", "comment", "action_time", "rollback_target_node_id", "updated_at"])

        # 同节点其他 pending 任务也标记为 rollbacked
        WorkflowTask.objects.filter(
            instance=instance,
            node_id=task.node_id,
            status="pending",
        ).exclude(id=task.id).update(
            status="rollbacked",
            action_time=now,
            rollback_target_node_id=target_node_id,
        )

        # 更新实例当前节点，并清除目标节点及之后节点的状态快照
        instance.current_node_id = target_node_id
        node_status = instance.node_status or {}
        for idx in range(target_idx, len(node_ids)):
            nid = node_ids[idx]
            node_status.pop(nid, None)
        instance.node_status = node_status
        instance.save(update_fields=["current_node_id", "node_status", "updated_at"])

        # 为目标节点重新创建 pending 任务
        cls._create_node_tasks(instance, target_node, instance.graph_data, is_rollback=True)

        OperationLogService.log_workflow(
            user=task.approver,
            task=task,
            action="rollback",
            detail={"comment": comment, "target_node": target_node_id},
        )

    @classmethod
    def _advance(cls, instance: WorkflowInstance, current_node_id: str) -> None:
        """
        从当前节点推进到下一个审批节点

        Args:
            instance: 流程实例
            current_node_id: 当前节点 ID
        """
        node_config = instance.definition.node_config or []
        node_ids = [n["node_id"] for n in node_config]

        if current_node_id not in node_ids:
            cls._finish_instance(instance, "completed")
            return

        current_idx = node_ids.index(current_node_id)
        if current_idx >= len(node_config) - 1:
            cls._finish_instance(instance, "completed")
            return

        next_node = node_config[current_idx + 1]
        instance.current_node_id = next_node["node_id"]
        node_status = instance.node_status or {}
        node_status[current_node_id] = "approved"
        instance.node_status = node_status
        instance.save(update_fields=["current_node_id", "node_status", "updated_at"])

        cls._create_node_tasks(instance, next_node, instance.graph_data)

    @classmethod
    def _create_node_tasks(
        cls,
        instance: WorkflowInstance,
        node: Dict[str, Any],
        graph_data: Dict[str, Any],
        is_rollback: bool = False,
    ) -> List[WorkflowTask]:
        """
        为指定节点创建审批任务

        Args:
            instance: 流程实例
            node: 审批链节点配置
            graph_data: 流程图数据
            is_rollback: 是否由回退触发

        Returns:
            创建的 WorkflowTask 列表
        """
        node_id = node["node_id"]
        node_name = node.get("node_name", node_id)
        mode = node.get("mode", "any")
        approvers_config = node.get("approvers", [])

        approvers = cls._resolve_node_approvers(approvers_config, instance)
        if not approvers:
            raise serializers.ValidationError(
                {"node_config": f"节点 {node_name} 未解析到有效审批人"}
            )

        tasks = []
        for approver in approvers:
            task = WorkflowTask.objects.create(
                instance=instance,
                node_id=node_id,
                node_name=node_name,
                approver=approver,
                mode=mode,
                is_rollback=is_rollback,
            )
            tasks.append(task)
            NotificationService.notify_task_created(task)

        return tasks

    @classmethod
    def _resolve_node_approvers(
        cls,
        approvers_config: List[Dict[str, Any]],
        instance: WorkflowInstance,
    ) -> List[User]:
        """
        解析节点审批人配置

        Args:
            approvers_config: 审批人配置列表
            instance: 流程实例

        Returns:
            去重后的 User 列表
        """
        project = instance.definition.project
        all_approvers: List[User] = []

        for config in approvers_config:
            users = cls._resolve_approvers_from_config(config, project, instance)
            all_approvers.extend(users)

        seen = set()
        unique_approvers: List[User] = []
        for user in all_approvers:
            if user and user.id not in seen:
                seen.add(user.id)
                unique_approvers.append(user)

        return unique_approvers

    @classmethod
    def _resolve_approvers_from_config(
        cls,
        config: Dict[str, Any],
        project: Project,
        instance: WorkflowInstance,
    ) -> List[User]:
        """
        从审批链配置解析审批人

        Args:
            config: {"type": "leader"|"role"|"user"|"self", "user_id": ..., "role": ...}
            project: 所属项目
            instance: 流程实例

        Returns:
            User 列表
        """
        approver_type = config.get("type", "leader")

        if approver_type == "leader":
            if project.leader:
                return [project.leader]
            return []

        if approver_type == "role":
            role = config.get("role", "")
            members = ProjectMember.objects.filter(
                project=project,
                role=role,
            ).select_related("user")
            return [m.user for m in members]

        if approver_type == "user":
            user_id = config.get("user_id")
            if not user_id:
                return []
            user = User.objects.filter(id=user_id).first()
            return [user] if user else []

        if approver_type == "self":
            if instance.created_by:
                return [instance.created_by]
            return []

        return []

    @classmethod
    def _build_graph_data(cls, node_config: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        将审批链配置转换为 LogicFlow 图数据

        Args:
            node_config: 审批链节点列表

        Returns:
            LogicFlow graph_data 字典
        """
        nodes = [
            {
                "id": "start",
                "type": cls.START_NODE_TYPE,
                "x": 100,
                "y": 200,
                "text": "开始",
            }
        ]
        edges = []
        prev_id = "start"
        x_offset = 300

        for idx, node in enumerate(node_config):
            node_id = node.get("node_id", f"approval_{idx + 1}")
            mode = node.get("mode", "any")
            mode_label = "会签" if mode == "all" else "或签"
            node_name = node.get("node_name", f"审批节点 {idx + 1}")

            nodes.append({
                "id": node_id,
                "type": cls.APPROVAL_NODE_TYPE,
                "x": x_offset,
                "y": 200,
                "text": f"{node_name}\n({mode_label})",
                "properties": {
                    "mode": mode,
                    "_approvers": node.get("approvers", []),
                },
            })
            edges.append({
                "id": f"e_{prev_id}_{node_id}",
                "sourceNodeId": prev_id,
                "targetNodeId": node_id,
            })
            prev_id = node_id
            x_offset += 250

        nodes.append({
            "id": "end",
            "type": cls.END_NODE_TYPE,
            "x": x_offset,
            "y": 200,
            "text": "结束",
        })
        edges.append({
            "id": f"e_{prev_id}_end",
            "sourceNodeId": prev_id,
            "targetNodeId": "end",
        })

        return {"nodes": nodes, "edges": edges}

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

    # 以下方法为兼容旧 graph_data 保留，新逻辑不再使用

    @classmethod
    def _find_first_approval_node(cls, graph_data: dict) -> Optional[dict]:
        """
        查找开始节点后的第一个审批节点（兼容旧 graph_data）
        """
        nodes = {n["id"]: n for n in graph_data.get("nodes", [])}
        start_node_id = None
        for node in graph_data.get("nodes", []):
            if node.get("type") == cls.START_NODE_TYPE:
                start_node_id = node["id"]
                break
        if not start_node_id:
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
        查找当前审批节点的下一个审批节点（兼容旧 graph_data）
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
        查找当前节点的下一个节点 ID（兼容旧 graph_data）
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
        解析节点审批人（兼容旧 graph_data）
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
            if instance.created_by:
                return [instance.created_by]
            return []

        return []

    @staticmethod
    def _node_name(node: dict) -> str:
        """
        获取节点展示名称（兼容旧 graph_data）
        """
        text = node.get("text") or {}
        if isinstance(text, dict):
            return text.get("value", node.get("id", ""))
        return text or node.get("id", "")
