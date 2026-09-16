from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("release", "0010_releaserecord_base_tag_releasereviewissue_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="releaserecord",
            name="redmine_url",
            field=models.URLField(
                blank=True,
                max_length=500,
                verbose_name="Redmine 任务地址",
            ),
        ),
    ]
