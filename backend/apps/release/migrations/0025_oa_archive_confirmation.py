from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("release", "0024_oa_archive_application")]
    operations = [migrations.AddField(
        model_name="oaarchiveapplication", name="confirmation",
        field=models.CharField(blank=True, default="", max_length=24, choices=[("", "首次申请"), ("reapply", "显式再次申请"), ("retry", "失败后主动重试"), ("checked_no_order", "已核对 OA 未建单后重试")]),
    )]
