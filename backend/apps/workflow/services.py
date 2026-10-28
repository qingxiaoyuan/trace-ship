"""
工作流引擎服务

提供基于审批链的串行审批流程的创建、推进、审批、驳回、转交、回退、撤销能力。
支持节点或签（any）与会签（all）模式。
"""
import uuid
from typing import TYPE_CHECKING, Any, NoReturn

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import CharField, F, Q, Value
from django.db.models.functions import Cast, Lower, Replace
from django.utils import timezone
from rest_framework import serializers

from apps.account.models import User
from apps.notification.services import NotificationService
from apps.project.models import Project, ProjectMember
from apps.project.services import visible_project_ids, visible_repository_ids
from apps.repository.models import Repository
from apps.system.services import OperationLogService
from apps.workflow.models import WorkflowDefinition, WorkflowInstance, WorkflowTask

if TYPE_CHECKING:
    from apps.release.models import ReleaseRecord


def resolve_release(instance: WorkflowInstance) -> "ReleaseRecord | None":
    """解析实例关联的真实发布；非发布业务和异常业务 ID 返回空值。"""
    if instance.biz_type != "release":
        return None
    from apps.release.models import ReleaseRecord

    try:
        return ReleaseRecord.objects.select_related("project", "repository", "publisher").filter(id=instance.biz_id).first()
    except (ValueError, ValidationError):
        return None

# 内置发布类型 → 流程名称
BUILTIN_RELEASE_FLOW_NAMES: dict[str, str] = {
    "formal": "正式发布审批",
    "rc": "RC 发布审批",
    "beta": "Beta 发布审批",
}


def get_default_node_config() -> list:
    """返回默认审批链配置（仓库拥有者或签审批）。"""
    return [
        {
            "node_id": "approval_1",
            "node_name": "仓库拥有者审批",
            "approvers": [{"type": "repo_owner"}],
            "mode": "any",
        }
    ]


def ensure_builtin_workflow_definitions(repository: Repository) -> None:
    """
    为仓库补齐三种发布类型（formal/rc/beta）的内置审批流程定义。

    已存在的对应类型不重复创建；用于仓库创建时与存量数据迁移。

    Args:
        repository: 物理仓库实例
    """

    existing_types = set(
        WorkflowDefinition.objects.filter(
            repository=repository, biz_type="release"
        ).values_list("release_type", flat=True)
    )
    approval_nodes = get_default_node_config()
    approval_graph = WorkflowEngine._build_graph_data(approval_nodes)
    empty_graph = WorkflowEngine._build_graph_data([])
    for release_type, name in BUILTIN_RELEASE_FLOW_NAMES.items():
        if release_type in existing_types:
            continue
        skip_approval = release_type in ("rc", "beta")
        WorkflowDefinition.objects.create(
            repository=repository,
            name=name,
            biz_type="release",
            release_type=release_type,
            node_config=[] if skip_approval else approval_nodes,
            graph_data=empty_graph if skip_approval else approval_graph,
            is_active=True,
        )


