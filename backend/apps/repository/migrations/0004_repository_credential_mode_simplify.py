# Generated manually for simplifying repository credential binding

from django.db import migrations, models


def convert_credential_mode(apps, schema_editor):
    """
    将旧凭证模式归一为 personal。

    注意：credential.0007 已将凭证统一为个人凭证并删除 scope 字段（拓扑序上可能先于
    本迁移执行），此处不能再按 credential__scope 查询，直接按绑定状态归一。
    """
    Repository = apps.get_model("repository", "Repository")

    # 已绑定凭证的仓库：来源归一为 personal
    Repository.objects.exclude(credential__isnull=True).update(credential_mode="personal")
    # 未绑定凭证或残留旧模式枚举值的行：同样归一到 personal（凭证来源选择已随个人凭证化收敛）
    Repository.objects.filter(credential__isnull=True).exclude(
        credential_mode="personal"
    ).update(credential=None, credential_mode="personal")


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
