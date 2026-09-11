"""兼容曾执行过产品组合发布草案的环境：保留同名空 tombstone。"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("package", "0025_packageconfig_product_component"),
    ]

    operations = []
