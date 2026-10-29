# 取消版本类型子开关；已有任务的配置快照保持原样。

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('package', '0032_packagetask_source_ref'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='packageconfig',
            name='svn_push_beta',
        ),
        migrations.RemoveField(
            model_name='packageconfig',
            name='svn_push_rc',
        ),
    ]
