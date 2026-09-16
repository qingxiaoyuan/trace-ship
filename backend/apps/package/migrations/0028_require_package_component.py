import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("package", "0027_backfill_package_component"),
        ("project", "0006_remove_productcomponent_uniq_product_component_repository"),
    ]

    operations = [
        migrations.AlterField(
            model_name="packageconfig",
            name="product_component",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="package_configs",
                to="project.productcomponent",
                verbose_name="产品组件",
            ),
        ),
    ]
