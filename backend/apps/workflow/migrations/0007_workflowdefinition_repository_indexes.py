"""数据回填完成后补加索引与唯一约束。"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("workflow", "0006_backfill_workflowdefinition_repository"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="workflowdefinition",
            index=models.Index(
                fields=["repository", "biz_type", "is_active"],
                name="workflow_de_repo_biz_act_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="workflowdefinition",
            constraint=models.UniqueConstraint(
                condition=models.Q(("repository__isnull", False)),
                fields=("repository", "biz_type", "release_type"),
                name="uniq_repository_biz_release_type",
            ),
        ),
    ]
