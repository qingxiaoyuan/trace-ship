"""
通知服务

封装站内消息的创建、标记已读等能力。
"""
from typing import Optional

from django.db import transaction
from django.utils import timezone

from apps.notification.models import Notification


class NotificationService:
    """
    通知服务

    提供统一的站内消息创建入口。
    """

    @staticmethod
    def create(
        user,
        notification_type: str,
        title: str,
        content: str,
        related_type: str = "",
        related_id: str = "",
    ) -> Notification:
        """
        创建通知

        Args:
            user: 接收用户
            notification_type: 通知类型
            title: 标题
            content: 内容
            related_type: 关联类型
            related_id: 关联 ID

        Returns:
            Notification 实例
        """
        return Notification.objects.create(
            user=user,
            notification_type=notification_type,
            title=title,
            content=content,
            related_type=related_type,
            related_id=related_id,
        )

    @staticmethod
    def mark_all_read(user) -> int:
        """
        标记用户所有未读通知为已读

        Args:
            user: 当前用户

        Returns:
            更新的条数
        """
        now = timezone.now()
        count = Notification.objects.filter(user=user, is_read=False).update(
            is_read=True, read_at=now
        )
        return count

    @staticmethod
    def notify_task_created(task) -> None:
        """
        审批任务创建时通知审批人

        Args:
            task: WorkflowTask 实例
        """
        if not task.approver:
            return
        instance = task.instance
        NotificationService.create(
            user=task.approver,
            notification_type="audit",
            title="新的审批待办",
            content=f"您有一个新的审批任务：{task.node_name}，业务单号 {instance.biz_id}。",
            related_type="workflow_task",
            related_id=str(task.id),
        )

    @staticmethod
    def notify_task_approved(task, comment: str = "") -> None:
        """
        审批通过时通知发起人

        Args:
            task: WorkflowTask 实例
            comment: 审批意见
        """
        instance = task.instance
        if not instance.created_by:
            return
        NotificationService.create(
            user=instance.created_by,
            notification_type="audit",
            title="审批已通过",
            content=f"您的 {instance.biz_type} 申请（{instance.biz_id}）已被 {task.approver.nickname or task.approver.username} 审批通过。{comment}",
            related_type="workflow_instance",
            related_id=str(instance.id),
        )

    @staticmethod
    def notify_task_rejected(task, comment: str = "") -> None:
        """
        审批驳回时通知发起人

        Args:
            task: WorkflowTask 实例
            comment: 驳回意见
        """
        instance = task.instance
        if not instance.created_by:
            return
        NotificationService.create(
            user=instance.created_by,
            notification_type="audit",
            title="审批被驳回",
            content=f"您的 {instance.biz_type} 申请（{instance.biz_id}）已被 {task.approver.nickname or task.approver.username} 驳回。{comment}",
            related_type="workflow_instance",
            related_id=str(instance.id),
        )

    @staticmethod
    def notify_build_result(build, release=None) -> None:
        """
        Jenkins 构建结束时通知发起人

        Args:
            build: JenkinsBuild 实例
            release: ReleaseRecord 实例（可选）
        """
        if not release:
            from apps.release.models import ReleaseRecord
            release = ReleaseRecord.objects.filter(jenkins_build=build).first()
        if not release or not release.publisher:
            return

        if build.status == "success":
            title = "构建成功"
            content = f"版本 {release.version} 的 Jenkins 构建已成功完成，进入待发布审批阶段。"
        elif build.status in ("failure", "aborted"):
            title = "构建失败"
            content = f"版本 {release.version} 的 Jenkins 构建{build.get_status_display()}，发布已驳回。"
        else:
            return

        NotificationService.create(
            user=release.publisher,
            notification_type="build",
            title=title,
            content=content,
            related_type="jenkins_build",
            related_id=str(build.id),
        )

    @staticmethod
    def notify_release_released(release) -> None:
        """
        发布成功后通知发起人

        Args:
            release: ReleaseRecord 实例
        """
        if not release.publisher:
            return
        NotificationService.create(
            user=release.publisher,
            notification_type="release",
            title="发布成功",
            content=f"版本 {release.version} 已成功发布，tag {release.tag_name} 已推送。",
            related_type="release_record",
            related_id=str(release.id),
        )

    @staticmethod
    def mark_read(notification, user) -> Notification:
        """
        标记通知为已读

        Args:
            notification: Notification 实例
            user: 当前用户

        Returns:
            Notification 实例
        """
        if notification.user_id != user.id:
            raise ValueError("无权操作该通知")
        if not notification.is_read:
            notification.is_read = True
            notification.read_at = timezone.now()
            notification.save(update_fields=["is_read", "read_at"])
        return notification
