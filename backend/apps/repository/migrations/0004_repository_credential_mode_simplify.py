# Generated manually for simplifying repository credential binding

from django.db import migrations, models


def convert_credential_mode(apps, schema_editor):
    """
    将旧凭证模式转换为 personal / project：
    - fixed：按绑定凭证的 scope 转为 project / personal
    - current_user / specified_user / global：开发环境直接重置，解绑凭证并置为 project（需重新绑定）
    """
    Repository = apps.get_model("repository", "Repository")
    Credential = apps.get_model("credential", "Credential")

    for repo in Repository.objects.exclude(credential__isnull=True):
        cred = repo.credential
        if cred and cred.scope == "project":
            repo.credential_mode = "project"
        else:
            repo.credential_mode = "personal"
        repo.save(update_fields=["credential_mode"])

    # 未绑定凭证或旧自动解析模式：重置为 project 默认值并解绑凭证
    Repository.objects.filter(
        credential_mode__in=["current_user", "specified_user", "global", "fixed"]
    ).exclude(credential__isnull=False, credential__scope__in=["project", "personal"]).update(
        credential=None,
        credential_mode="project",
    )
    # 仍残留旧模式枚举值的行统一归一到 project
    Repository.objects.exclude(credential_mode__in=["personal", "project"]).update(
        credential=None,
        credential_mode="project",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("credential", "0003_alter_credential_cred_type"),
        ("repository", "0003_remove_repository_integration"),
    ]

    operations = [
        migrations.AlterField(
            model_name="repository",
            name="credential_mode",
            field=models.CharField(
                choices=[("personal", "个人"), ("project", "项目")],
                default="project",
                max_length=20,
                verbose_name="凭证来源",
            ),
        ),
        migrations.RemoveField(
            model_name="repository",
            name="specified_user",
        ),
        migrations.RunPython(convert_credential_mode, migrations.RunPython.noop),
    ]
