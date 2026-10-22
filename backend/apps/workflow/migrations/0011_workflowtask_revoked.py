# 审批任务增加发起人终止后的失效状态。

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workflow', '0010_normalize_release_biz_ids'),
    ]

    operations = [
        migrations.AlterField(
            model_name='workflowtask',
            name='status',
            field=models.CharField(choices=[('pending', '待处理'), ('approved', '已通过'), ('rejected', '已驳回'), ('transferred', '已转交'), ('rollbacked', '已回退'), ('revoked', '已终止')], default='pending', max_length=20, verbose_name='状态'),
        ),
    ]
