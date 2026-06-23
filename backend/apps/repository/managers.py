from django.db import models


class CommitRecordQuerySet(models.QuerySet):
    def by_project(self, project):
        return self.filter(project=project)

    def by_repository(self, repository):
        return self.filter(repository=repository)

    def by_branch(self, branch):
        return self.filter(branch=branch)

    def by_author(self, author):
        return self.filter(author__icontains=author)

    def illegal(self):
        return self.filter(review_status="illegal")

    def warning(self):
        return self.filter(review_status="warning")

    def passed(self):
        return self.filter(review_status="pass")

    def unreviewed(self):
        return self.filter(review_status="unreviewed")

    def since(self, dt):
        return self.filter(committed_at__gte=dt)

    def until(self, dt):
        return self.filter(committed_at__lte=dt)


CommitRecordManager = models.Manager.from_queryset(CommitRecordQuerySet)
