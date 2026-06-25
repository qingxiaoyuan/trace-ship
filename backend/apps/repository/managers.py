"""
提交记录自定义管理器

提供按项目、仓库、分支、作者、审查状态等维度过滤的链式查询方法。
"""
from django.db import models


class CommitRecordQuerySet(models.QuerySet):
    """
    提交记录 QuerySet

    封装常用过滤方法，便于视图和服务层复用。
    """

    def by_project(self, project):
        """按项目过滤"""
        return self.filter(project=project)

    def by_repository(self, repository):
        """按仓库过滤"""
        return self.filter(repository=repository)

    def by_branch(self, branch):
        """按分支过滤"""
        return self.filter(branch=branch)

    def by_author(self, author):
        """按作者模糊过滤"""
        return self.filter(author__icontains=author)

    def illegal(self):
        """仅返回非法状态"""
        return self.filter(review_status="illegal")

    def warning(self):
        """仅返回警告状态"""
        return self.filter(review_status="warning")

    def passed(self):
        """仅返回通过状态"""
        return self.filter(review_status="pass")

    def unreviewed(self):
        """仅返回未审查状态"""
        return self.filter(review_status="unreviewed")

    def since(self, dt):
        """返回指定时间之后的提交"""
        return self.filter(committed_at__gte=dt)

    def until(self, dt):
        """返回指定时间之前的提交"""
        return self.filter(committed_at__lte=dt)


# 使用自定义 QuerySet 作为默认管理器
CommitRecordManager = models.Manager.from_queryset(CommitRecordQuerySet)
