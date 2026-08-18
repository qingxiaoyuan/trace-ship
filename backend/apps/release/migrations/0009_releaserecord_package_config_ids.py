# 发布记录新增「发布后自动打包配置」字段
#
# 用户创建发布时勾选该仓库启用了「发布后自动打包」的打包配置（快照固定）。
# None 表示未显式选择（历史数据，发布通过后触发全部自动打包配置）；
# [] 表示不自动打包；[id,...] 表示仅触发这些配置。

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("release", "0008_remove_releaserecord_jenkins_build"),
    ]

    operations = [
        migrations.AddField(
            model_name="releaserecord",
            name="package_config_ids",
            field=models.JSONField(
                blank=True,
                default=None,
                null=True,
                verbose_name="发布后自动打包配置",
            ),
        ),
    ]
