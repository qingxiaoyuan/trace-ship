import json
from urllib.parse import urlparse

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.credential.models import CredentialUsageLog, RepositoryCredentialLoan
from apps.package.models import PackageConfig, PackageTask
from apps.project.models import ProductComponent
from apps.release.models import ReleaseCommit, ReleaseRecord
from apps.repository.models import CommitRecord, Repository, RepositoryBranch, RepositoryTag


class Command(BaseCommand):
    help = "人工指定主仓库后安全归并重复物理仓库；默认仅输出检查报告"

    def add_arguments(self, parser):
        parser.add_argument("--primary", required=True, help="人工确认的主仓库 UUID")
        parser.add_argument("--duplicate", action="append", required=True, help="待归并仓库 UUID，可重复传入")
        parser.add_argument("--apply", action="store_true", help="确认执行；不传时仅预览")

    def handle(self, *args, **options):
        primary = Repository.objects.filter(id=options["primary"]).first()
        if primary is None:
            raise CommandError("主仓库不存在")
        duplicates = list(Repository.objects.filter(id__in=options["duplicate"]).order_by("created_at"))
        if len(duplicates) != len(set(options["duplicate"])):
            raise CommandError("部分待归并仓库不存在或参数重复")
        if any(item.id == primary.id for item in duplicates):
            raise CommandError("主仓库不能同时作为待归并仓库")
        report = self._report(primary, duplicates)
        self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        if report["conflicts"]:
            raise CommandError("存在冲突，未修改数据；请先按报告人工处理")
        if not options["apply"]:
            self.stdout.write(self.style.WARNING("当前为 dry-run；确认主仓库和报告后追加 --apply 才会写入"))
            return
        with transaction.atomic():
            for duplicate in duplicates:
                self._merge_one(primary, duplicate)
        self.stdout.write(self.style.SUCCESS(f"已归并 {len(duplicates)} 个仓库到 {primary.id}"))

    @staticmethod
    def _normalized_identity(repository):
        url = (repository.url or "").rstrip("/")
        identity = repository.external_identity or ""
        if repository.vendor == "gitlab" and url:
            if url.startswith("git@") and ":" in url:
                host, path = url.split("@", 1)[1].split(":", 1)
                return repository.vendor, f"https://{host}", identity or path.removesuffix(".git")
            parsed = urlparse(url)
            path = parsed.path.strip("/").removesuffix(".git")
            if parsed.scheme and parsed.netloc and path:
                return repository.vendor, f"{parsed.scheme}://{parsed.netloc}", identity or path
        return repository.vendor, url, identity

    @classmethod
    def _report(cls, primary, duplicates) -> dict:
        conflicts = []
        stats = []
        primary_branches = {item.name: item for item in primary.branches.all()}
        primary_tags = {item.name: item for item in primary.tags.all()}
        for duplicate in duplicates:
            identity = cls._normalized_identity(duplicate)
            primary_identity = cls._normalized_identity(primary)
            if identity != primary_identity:
                conflicts.append({"repository": str(duplicate.id), "type": "identity_mismatch"})
            for component in duplicate.product_components.all():
                if ProductComponent.objects.filter(
                    project=component.project,
                    component_code=component.component_code,
                    repository=primary,
                ).exclude(id=component.id).exists():
                    conflicts.append({"repository": str(duplicate.id), "type": "component_code", "value": component.component_code})
            for branch in duplicate.branches.all():
                existing = primary_branches.get(branch.name)
                if existing and existing.last_commit_hash != branch.last_commit_hash:
                    conflicts.append({"repository": str(duplicate.id), "type": "branch", "value": branch.name})
            for tag in duplicate.tags.all():
                existing = primary_tags.get(tag.name)
                if existing and existing.commit_hash != tag.commit_hash:
                    conflicts.append({"repository": str(duplicate.id), "type": "tag", "value": tag.name})
            stats.append({
                "repository": str(duplicate.id),
                "components": duplicate.product_components.count(),
                "releases": duplicate.releases.count(),
                "package_configs": duplicate.package_configs.count(),
                "package_tasks": duplicate.package_tasks.count(),
                "commits": duplicate.commits.count(),
                "branches": duplicate.branches.count(),
                "tags": duplicate.tags.count(),
            })
        return {"primary": str(primary.id), "duplicates": stats, "conflicts": conflicts}

    @staticmethod
    def _merge_one(primary, duplicate):
        if duplicate.credential_id and duplicate.project_id:
            loan, _created = RepositoryCredentialLoan.objects.get_or_create(
                repository=primary,
                credential=duplicate.credential,
                lender=duplicate.credential.owner,
                is_active=True,
                defaults={"permission_scope": ["read", "create_tag", "delete_tag"]},
            )
            loan.allowed_products.add(duplicate.project_id)
        ProductComponent.objects.filter(repository=duplicate).update(repository=primary)
        RepositoryCredentialLoan.objects.filter(repository=duplicate).update(repository=primary)
        CredentialUsageLog.objects.filter(repository=duplicate).update(repository=primary)
        ReleaseRecord.objects.filter(repository=duplicate).update(repository=primary)
        PackageConfig.objects.filter(repository=duplicate).update(repository=primary)
        PackageTask.objects.filter(repository=duplicate).update(repository=primary)
        for branch in list(RepositoryBranch.objects.filter(repository=duplicate)):
            existing = RepositoryBranch.objects.filter(repository=primary, name=branch.name).first()
            if existing:
                branch.delete()
            else:
                branch.repository = primary
                branch.save(update_fields=["repository"])
        for tag in list(RepositoryTag.objects.filter(repository=duplicate)):
            existing = RepositoryTag.objects.filter(repository=primary, name=tag.name).first()
            if existing:
                tag.delete()
            else:
                tag.repository = primary
                tag.save(update_fields=["repository"])
        for commit in list(CommitRecord.objects.filter(repository=duplicate)):
            existing = CommitRecord.objects.filter(repository=primary, commit_hash=commit.commit_hash).first()
            if existing:
                for relation in list(ReleaseCommit.objects.filter(commit=commit)):
                    if ReleaseCommit.objects.filter(release=relation.release, commit=existing).exists():
                        relation.delete()
                    else:
                        relation.commit = existing
                        relation.save(update_fields=["commit"])
                commit.delete()
            else:
                commit.repository = primary
                commit.save(update_fields=["repository"])
        duplicate.delete()