class WorkflowEngine:
    """
    工作流引擎

    基于 WorkflowDefinition.node_config 审批链驱动实例状态流转，
    同时根据 node_config 自动生成 LogicFlow graph_data 用于只读流程图渲染。
    """

    APPROVAL_NODE_TYPE = "approval-node"
    AI_NODE_TYPE = "ai-review-node"
    START_NODE_TYPE = "start-node"
    END_NODE_TYPE = "end-node"

    @staticmethod
    def validate_node_config(nodes: list[dict[str, Any]]) -> None:
        """AI 节点后必须存在人工审批，不能独自决定发布。"""
        if not isinstance(nodes, list) or any(not isinstance(node, dict) for node in nodes):
            raise serializers.ValidationError({"node_config": "审批节点配置不合法"})
        ids = [node.get("node_id") for node in nodes if "node_id" in node]
        if any(not isinstance(value, str) or not value.strip() or value.strip() != value or value in ("start", "end")
               for value in ids) or len(set(ids)) != len(ids):
            raise serializers.ValidationError({"node_config": "节点标识必须非空且唯一"})
        for index, node in enumerate(nodes):
            node_type = node.get("node_type", "approval")
            if node_type not in ("approval", "ai_review"):
                raise serializers.ValidationError({"node_config": "不支持的节点类型"})
            if node_type == "ai_review" and not any(
                later.get("node_type", "approval") == "approval" for later in nodes[index + 1:]
            ):
                raise serializers.ValidationError({"node_config": "AI 代码审查后必须配置人工审批"})

    @classmethod
    def validate_release_definition(cls, definition, release, user) -> None:
        """正式申请提交前核验整条审批链，不把未来失效节点留到发布中途。"""
        nodes = cls._normalize_node_config(definition.node_config or [])
        cls.validate_node_config(nodes)
        if not nodes:
            raise serializers.ValidationError({"workflow": "正式审批必须配置有效审批节点，请联系仓库管理员"})
        candidate = WorkflowInstance(definition=definition, biz_type="release", biz_id=str(release.id), created_by=user)
        for node in nodes:
            if node.get("node_type") == "ai_review":
                continue
            if not cls._resolve_node_approvers(node.get("approvers", []), candidate):
                raise serializers.ValidationError({"workflow": f"审批节点 {node.get('node_name', '')} 无有效审批人，请联系仓库管理员"})

    @classmethod
    def create_instance(
        cls,
        definition: WorkflowDefinition,
        biz_type: str,
        biz_id: str,
        user,
        allow_ai_release: bool = False,
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
        node_config = cls._normalize_node_config(definition.node_config or [])
        cls.validate_node_config(node_config)
        if any(node.get("node_type") == "ai_review" for node in node_config) and not allow_ai_release:
            raise serializers.ValidationError({"workflow": "AI 审查只能通过发布提审启动"})
        if not node_config:
            raise serializers.ValidationError({"node_config": "流程定义中未配置审批节点"})

        # 解析所有节点的实际审批人，防止后续成员或流程配置变化影响本轮。
        candidate = WorkflowInstance(definition=definition, biz_type=biz_type, biz_id=biz_id, created_by=user)
        for node in node_config:
            if node.get("node_type") == "ai_review":
                node["approvers"] = []
                continue
            approvers = cls._resolve_node_approvers(node.get("approvers", []), candidate)
            if not approvers:
                raise serializers.ValidationError({"node_config": f"节点 {node['node_name']} 未解析到有效审批人"})
            node["approvers"] = [
                {"type": "user", "user_id": str(approver.id), "user_name": approver.nickname or approver.username}
                for approver in approvers
            ]
        graph_data = cls._build_graph_data(node_config)

        with transaction.atomic():
            instance = WorkflowInstance.objects.create(
                definition=definition,
                biz_type=biz_type,
                biz_id=biz_id,
                status="running",
                graph_data=graph_data,
                node_config_snapshot=node_config,
                source_project=getattr(resolve_release(candidate), "project", None),
                node_status={},
                created_by=user,
            )

            first_node = node_config[0]
            instance.current_node_id = first_node["node_id"]
            instance.save(update_fields=["current_node_id"])

            cls._create_node_tasks(instance, first_node, graph_data)
            return instance

    @staticmethod
    def _normalize_node_config(node_config: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        归一化审批链配置，兼容旧数据缺少 node_id 等字段的情况。

        Args:
            node_config: 原始审批链配置

        Returns:
            补齐必需字段后的审批链配置
        """
        normalized: list[dict[str, Any]] = []
        for index, node in enumerate(node_config or []):
            item = dict(node or {})
            item.setdefault("node_id", f"approval_{index + 1}_{uuid.uuid4().hex[:8]}")
            item.setdefault("node_name", f"审批节点 {index + 1}")
            item.setdefault("mode", "any")
            item.setdefault("approvers", [{"type": "leader"}])
            normalized.append(item)
        return normalized

    @classmethod
    def _instance_node_config(cls, instance: WorkflowInstance) -> list[dict[str, Any]]:
        """旧实例仅从已保存的完整流程图恢复审批链，无法确定时拒绝流转。"""
        if instance.node_config_snapshot is not None:
            return instance.node_config_snapshot

        def invalid() -> NoReturn:
            raise serializers.ValidationError({"workflow": "历史流程图不完整或审批配置不明确，无法安全推进"})

        graph = instance.graph_data
        if not isinstance(graph, dict):
            invalid()
        nodes, edges = graph.get("nodes"), graph.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list) or not nodes:
            invalid()
        node_map = {}
        for node in nodes:
            if not isinstance(node, dict) or not isinstance(node.get("id"), str) or not node["id"]:
                invalid()
            if node["id"] in node_map or node.get("type") not in (
                cls.START_NODE_TYPE, cls.APPROVAL_NODE_TYPE, cls.END_NODE_TYPE,
            ):
                invalid()
            node_map[node["id"]] = node
        starts = [node["id"] for node in nodes if node["type"] == cls.START_NODE_TYPE]
        ends = [node["id"] for node in nodes if node["type"] == cls.END_NODE_TYPE]
        if len(starts) != 1 or len(ends) != 1:
            invalid()

        outgoing, incoming = {}, {}
        for edge in edges:
            if not isinstance(edge, dict):
                invalid()
            source = edge.get("sourceNodeId") or edge.get("source")
            target = edge.get("targetNodeId") or edge.get("target")
            if not isinstance(source, str) or not isinstance(target, str):
                invalid()
            if ("sourceNodeId" in edge and "source" in edge and edge["sourceNodeId"] != edge["source"]) or (
                "targetNodeId" in edge and "target" in edge and edge["targetNodeId"] != edge["target"]
            ):
                invalid()
            if source not in node_map or target not in node_map or source in outgoing or target in incoming:
                invalid()
            outgoing[source], incoming[target] = target, source
        start, end = starts[0], ends[0]
        if start in incoming or end in outgoing or len(edges) != len(nodes) - 1:
            invalid()
        if any(node_id != start and node_id not in incoming for node_id in node_map):
            invalid()
        if any(node_id != end and node_id not in outgoing for node_id in node_map):
            invalid()

        chain, visited, node_id = [], set(), start
        while node_id != end:
            if node_id in visited or node_id not in outgoing:
                invalid()
            visited.add(node_id)
            node_id = outgoing[node_id]
            node = node_map[node_id]
            if node["type"] != cls.APPROVAL_NODE_TYPE:
                continue
            props = node.get("properties", {})
            if not isinstance(props, dict):
                invalid()
            if "_approvers" in props:
                if any(key in props for key in ("approver_type", "user_id", "role")):
                    invalid()
                approvers = props["_approvers"]
            else:
                approvers = [{"type": props.get("approver_type", "leader"),
                              "user_id": props.get("user_id"), "role": props.get("role")}]
            if not isinstance(approvers, list) or not approvers:
                invalid()
            for approver in approvers:
                if not isinstance(approver, dict) or approver.get("type") not in (
                    "leader", "role", "user", "self", "repo_owner",
                ):
                    invalid()
                if approver["type"] == "user":
                    try:
                        uuid.UUID(str(approver.get("user_id") or ""))
                    except (ValueError, TypeError, AttributeError):
                        invalid()
                if approver["type"] == "role" and (
                    not isinstance(approver.get("role"), str) or not approver["role"]
                ):
                    invalid()
            mode = props.get("mode", "any")
            if mode not in ("any", "all"):
                invalid()
            name = cls._node_name(node)
            if not isinstance(name, str):
                invalid()
            chain.append({"node_id": node_id, "node_name": name.split("\n")[0],
                          "mode": mode, "approvers": approvers})
        if len(visited) + 1 != len(node_map) or not chain:
            invalid()
        return chain

    @staticmethod
    def _lock_instance(instance: WorkflowInstance) -> WorkflowInstance:
        """审批与终止共用仓库 → 发布 → 实例的锁顺序，并读取当前实例状态。"""
        release = resolve_release(instance)
        if release is not None:
            from apps.release.models import ReleaseRecord

            Repository.objects.select_for_update(no_key=True).get(pk=release.repository_id)
            if not ReleaseRecord.objects.select_for_update().filter(pk=release.pk, repository_id=release.repository_id).exists():
                raise serializers.ValidationError({"release": "发布申请已变化，请重新读取"})
        locked = WorkflowInstance.objects.select_for_update().get(pk=instance.pk)
        locked._locked_release_id = release.pk if release is not None else None
        locked._locked_repository_id = release.repository_id if release is not None else None
        if locked.biz_type != instance.biz_type or locked.biz_id != instance.biz_id:
            raise serializers.ValidationError({"instance": "流程业务身份已变更，请重新读取"})
        if release is not None and locked.source_project_id is None:
            locked.source_project_id = release.project_id
            locked.source_biz_id = locked.biz_id
            locked.save(update_fields=["source_project", "source_biz_id"])
        return locked

    @classmethod
    def process_task(
        cls,
        task: WorkflowTask,
        action: str,
        comment: str = "",
        to_user: User | None = None,
        rollback_target: str | None = None,
        actor: User | None = None,
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
        with transaction.atomic():
            if action == "return_for_revision" and not task.instance.source_project_id:
                raise serializers.ValidationError({"instance": "无法核验本轮发布的项目快照"})
            instance = cls._lock_instance(task.instance)
            task.refresh_from_db()
            task.instance = instance
            if task.status != "pending":
                raise serializers.ValidationError({"task": "该任务已处理"})
            if instance.status != "running":
                raise serializers.ValidationError({"instance": "流程实例已结束"})
            now = timezone.now()
            if action == "approve":
                cls._handle_approve(task, comment, now)
            elif action == "reject":
                cls._handle_reject(task, comment, now)
            elif action == "transfer":
                cls._handle_transfer(task, comment, to_user, now)
            elif action == "rollback":
                cls._handle_rollback(task, comment, rollback_target, now)
            elif action == "return_for_revision":
                cls._handle_return_for_revision(task, actor, comment, now)
            else:
                raise serializers.ValidationError({"action": "不支持的审批动作"})

        return instance

    @classmethod
    @transaction.atomic
    def revoke_instance(cls, instance: WorkflowInstance, user) -> WorkflowInstance:
        """
        发起人撤销流程实例

        Args:
            instance: 流程实例
            user: 当前用户

        Returns:
            WorkflowInstance
        """
        instance = cls._lock_instance(instance)
        if instance.status != "running":
            raise serializers.ValidationError({"instance": "流程实例已结束，无法撤销"})
        if instance.created_by_id != user.id:
            raise serializers.ValidationError({"instance": "仅发起人可撤销"})
        cls._finish_instance(instance, "revoked")
        instance.tasks.filter(status="pending").update(
            status="revoked", action_time=instance.completed_at, updated_at=instance.completed_at,
        )
        if instance.biz_type == "release":
            from apps.release.services import ReleaseService

            ReleaseService.handle_workflow_rollback_to_start(instance, "发起人终止流程")
        OperationLogService.log(
            user=user,
            module="工作流审批",
            action="revoke",
            resource_type="workflow_instance",
            resource_id=str(instance.id),
            description=f"发起人终止流程实例 {instance.biz_id}",
        )
        return instance

    @classmethod
    def _handle_return_for_revision(cls, task: WorkflowTask, actor: User | None, comment: str, now) -> None:
        """结束当前轮次并保留历史，将原发布申请交还发起人修改。"""
        from apps.project.models import ProjectMember
        from apps.release.models import ReleaseRecord
        from apps.release.versions import release_claim
        from apps.workflow.models import AIReviewRun
        from utils.permissions import ProjectRolePermission

        instance = task.instance
        if not actor or not User.objects.filter(pk=actor.id, is_active=True).exists() or (
            not actor.is_superuser and task.approver_id != actor.id
        ):
            raise serializers.ValidationError({"task": "只有当前审批人可以退回修改"})
        if task.node_id != instance.current_node_id:
            raise serializers.ValidationError({"task": "该任务不属于当前审批节点"})
        release = resolve_release(instance)
        if not release or release.pk != getattr(instance, "_locked_release_id", None):
            raise serializers.ValidationError({"release": "发布申请不存在或无法确认所属项目"})
        release = ReleaseRecord.objects.select_for_update().filter(
            pk=release.pk, repository_id=getattr(instance, "_locked_repository_id", None),
        ).first()
        if not release:
            raise serializers.ValidationError({"release": "发布申请已变化，请重新读取"})
        if (
            release.status != "pending" or release.workflow_instance_id != instance.id
            or instance.source_project_id != release.project_id
            or not instance.source_biz_id or instance.source_biz_id != instance.biz_id
            or instance.biz_id != str(release.pk)
        ):
            raise serializers.ValidationError({"release": "无法核验本轮发布、项目与业务身份"})
        if not actor.is_superuser and ProjectMember.objects.filter(project=release.project, user=actor).exists():
            role = ProjectRolePermission._effective_role(release.project, actor)
            if role in ("maintainer", "viewer"):
                raise serializers.ValidationError({"task": "只读成员不能退回修改"})
        if not isinstance(comment, str):
            raise serializers.ValidationError({"comment": "退回说明格式不正确"})
        task.status = "returned"
        task.comment = comment
        task.action_time = now
        task.save(update_fields=["status", "comment", "action_time", "updated_at"])
        instance.tasks.filter(status="pending").exclude(pk=task.pk).update(
            status="revoked", action_time=now, updated_at=now,
        )
        instance.returned_by = actor
        node_status = instance.node_status or {}
        node_status[task.node_id] = "returned"
        instance.node_status = node_status
        instance.status = "returned"
        instance.completed_at = now
        instance.save(update_fields=["status", "completed_at", "returned_by", "node_status", "updated_at"])
        # 保留执行身份及已收集的覆盖证据；旧执行失效后迟到结果不能写入。
        from apps.workflow.ai_review import _archive

        for run in AIReviewRun.objects.select_for_update().filter(instance=instance, status__in=["queued", "running"]):
            _archive(run)
            run.status = "canceled"
            run.token = uuid.uuid4()
            run.summary = "本轮已退回修改，未完成的审查已取消"
            run.save(update_fields=["history", "status", "token", "summary", "updated_at"])
        release.status = "draft"
        release.workflow_instance = None
        release.doc_needs_regeneration = True
        release.has_revision_history = True
        release.revision_source_hash = release.git_hash
        release.revision_requires_ai_review = release.revision_requires_ai_review or instance.ai_reviews.exists()
        release.rejected_reason = "退回修改，请查看审批历史"
        release.save(update_fields=["status", "workflow_instance", "doc_needs_regeneration", "has_revision_history", "revision_source_hash", "revision_requires_ai_review", "rejected_reason", "updated_at"])
        release_claim(release)
        OperationLogService.log_workflow(user=actor, task=task, action="return_for_revision", detail={"comment": comment})

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
        to_user: User | None,
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
        rollback_target: str | None,
        now,
    ) -> None:
        """
        处理回退动作

        默认回退到上一审批节点；若指定 rollback_target 且合法，则回退到目标节点。
        回退后流程状态仍为 running，目标节点重新生成 pending 任务。
        """
        instance = task.instance
        node_config = cls._instance_node_config(instance)
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
        if target_node.get("node_type") == "ai_review" or (target_idx > 0 and any(
            node.get("node_type") == "ai_review" for node in node_config[target_idx:current_idx]
        )):
            raise serializers.ValidationError({"task": "不能回退到或跨越 AI 审查节点，请退回修改后重新提审"})

        # 标记当前任务为已回退
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

        OperationLogService.log_workflow(
            user=task.approver,
            task=task,
            action="rollback",
            detail={"comment": comment, "target_node": target_node_id, "to_start": target_idx == 0},
        )

        # 回退到初始节点结束本轮并保留历史；发布和版本占用在同一锁事务内恢复。
        if target_idx == 0:
            cls._finish_instance(instance, "revoked")
            instance.tasks.filter(status="pending").update(
                status="revoked", action_time=now, updated_at=now,
            )
            if instance.biz_type == "release":
                from apps.release.services import ReleaseService

                ReleaseService.handle_workflow_rollback_to_start(instance, comment)
            return

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

    @classmethod
    def _advance(cls, instance: WorkflowInstance, current_node_id: str) -> None:
        """
        从当前节点推进到下一个审批节点

        Args:
            instance: 流程实例
            current_node_id: 当前节点 ID
        """
        node_config = cls._instance_node_config(instance)
        node_ids = [n["node_id"] for n in node_config]

        if current_node_id not in node_ids:
            raise serializers.ValidationError({"task": "当前任务节点不在审批链中，无法推进"})

        current_idx = node_ids.index(current_node_id)

        # 无论是否有下一节点，都先记录当前节点已通过，
        # 否则最后一个审批节点在流程完成后 node_status 中始终缺失，前端会误显示为待处理
        node_status = instance.node_status or {}
        node_status[current_node_id] = "approved"
        instance.node_status = node_status

        if current_idx >= len(node_config) - 1:
            instance.save(update_fields=["node_status", "updated_at"])
            cls._finish_instance(instance, "completed")
            return

        next_node = node_config[current_idx + 1]
        instance.current_node_id = next_node["node_id"]
        instance.save(update_fields=["current_node_id", "node_status", "updated_at"])

        cls._create_node_tasks(instance, next_node, instance.graph_data)

    @classmethod
    def _create_node_tasks(
        cls,
        instance: WorkflowInstance,
        node: dict[str, Any],
        graph_data: dict[str, Any],
        is_rollback: bool = False,
    ) -> list[WorkflowTask]:
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
        if node.get("node_type") == "ai_review":
            from apps.workflow.ai_review import queue_review

            transaction.on_commit(lambda: queue_review(instance.pk, node_id))
            return []
        node_name = node.get("node_name", node_id)
        mode = node.get("mode", "any")
        approvers_config = node.get("approvers", [])

        approvers = cls._resolve_node_approvers(approvers_config, instance)
        if instance.node_config_snapshot is not None and len(approvers) != len(approvers_config):
            raise serializers.ValidationError({"node_config": f"节点 {node_name} 的固定审批人不可用，请联系管理员处理"})
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
        approvers_config: list[dict[str, Any]],
        instance: WorkflowInstance,
    ) -> list[User]:
        """
        解析节点审批人配置

        Args:
            approvers_config: 审批人配置列表
            instance: 流程实例

        Returns:
            去重后的 User 列表
        """
        project, repository = cls._resolve_release_context(instance)
        all_approvers: list[User] = []

        for config in approvers_config:
            users = cls._resolve_approvers_from_config(config, project, instance, repository)
            all_approvers.extend(users)

        seen = set()
        unique_approvers: list[User] = []
        for user in all_approvers:
            if user and user.is_active and user.id not in seen:
                seen.add(user.id)
                unique_approvers.append(user)

        return unique_approvers

    @classmethod
    @staticmethod
    def _resolve_release_context(instance: WorkflowInstance) -> tuple[Project | None, Repository | None]:
        """从流程实例解析项目与仓库上下文，优先使用本次发布单。"""
        repository = getattr(instance.definition, "repository", None)
        project = instance.definition.project
        if instance.biz_type == "release" and instance.biz_id:
            from apps.release.models import ReleaseRecord

            release = (
                ReleaseRecord.objects.filter(id=instance.biz_id)
                .select_related("project", "repository", "repository__created_by")
                .first()
            )
            if release:
                project = release.project
                repository = release.repository
        return project, repository

    @classmethod
    def _resolve_approvers_from_config(
        cls,
        config: dict[str, Any],
        project: Project | None,
        instance: WorkflowInstance,
        repository: Repository | None = None,
    ) -> list[User]:
        """
        从审批链配置解析审批人

        Args:
            config: {"type": "leader"|"role"|"user"|"self"|"repo_owner", ...}
            project: 所属项目（解析项目负责人 / 指定角色）
            instance: 流程实例
            repository: 所属仓库（解析仓库拥有者）

        Returns:
            User 列表
        """
        approver_type = config.get("type", "leader")

        if approver_type == "repo_owner":
            owner = getattr(repository, "created_by", None) if repository else None
            return [owner] if owner else []

        if approver_type == "leader":
            if project and project.leader:
                return [project.leader]
            return []

        if approver_type == "role":
            if not project:
                return []
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
    def _build_graph_data(cls, node_config: list[dict[str, Any]]) -> dict[str, Any]:
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
                "type": cls.AI_NODE_TYPE if node.get("node_type") == "ai_review" else cls.APPROVAL_NODE_TYPE,
                "x": x_offset,
                "y": 200,
                "text": node_name if node.get("node_type") == "ai_review" else f"{node_name}\n({mode_label})",
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
    def _find_first_approval_node(cls, graph_data: dict) -> dict | None:
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
    def _find_next_approval_node(cls, graph_data: dict, current_node_id: str) -> dict | None:
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
    def _find_next_node_id(edges: list[dict], current_node_id: str) -> str | None:
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
    ) -> list[User]:
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

        if approver_type == "repo_owner":
            repository = getattr(instance.definition, "repository", None)
            owner = getattr(repository, "created_by", None) if repository else None
            return [owner] if owner else []

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


def visible_workflow_instances(user):
    """
    当前用户可见的流程实例查询集

    超管全量；其他用户可见所属项目 / 仓库范围内的实例，以及本人作为
    审批人的实例（指定人员可能不是项目成员，但仍需打开通知深链）。
    """
    queryset = WorkflowInstance.objects.all()
    if user.is_superuser:
        return queryset
    from apps.release.models import ReleaseRecord

    # 兼容 UUID 的规范、大写、花括号、URN 和无连字符表示；不能落入旧流程回退。
    normalized_biz_id = Lower("biz_id")
    for fragment in ("urn:", "uuid:", "{", "}", "-"):
        normalized_biz_id = Replace(normalized_biz_id, Value(fragment), Value(""))
    releases = ReleaseRecord.objects.annotate(
        workflow_biz_id=Replace(Cast("id", CharField()), Value("-"), Value("")),
    )
    real_release = Q(biz_type="release", normalized_biz_id__in=releases.values("workflow_biz_id"))
    definition_scope = (
        Q(definition__repository_id__in=visible_repository_ids(user))
        | Q(definition__project_id__in=visible_project_ids(user))
    )
    return queryset.annotate(
        normalized_biz_id=normalized_biz_id,
    ).filter(
        Q(tasks__approver=user)
        | Q(biz_type="release", normalized_biz_id__in=releases.filter(
            project_id__in=visible_project_ids(user),
        ).values("workflow_biz_id"))
        | (~real_release & ~Q(source_biz_id="") & Q(source_project_id__in=visible_project_ids(user),
                                                     source_biz_id=F("biz_id")))
        | Q(biz_type="release", source_project__isnull=True, definition__repository__isnull=True,
            legacy_project_id__in=visible_project_ids(user), legacy_biz_id=F("biz_id"))
        | (~Q(biz_type="release") & definition_scope)
    ).distinct()


def count_todo_tasks(user) -> int:
    """
    当前用户待审批任务数（侧边栏「待我审批」badge）

    口径与「我的待办」列表一致：严格按 approver=本人 且 status=pending 过滤，
    超管同样只看自己的任务，不放开全量。

    Args:
        user: 当前登录用户

    Returns:
        待处理审批任务条数
    """
    return WorkflowTask.objects.filter(approver=user, status="pending").count()
