"""凭证模块 product → project 字段改名（真实 RENAME，非 DROP+ADD）。

- CredentialUsageLog.product → project
- CredentialUsageLog.product_component → project_component
- RepositoryCredentialLoan.allowed_products → allowed_projects（M2M 中间表同步改名）

注意：product 上的复合索引先删后建（改名后新索引落在 project 列），
避免 RenameField 重建表时引用旧字段名。
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("credential", "0012_backfill_repository_loans"),
        ("project", "0008_rename_project_component"),
    ]

    operations = [
        migrations.RemoveIndex(
            model_name="credentialusagelog",
            name="credential__product_0d3b77_idx",
        ),
        migrations.RenameField(
            model_name="credentialusagelog",
            old_name="product",
            new_name="project",
        ),
        migrations.RenameField(
            model_name="credentialusagelog",
            old_name="product_component",
            new_name="project_component",
        ),
        migrations.RenameField(
            model_name="repositorycredentialloan",
            old_name="allowed_products",
            new_name="allowed_projects",
        ),
        migrations.AddIndex(
            model_name="credentialusagelog",
            index=models.Index(
                fields=["project", "created_at"],
                name="credential__project_7d8f64_idx",
            ),
        ),
    ]
