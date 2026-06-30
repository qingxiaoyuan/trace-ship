# Generated manually for retiring global credential scope

from django.db import migrations, models


def retire_global_scope(apps, schema_editor):
    """将残留的 global 作用域凭证归一为 personal，并清除 is_global 标志"""
    Credential = apps.get_model("credential", "Credential")
    Credential.objects.filter(scope="global").update(scope="personal", is_global=False)
    Credential.objects.filter(is_global=True).update(is_global=False)


class Migration(migrations.Migration):

    dependencies = [
        ("credential", "0003_alter_credential_cred_type"),
    ]

    operations = [
        migrations.AlterField(
            model_name="credential",
            name="scope",
            field=models.CharField(
                choices=[("personal", "个人"), ("project", "项目")],
                default="personal",
                max_length=20,
                verbose_name="作用范围",
            ),
        ),
        migrations.RunPython(retire_global_scope, migrations.RunPython.noop),
    ]
