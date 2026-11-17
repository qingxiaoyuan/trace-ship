import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("package", "0035_config_assignment")]

    operations = [
        migrations.AddField(
            model_name="packagetask",
            name="retry_of",
            field=models.OneToOneField(
                blank=True, null=True, on_delete=django.db.models.deletion.PROTECT,
                related_name="retried_task", to="package.packagetask", verbose_name="重试来源任务",
            ),
        ),
    ]
