"""打包配置增加 SVN 推送字段。"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("credential", "0005_remove_jenkins_credential_type"),
        ("package", "0003_add_progress_stage_info"),
    ]

    operations = [
        migrations.AddField(
            model_name="packageconfig",
            name="svn_push_enabled",
            field=models.BooleanField(default=False, verbose_name="启用 SVN 推送"),
        ),
        migrations.AddField(
            model_name="packageconfig",
            name="svn_url",
            field=models.CharField(blank=True, max_length=500, verbose_name="SVN 仓库地址"),
        ),
        migrations.AddField(
            model_name="packageconfig",
            name="svn_credential",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.SET_NULL,
                related_name="package_configs_svn",
                to="credential.credential",
                verbose_name="SVN 凭证",
            ),
        ),
        migrations.AddField(
            model_name="packageconfig",
            name="svn_path_template",
            field=models.CharField(
                blank=True, default="{version}", max_length=300, verbose_name="SVN 目录模板"
            ),
        ),
    ]
