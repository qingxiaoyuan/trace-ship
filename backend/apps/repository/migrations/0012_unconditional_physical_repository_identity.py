from urllib.parse import urlparse

from django.db import migrations, models


def _normalize(url: str, identity: str) -> tuple[str, str]:
    """与 RepositoryService.normalize_physical_identity 保持同一规则。"""
    raw_url = (url or "").rstrip("/")
    identity = (identity or "").strip()
    if raw_url.startswith("git@") and ":" in raw_url:
        host, path = raw_url.split("@", 1)[1].split(":", 1)
        return f"https://{host}", identity or path.removesuffix(".git")
    parsed = urlparse(raw_url)
    path = parsed.path.strip("/").removesuffix(".git")
    if parsed.scheme and parsed.netloc and path:
        return f"{parsed.scheme}://{parsed.netloc}", identity or path
    return raw_url, identity


def tighten_repository_identity(apps, schema_editor):
    """补齐无 .git 的 HTTP 地址，并在存在重复时中止。"""
    Repository = apps.get_model("repository", "Repository")
    from django.db.models import Count

    for repository in Repository.objects.all().iterator():
        url, identity = _normalize(repository.url, repository.external_identity)
        if url != repository.url or identity != (repository.external_identity or ""):
            repository.url = url
            repository.external_identity = identity
            repository.save(update_fields=["url", "external_identity"])

    duplicate_groups = list(
        Repository.objects.values("vendor", "url", "external_identity")
        .annotate(total=Count("id"))
        .filter(total__gt=1)
        .order_by("vendor", "url", "external_identity")
    )
    if duplicate_groups:
        sample = "; ".join(
            f'{item["vendor"]}:{item["url"]}/{item["external_identity"]}({item["total"]})'
            for item in duplicate_groups[:10]
        )
        raise RuntimeError(
            "检测到重复物理仓库，已中止迁移且不会修改任何数据。"
            "请先人工确认主仓库并处理冲突后重试。重复项：" + sample
        )


class Migration(migrations.Migration):
    dependencies = [
        ("repository", "0011_repository_created_by"),
    ]

    operations = [
        migrations.RunPython(tighten_repository_identity, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="repository",
            name="uniq_physical_repository_identity",
        ),
        migrations.AddConstraint(
            model_name="repository",
            constraint=models.UniqueConstraint(
                fields=("vendor", "url", "external_identity"),
                name="uniq_physical_repository_identity",
            ),
        ),
    ]
