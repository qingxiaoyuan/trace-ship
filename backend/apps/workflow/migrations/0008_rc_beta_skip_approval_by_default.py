"""RC / Beta 默认无须审批：清空仍为系统默认单节点的审批链。"""
from django.db import migrations


def _is_system_default_chain(node_config) -> bool:
    """单节点且审批人为产品负责人或仓库拥有者，视为未定制的默认链。"""
    if not node_config:
        return True
    if len(node_config) != 1:
        return False
    approvers = node_config[0].get("approvers") or []
    if len(approvers) != 1:
        return False
    return approvers[0].get("type") in {"leader", "repo_owner"}


def clear_default_rc_beta_approval(apps, schema_editor):
    """已定制过多节点或指定人员的 RC/Beta 流程保留不动。"""
    WorkflowDefinition = apps.get_model("workflow", "WorkflowDefinition")
    for definition in WorkflowDefinition.objects.filter(
        biz_type="release", release_type__in=["rc", "beta"]
    ).iterator():
        if not _is_system_default_chain(definition.node_config):
            continue
        definition.node_config = []
        definition.graph_data = {}
        definition.save(update_fields=["node_config", "graph_data"])


class Migration(migrations.Migration):

    dependencies = [
        ("workflow", "0007_workflowdefinition_repository_indexes"),
    ]

    operations = [
        migrations.RunPython(clear_default_rc_beta_approval, migrations.RunPython.noop),
    ]
