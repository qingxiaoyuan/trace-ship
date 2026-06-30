# Generated manually for merging source_branch / target_branch into branch

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("release", "0004_releaserecord_related_changes_releaserecord_updates"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="releaserecord",
            name="source_branch",
        ),
        migrations.RenameField(
            model_name="releaserecord",
            old_name="target_branch",
            new_name="branch",
        ),
        # 同步更新字段 verbose_name
        migrations.AlterField(
            model_name="releaserecord",
            name="branch",
            field=models.CharField(max_length=200, verbose_name="发布分支"),
        ),
    ]
