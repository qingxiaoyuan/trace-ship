import json
from collections import defaultdict
from urllib.parse import urlparse

from django.core.management.base import BaseCommand, CommandError

from apps.package.models import PackageConfig
from apps.project.models import Project, ProjectComponent
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository
from apps.repository.schema_compat import repositories


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
    help = "只读检查项目、共享仓库、发布与打包数据的一致性"

    def add_arguments(self, parser):
        parser.add_argument("--json", action="store_true", help="输出 JSON")
        parser.add_argument("--strict", action="store_true", help="发现异常时返回非零退出码")

    @staticmethod
    def _duplicate_identities() -> list[dict]:
        groups = defaultdict(list)
        repo_map = {item.id: item for item in repositories()}
        for repository in repo_map.values():
            key = _normalized_identity(repository)
            if key[2]:
                groups[key].append(repository.id)
        result = []
        for key, ids in sorted(groups.items()):
            if len(ids) < 2:
                continue
            candidates = []
            for repo_id in ids:
                repository = repo_map[repo_id]
                candidates.append({
                    "id": str(repository.id),
                    "name": repository.name,
                    "stored_url": repository.url,
                    "created_at": repository.created_at,
                    "releases": repository.releases.count(),
                    "components": repository.project_components.count(),
                })
            result.append({
                "vendor": key[0],
                "url": key[1],
                "external_identity": key[2],
                "repository_ids": [str(value) for value in ids],
                "total": len(ids),
                "candidates": candidates,
            })
        return result

    @staticmethod
    def _releases_without_active_component() -> list[str]:
        """发布单的项目 + 仓库缺少启用组件关联时视为异常。"""
        values = []
        for release in ReleaseRecord.objects.only("id", "project_id", "repository_id"):
            linked = ProjectComponent.objects.filter(
                project_id=release.project_id,
                repository_id=release.repository_id,
                is_active=True,
            ).exists()
            if not linked:
                values.append(str(release.id))
        return values

    def _report(self) -> dict:
        repositories_without_component = list(
            Repository.objects.exclude(project_components__is_active=True)
            .values_list("id", flat=True)
        )
        return {
            "summary": {
                "projects": Project.objects.count(),
                "repositories": Repository.objects.count(),
                "components": ProjectComponent.objects.count(),
                "releases": ReleaseRecord.objects.count(),
                "package_configs": PackageConfig.objects.count(),
            },
            "issues": {
                "duplicate_repository_identities": self._duplicate_identities(),
                "git_repositories_without_external_identity": [
                    str(value) for value in repositories().filter(
                        repo_type="git", external_identity=""
                    ).values_list("id", flat=True)
                ],
                "repositories_without_active_component": [
                    str(value) for value in repositories_without_component
                ],
                "releases_without_active_component": self._releases_without_active_component(),
            },
        }

    def handle(self, *args, **options):
        report = self._report()
        issue_count = sum(len(values) for values in report["issues"].values())
        report["issue_count"] = issue_count
        if options["json"]:
            self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        else:
            self.stdout.write(self.style.SUCCESS("项目仓库一致性检查完成"))
            for name, values in report["issues"].items():
                self.stdout.write(f"- {name}: {len(values)}")
            self.stdout.write(f"异常合计: {issue_count}")
        if issue_count and options["strict"]:
            raise CommandError(f"发现 {issue_count} 项数据一致性异常")
