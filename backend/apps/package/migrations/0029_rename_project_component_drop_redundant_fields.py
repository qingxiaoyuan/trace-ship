"""PackageConfig：product_component 改名 project_component，并删除冗余的 project/repository 字段。

删除前先用 RunPython 逐条比对旧 project/repository 与项目组件归属，
发现不一致立即中止迁移（不修改任何数据），人工核对修正后再重试。
"""

from django.db import migrations, models


def check_package_config_component_consistency(apps, schema_editor):
    """删除冗余字段前，校验打包配置的旧 project/repository 与项目组件归属一致。"""
    PackageConfig = apps.get_model("package", "PackageConfig")
    mismatched = []
    for config in PackageConfig.objects.select_related("product_component").iterator():
        component = config.product_component
        if component is None:
            mismatched.append(f"{config.id}(无项目组件)")
            continue
        if config.project_id != component.project_id or config.repository_id != component.repository_id:
            mismatched.append(str(config.id))
    if mismatched:
        sample = ", ".join(mismatched[:20])
        raise RuntimeError(
            f"检测到 {len(mismatched)} 条打包配置的 project/repository 与项目组件归属不一致，"
            "已中止迁移且不会修改任何数据。请先人工核对并修正以下配置后重试：" + sample
        )


class Migration(migrations.Migration):

    dependencies = [
        ("package", "0028_require_package_component"),
        ("project", "0008_rename_project_component"),
    ]

    operations = [
        migrations.RunPython(
            check_package_config_component_consistency,
            migrations.RunPython.noop,
        ),
        migrations.RenameField(
            model_name="packageconfig",
            old_name="product_component",
            new_name="project_component",
        ),
        migrations.RemoveIndex(
            model_name="packageconfig",
            name="package_con_project_7598ec_idx",
        ),
        migrations.RemoveIndex(
            model_name="packageconfig",
            name="package_con_reposit_137631_idx",
        ),
        migrations.RemoveField(
            model_name="packageconfig",
            name="project",
        ),
        migrations.RemoveField(
            model_name="packageconfig",
            name="repository",
        ),
        migrations.AddIndex(
            model_name="packageconfig",
            index=models.Index(
                fields=["project_component", "is_active"],
                name="package_con_comp_is_act_idx",
            ),
        ),
    ]
