from django.db import migrations


def backfill_package_component(apps, schema_editor):
    """按旧 project + repository 找到或补建产品组件，并绑定打包配置。"""
    PackageConfig = apps.get_model("package", "PackageConfig")
    ProductComponent = apps.get_model("project", "ProductComponent")

    for config in PackageConfig.objects.filter(product_component_id=None).iterator():
        component = ProductComponent.objects.filter(
            project_id=config.project_id,
            repository_id=config.repository_id,
        ).order_by("sort_order", "created_at").first()
        if component is None:
            repository = config.repository
            base_code = (repository.name or "component").lower().replace(" ", "-")[:90]
            code = base_code
            suffix = 2
            while ProductComponent.objects.filter(
                project_id=config.project_id, component_code=code
            ).exists():
                code = f"{base_code[:85]}-{suffix}"
                suffix += 1
            component = ProductComponent.objects.create(
                project_id=config.project_id,
                repository_id=config.repository_id,
                component_code=code,
                display_name=repository.name,
                default_branch=repository.default_branch or "main",
            )
        config.product_component_id = component.id
        config.save(update_fields=["product_component"])


class Migration(migrations.Migration):
    dependencies = [
        ("package", "0026_packagetask_product_release_item"),
        ("project", "0006_remove_productcomponent_uniq_product_component_repository"),
    ]

    operations = [
        migrations.RunPython(backfill_package_component, migrations.RunPython.noop),
    ]
