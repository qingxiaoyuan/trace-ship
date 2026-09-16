from django.db import migrations


def backfill_repository_loans(apps, schema_editor):
    """把旧仓库凭证转换为只授权给历史登记产品的借用记录。"""
    Repository = apps.get_model("repository", "Repository")
    Loan = apps.get_model("credential", "RepositoryCredentialLoan")

    for repository in Repository.objects.exclude(credential_id=None).iterator():
        if not repository.project_id:
            continue
        loan = Loan.objects.filter(
            repository_id=repository.id,
            credential_id=repository.credential_id,
            lender_id=repository.credential.owner_id,
            is_active=True,
        ).first()
        if loan is None:
            loan = Loan.objects.create(
                repository_id=repository.id,
                credential_id=repository.credential_id,
                lender_id=repository.credential.owner_id,
                permission_scope=["read", "create_tag", "delete_tag"],
                is_active=True,
            )
        loan.allowed_products.add(repository.project_id)


class Migration(migrations.Migration):
    dependencies = [
        ("credential", "0011_credentialusagelog_product_release_and_more"),
        ("repository", "0010_repository_uniq_physical_repository_identity"),
    ]

    operations = [
        migrations.RunPython(backfill_repository_loans, migrations.RunPython.noop),
    ]
