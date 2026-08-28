"""
通知服务

封装站内消息的创建、标记已读等能力。
"""

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
    def remind_summary(user) -> dict:
        """
        强提醒聚合

        统计当前用户「需要审批」的待办任务与「需要整改」的发布文档意见，
        各取最近 5 条供强提醒弹窗展示。口径为严格待办（与通知是否已读无关）：
        审批取 approver=本人且 status=pending 的任务（超管同样只看自己的，
        不放开全量）；整改取本人发布且 status=open 的整改意见。

        Args:
            user: 当前用户

        Returns:
            强提醒聚合数据：todo_task_count / todo_tasks / open_issue_count / open_issues
        """
        from apps.release.models import ReleaseReviewIssue
        from apps.workflow.models import WorkflowTask
        from apps.workflow.serializers import resolve_release

        todo_qs = (
            WorkflowTask.objects.filter(approver=user, status="pending")
            .select_related("instance", "instance__definition", "instance__definition__project")
            .order_by("-created_at")
        )
        todo_tasks = []
        for task in todo_qs[:5]:
            release = resolve_release(task.instance)
            todo_tasks.append(
                {
                    "id": str(task.id),
                    "title": f"审批发布 {release.version}" if release else task.node_name,
                    "version": release.version if release else "",
                    "project_name": release.project.name
                    if release
                    else task.instance.definition.project.name,
                    "created_at": task.created_at,
                }
            )

        issue_qs = (
            ReleaseReviewIssue.objects.filter(release__publisher=user, status="open")
            .select_related("release")
            .order_by("-created_at")
        )
        open_issues = [
            {
                "id": str(issue.id),
                "release_id": str(issue.release_id),
                "version": issue.release.version,
                "content": issue.content,
                "created_at": issue.created_at,
            }
            for issue in issue_qs[:5]
        ]

        return {
            "todo_task_count": todo_qs.count(),
            "todo_tasks": todo_tasks,
            "open_issue_count": issue_qs.count(),
            "open_issues": open_issues,
        }

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
    def notify_package_result(task, release=None) -> None:
        """
        打包任务结束时通知发起人

        发布触发的打包任务通知发布人；分支直打包任务（无关联发布）通知触发人。

        Args:
            task: PackageTask 实例
            release: ReleaseRecord 实例（可选）
        """
        if not release:
            release = task.release
        user = release.publisher if release else None
        if not user and task.triggered_by_id:
            user = task.triggered_by
        if not user:
            return

        if task.status == "success":
            title = "打包成功"
            content = (
                f"版本 {release.version} 的打包任务已成功完成。"
                if release
                else f"分支 {task.version} 的打包任务已成功完成。"
            )
        elif task.status in ("failure", "canceled"):
            title = "打包失败" if task.status == "failure" else "打包已取消"
            content = (
                f"版本 {release.version} 的打包任务{task.get_status_display()}，发布状态保持已发布。"
                if release
                else f"分支 {task.version} 的打包任务{task.get_status_display()}。"
            )
        else:
            return

        NotificationService.create(
            user=user,
            notification_type="build",
            title=title,
            content=content,
            related_type="package_task",
            related_id=str(task.id),
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

    # ---------- 发布文档审查整改通知 ----------

    @staticmethod
    def _latest_reply_content(issue) -> str:
        """取意见下最近一条回复内容（不含意见正文）"""
        latest = issue.replies.order_by("-created_at").first()
        return (latest.content if latest else "").strip()

    @staticmethod
    def notify_review_issue_created(issue) -> None:
        """发起整改意见时通知发布人"""
        publisher = issue.release.publisher
        if not publisher or str(publisher.id) == str(issue.author_id):
            return
        NotificationService.create(
            user=publisher,
            notification_type="review",
            title="发布文档收到整改意见",
            content=f"版本 {issue.release.version}（{issue.release.tag_name}）收到审查整改意见：{issue.content[:80]}",
            related_type="release",
            related_id=str(issue.release_id),
        )

    @staticmethod
    def notify_review_issue_replied(issue) -> None:
        """发布人回复后通知意见发起人（审查员）"""
        author = issue.author
        if not author or str(author.id) == str(issue.release.publisher_id):
            return
        content = NotificationService._latest_reply_content(issue)
        NotificationService.create(
            user=author,
            notification_type="review",
            title="整改意见已回复",
            content=f"版本 {issue.release.version} 的整改意见已有发布人回复：{content[:80]}",
            related_type="release",
            related_id=str(issue.release_id),
        )

    @staticmethod
    def notify_review_issue_resolved(issue) -> None:
        """审查员通过整改意见后通知发布人"""
        publisher = issue.release.publisher
        if not publisher or str(publisher.id) == str(issue.author_id):
            return
        NotificationService.create(
            user=publisher,
            notification_type="review",
            title="整改意见已通过",
            content=f"版本 {issue.release.version} 的整改意见已通过：{issue.content[:80]}",
            related_type="release",
            related_id=str(issue.release_id),
        )

    @staticmethod
    def notify_review_issue_rejected(issue, comment: str = "") -> None:
        """审查员驳回整改意见后通知发布人"""
        publisher = issue.release.publisher
        if not publisher or str(publisher.id) == str(issue.author_id):
            return
        note = f"驳回备注：{comment[:80]}" if comment else "请修改后再次回复"
        NotificationService.create(
            user=publisher,
            notification_type="review",
            title="整改意见被驳回",
            content=f"版本 {issue.release.version} 的整改意见被驳回，需继续整改。{note}",
            related_type="release",
            related_id=str(issue.release_id),
        )
