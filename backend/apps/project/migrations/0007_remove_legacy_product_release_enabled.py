"""删除旧版本遗留的产品级发布开关字段。"""

from django.db import migrations


def remove_legacy_product_release_enabled(apps, schema_editor):
    """删除数据库中可能残留、但当前模型已不再使用的字段。"""
    project_model = apps.get_model("project", "Project")
    connection = schema_editor.connection
    table_name = project_model._meta.db_table
    column_name = "product_release_enabled"
    table_description = connection.introspection.get_table_description(connection.cursor(), table_name)
    column_names = {column.name for column in table_description}

    if column_name not in column_names:
        return

    schema_editor.execute(
        f"ALTER TABLE {schema_editor.quote_name(table_name)} "
        f"DROP COLUMN {schema_editor.quote_name(column_name)}"
    )


class Migration(migrations.Migration):

    dependencies = [
        ("project", "0006_remove_productcomponent_uniq_product_component_repository"),
    ]

    operations = [
        migrations.RunPython(
            remove_legacy_product_release_enabled,
            migrations.RunPython.noop,
        ),
    ]
