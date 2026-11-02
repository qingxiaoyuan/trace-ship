from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("release", "0021_releaserecord_has_revision_history"),
    ]

    operations = [
        migrations.AddField(
            model_name="releaseversionclaim",
            name="reused",
            field=models.BooleanField(default=False, verbose_name="复用历史占用"),
        ),
    ]
