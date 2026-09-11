import json
from collections import defaultdict
from urllib.parse import urlparse

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.models import F

from apps.package.models import PackageConfig
from apps.project.models import ProductComponent, Project
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository


def _normalized_identity(repository) -> tuple[str, str, str]:
    """按正式迁移相同规则计算物理仓库标识，但不写回数据库。"""
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


class Command(BaseCommand):
    help = "只读检查产品、共享仓库、凭证借用、发布与打包数据的一致性"

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="输出 JSON")
        parser.add_argument("--strict", action="store_true", help="发现异常时返回非零退出码")

    @staticmethod
    def _duplicate_identities() -> list[dict]:
        groups = defaultdict(list)
        for repository in Repository.objects.all().only(
            "id", "vendor", "url", "external_identity"
        ).iterator():
            key = _normalized_identity(repository)
            if key[2]:
                groups[key].append(str(repository.id))
        return [
            {
                "vendor": key[0],
                "url": key[1],
                "external_identity": key[2],
                "repository_ids": ids,
                "total": len(ids),
            }
            for key, ids in sorted(groups.items())
            if len(ids) > 1
        ]

    def _pre_migration_report(self) -> dict:
        """只使用旧表生成检查结果，可在任何新迁移执行前安全运行。"""
        return {
            "migration_state": "pre_migration",
            "summary": {
                "products": Project.objects.count(),
                "repositories": Repository.objects.count(),
                "legacy_releases": ReleaseRecord.objects.count(),
                "package_configs": PackageConfig.objects.count(),
            },
            "issues": {
                "duplicate_repository_identities": self._duplicate_identities(),
                "git_repositories_without_external_identity": [
                    str(value) for value in Repository.objects.filter(
                        repo_type="git", external_identity=""
                    ).values_list("id", flat=True)
                ],
            },
            "notes": [
                "当前数据库尚未创建产品组件等新表，本报告未执行迁移后关系检查。",
                "只有本报告无阻断项后才应备份数据库并执行 migrate。",
            ],
        }

    def _post_migration_report(self) -> dict:
        missing_components = list(
            Repository.objects.filter(project_id__isnull=False)
            .exclude(product_components__project_id=F("project_id"))
            .values_list("id", flat=True)
        )
        package_without_component = list(
            PackageConfig.objects.filter(product_component_id__isnull=True)
            .values_list("id", flat=True)
        )
        package_mismatch = list(
            PackageConfig.objects.filter(product_component_id__isnull=False)
            .exclude(
                project_id=F("product_component__project_id"),
                repository_id=F("product_component__repository_id"),
            )
            .values_list("id", flat=True)
        )
        return {
            "migration_state": "post_migration",
            "summary": {
                "products": Project.objects.count(),
                "repositories": Repository.objects.count(),
                "components": ProductComponent.objects.count(),
                "releases": ReleaseRecord.objects.count(),
            },
            "issues": {
                "duplicate_repository_identities": self._duplicate_identities(),
                "legacy_repositories_without_component": [str(value) for value in missing_components],
                "package_configs_without_component": [str(value) for value in package_without_component],
                "package_config_relation_mismatch": [str(value) for value in package_mismatch],
            },
        }

    def handle(self, *args, **options):
        tables = set(connection.introspection.table_names())
        required_new_tables = {
            "project_component",
            "repository_credential_loan",
        }
        if required_new_tables.issubset(tables):
            report = self._post_migration_report()
        else:
            report = self._pre_migration_report()
        issue_count = sum(len(values) for values in report["issues"].values())
        report["issue_count"] = issue_count
        if options["json"]:
            self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(self.style.SUCCESS("产品仓库一致性检查完成"))
            self.stdout.write(f"数据库阶段: {report['migration_state']}")
            for name, values in report["issues"].items():
                self.stdout.write(f"- {name}: {len(values)}")
            self.stdout.write(f"异常合计: {issue_count}")
        if issue_count and options["strict"]:
            raise CommandError(f"发现 {issue_count} 项数据一致性异常")
