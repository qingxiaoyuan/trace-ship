"""ProductComponent 更名为 ProjectComponent。

表名 project_component 保持不变；跨 app 依赖确保所有仍引用旧模型名的
历史迁移（FK 引用与 RunPython 回填）都在重命名之前执行完毕。
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("project", "0007_remove_legacy_product_release_enabled"),
        ("credential", "0012_backfill_repository_loans"),
        ("package", "0028_require_package_component"),
        ("workflow", "0008_rc_beta_skip_approval_by_default"),
    ]

    operations = [
        migrations.RenameModel(
            old_name="ProductComponent",
            new_name="ProjectComponent",
        ),
        migrations.RenameField(
            model_name="projectcomponent",
            old_name="product_config",
            new_name="project_config",
        ),
        migrations.RemoveConstraint(
            model_name="projectcomponent",
            name="uniq_product_component_code",
        ),
        migrations.AddConstraint(
            model_name="projectcomponent",
            constraint=models.UniqueConstraint(
                fields=("project", "component_code"),
                name="uniq_project_component_code",
            ),
        ),
    ]
