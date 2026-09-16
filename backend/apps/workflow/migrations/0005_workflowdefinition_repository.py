"""仅改表结构。ForeignKey 的索引由 PostgreSQL 延后到迁移结束创建，不可与数据回填同事务。"""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("project", "0006_remove_productcomponent_uniq_product_component_repository"),
        ("repository", "0011_repository_created_by"),
        ("workflow", "0004_workflowdefinition_uniq_release_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="workflowdefinition",
            name="repository",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="workflow_definitions",
                to="repository.repository",
                verbose_name="所属仓库",
            ),
        ),
        migrations.AlterField(
            model_name="workflowdefinition",
            name="project",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="workflow_definitions",
                to="project.project",
                verbose_name="历史所属产品",
            ),
        ),
        migrations.RemoveConstraint(
            model_name="workflowdefinition",
            name="uniq_project_biz_release_type",
        ),
    ]
