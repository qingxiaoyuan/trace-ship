"""数据迁移后补加唯一约束（避免同事务 DML 后 DDL 触发 pending trigger events）。"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("workflow", "0003_add_release_type_builtin_flows"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="workflowdefinition",
            constraint=models.UniqueConstraint(
                fields=("project", "biz_type", "release_type"),
                name="uniq_project_biz_release_type",
            ),
        ),
    ]
