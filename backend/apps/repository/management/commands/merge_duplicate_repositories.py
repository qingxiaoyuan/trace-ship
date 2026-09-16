import json
from collections import defaultdict
from urllib.parse import urlparse

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from apps.package.models import PackageConfig, PackageTask
from apps.release.models import ReleaseCommit, ReleaseRecord
from apps.repository.models import CommitRecord, Repository, RepositoryBranch, RepositoryTag
from apps.repository.schema_compat import has_column, repositories


def _normalized_identity(repository) -> tuple[str, str, str]:
    """与一致性检查、正式迁移使用同一套物理仓库标识规则。"""
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


def _table_exists(name: str) -> bool:
    """迁移前新表可能尚不存在，查询前必须判断。"""
    return name in set(connection.introspection.table_names())


def _column_exists(table: str, column: str) -> bool:
    """判断旧表是否已有新列，避免迁移前访问不存在的字段。"""
    if not _table_exists(table):
        return False
    with connection.cursor() as cursor:
        columns = connection.introspection.get_table_description(cursor, table)
    return any(item.name == column for item in columns)


class Command(BaseCommand):
    help = "人工指定主仓库后安全归并重复物理仓库；默认仅输出检查报告"

    def add_arguments(self, parser):
        parser.add_argument("--list", action="store_true", help="列出重复物理仓库组及候选明细")
        parser.add_argument("--primary", help="人工确认的主仓库 UUID")
        parser.add_argument("--duplicate", action="append", help="待归并仓库 UUID，可重复传入")
        parser.add_argument("--apply", action="store_true", help="确认执行；不传时仅预览")

    def handle(self, *args, **options):
        if options["list"]:
            self.stdout.write(json.dumps(self._list_groups(), ensure_ascii=False, indent=2, default=str))
            return
        if not options.get("primary") or not options.get("duplicate"):
            raise CommandError("请提供 --primary 与 --duplicate，或使用 --list 查看重复组")
        primary = repositories().filter(id=options["primary"]).first()
        if primary is None:
            raise CommandError("主仓库不存在")
        duplicates = list(repositories().filter(id__in=options["duplicate"]).order_by("created_at"))
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

    @classmethod
    def _list_groups(cls) -> dict:
        """列出规范化后身份重复的仓库组，供选择主仓库。"""
        groups = defaultdict(list)
        all_repos = repositories().select_related("project")
        for repository in all_repos:
            vendor, url, identity = _normalized_identity(repository)
            if identity:
                groups[(vendor, url, identity)].append(repository)
        result = []
        for key, items in sorted(groups.items()):
            if len(items) < 2:
                continue
            result.append({
                "vendor": key[0],
                "url": key[1],
                "external_identity": key[2],
                "total": len(items),
                "candidates": [cls._candidate(item) for item in sorted(items, key=lambda row: row.created_at)],
            })
        return {"duplicate_groups": result, "group_count": len(result)}

    @classmethod
    def _candidate(cls, repository) -> dict:
        """输出选择主仓库所需的计数与归属信息。"""
        info = {
            "id": str(repository.id),
            "name": repository.name,
            "stored_url": repository.url,
            "project_id": str(repository.project_id) if repository.project_id else None,
            "project_name": repository.project.name if repository.project_id else None,
            "created_at": repository.created_at,
            "created_by_id": (
                str(repository.created_by_id)
                if has_column(Repository, "created_by_id") and repository.created_by_id
                else None
            ),
            "credential_id": str(repository.credential_id) if repository.credential_id else None,
            "releases": repository.releases.count(),
            "package_configs": repository.package_configs.count(),
            "package_tasks": repository.package_tasks.count(),
            "commits": repository.commits.count(),
            "branches": repository.branches.count(),
            "tags": repository.tags.count(),
        }
        if _table_exists("project_component"):
            info["components"] = repository.product_components.count()
        return info

    @classmethod
    def _report(cls, primary, duplicates) -> dict:
        conflicts = []
        stats = []
        notes = []
        primary_branches = {item.name: item for item in primary.branches.all()}
        primary_tags = {item.name: item for item in primary.tags.all()}
        primary_identity = _normalized_identity(primary)
        for duplicate in duplicates:
            identity = _normalized_identity(duplicate)
            if identity != primary_identity:
                conflicts.append({"repository": str(duplicate.id), "type": "identity_mismatch"})
            if _table_exists("project_component"):
                from apps.project.models import ProductComponent

                for component in ProductComponent.objects.filter(repository=duplicate):
                    if ProductComponent.objects.filter(
                        project=component.project,
                        component_code=component.component_code,
                        repository=primary,
                    ).exclude(id=component.id).exists():
                        conflicts.append({
                            "repository": str(duplicate.id),
                            "type": "component_code",
                            "value": component.component_code,
                        })
            elif duplicate.project_id and duplicate.project_id != primary.project_id:
                notes.append({
                    "repository": str(duplicate.id),
                    "type": "legacy_product_reattach",
                    "project_id": str(duplicate.project_id),
                    "detail": "产品组件表尚未创建；归并后该产品的发布/打包仍指向主仓库，迁移回填会补建组件",
                })
            for branch in duplicate.branches.all():
                existing = primary_branches.get(branch.name)
                if existing and existing.last_commit_hash != branch.last_commit_hash:
                    conflicts.append({"repository": str(duplicate.id), "type": "branch", "value": branch.name})
            for tag in duplicate.tags.all():
                existing = primary_tags.get(tag.name)
                if existing and existing.commit_hash != tag.commit_hash:
                    conflicts.append({"repository": str(duplicate.id), "type": "tag", "value": tag.name})
            stats.append(cls._candidate(duplicate))
        return {
            "primary": cls._candidate(primary),
            "duplicates": stats,
            "conflicts": conflicts,
            "notes": notes,
        }

    @staticmethod
    def _merge_one(primary, duplicate):
        if _table_exists("repository_credential_loan"):
            from apps.credential.models import RepositoryCredentialLoan

            if duplicate.credential_id and duplicate.project_id:
                loan, _created = RepositoryCredentialLoan.objects.get_or_create(
                    repository=primary,
                    credential=duplicate.credential,
                    lender=duplicate.credential.owner,
                    is_active=True,
                    defaults={"permission_scope": ["read", "create_tag", "delete_tag"]},
                )
                loan.allowed_products.add(duplicate.project_id)
            RepositoryCredentialLoan.objects.filter(repository=duplicate).update(repository=primary)
        if _table_exists("project_component"):
            from apps.project.models import ProductComponent

            ProductComponent.objects.filter(repository=duplicate).update(repository=primary)
        if _table_exists("credential_usage_log"):
            from apps.credential.models import CredentialUsageLog

            CredentialUsageLog.objects.filter(repository=duplicate).update(repository=primary)
        ReleaseRecord.objects.filter(repository=duplicate).update(repository=primary)
        PackageConfig.objects.filter(repository=duplicate).update(repository=primary)
        PackageTask.objects.filter(repository=duplicate).update(repository=primary)
        if _column_exists("workflow_definition", "repository_id"):
            from apps.workflow.models import WorkflowDefinition, WorkflowInstance

            for definition in list(WorkflowDefinition.objects.filter(repository=duplicate)):
                existing = WorkflowDefinition.objects.filter(
                    repository=primary,
                    biz_type=definition.biz_type,
                    release_type=definition.release_type,
                ).first()
                if existing:
                    WorkflowInstance.objects.filter(definition=definition).update(definition=existing)
                    definition.delete()
                else:
                    definition.repository = primary
                    definition.save(update_fields=["repository"])
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
            existing = CommitRecord.objects.filter(
                repository=primary, commit_hash=commit.commit_hash
            ).first()
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
