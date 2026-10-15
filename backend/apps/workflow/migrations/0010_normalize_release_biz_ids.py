"""规范化已存在的发布业务 ID，保留业务关联与无法解析的历史值。"""
import uuid

from django.db import migrations


def normalize_release_biz_ids(apps, schema_editor) -> None:
    """只调整合法 UUID 的文本表示，不修改成员、审批状态或关联发布。"""
    instance_model = apps.get_model("workflow", "WorkflowInstance")
    database = schema_editor.connection.alias
    instances = instance_model.objects.using(database).filter(biz_type="release").only("id", "biz_id")
    for instance in instances.iterator(chunk_size=1000):
        try:
            canonical_id = str(uuid.UUID(instance.biz_id))
        except (ValueError, TypeError, AttributeError):
            continue
        if canonical_id != instance.biz_id:
            instance_model.objects.using(database).filter(pk=instance.pk).update(biz_id=canonical_id)


class Migration(migrations.Migration):
    dependencies = [("workflow", "0009_alter_workflowdefinition_project")]
    operations = [migrations.RunPython(normalize_release_biz_ids, migrations.RunPython.noop)]
