from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('release', '0026_oa_failure_confirmation')]

    operations = [
        migrations.AddField(
            model_name='oaarchiveapplication',
            name='oa_response',
            field=models.JSONField(null=True, verbose_name='OA HTTP 响应'),
        ),
    ]
