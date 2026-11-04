# 区分远端文件清单完整性与单个文件正文缺口；存量记录保持未知。

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('release', '0022_releaseversionclaim_reused'),
    ]

    operations = [
        migrations.AddField(
            model_name='releasereviewscope',
            name='manifest_complete',
            field=models.BooleanField(default=None, null=True, verbose_name='远端文件清单完整'),
        ),
    ]
