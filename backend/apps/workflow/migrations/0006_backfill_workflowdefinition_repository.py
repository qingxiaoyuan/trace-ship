"""将存量产品级流程挂到仓库；必须与加字段、加索引分事务执行。"""
from django.db import migrations


DEFAULT_NODE_CONFIG = [
    {
        "node_id": "approval_1",
        "node_name": "仓库拥有者审批",
        "approvers": [{"type": "repo_owner"}],
        "mode": "any",
    }
]

BUILTIN_RELEASE_FLOW_NAMES = {
    "formal": "正式发布审批",
    "rc": "RC 发布审批",
    "beta": "Beta 发布审批",
}


def _repos_for_project(apps, project_id):
    """收集项目通过历史字段与产品组件关联的全部物理仓库。"""
    Repository = apps.get_model("repository", "Repository")
    ProductComponent = apps.get_model("project", "ProductComponent")
    repos = {}
    for repository in Repository.objects.filter(project_id=project_id):
        repos[repository.id] = repository
    for component in ProductComponent.objects.filter(project_id=project_id).select_related("repository"):
        if component.repository_id:
            repos[component.repository_id] = component.repository
    return list(repos.values())


def attach_definitions_to_repositories(apps, schema_editor):
    """将存量产品级流程复制到关联仓库，并为尚未有流程的仓库补齐内置定义。"""
    WorkflowDefinition = apps.get_model("workflow", "WorkflowDefinition")
    Repository = apps.get_model("repository", "Repository")

    for definition in list(WorkflowDefinition.objects.all()):
        if definition.repository_id or not definition.project_id:
            continue
        repos = _repos_for_project(apps, definition.project_id)
        if not repos:
            continue
        first, *rest = repos
        definition.repository_id = first.id
        definition.save(update_fields=["repository"])
        for repository in rest:
            exists = WorkflowDefinition.objects.filter(
                repository_id=repository.id,
                biz_type=definition.biz_type,
                release_type=definition.release_type,
            ).exists()
            if exists:
                continue
            WorkflowDefinition.objects.create(
                repository_id=repository.id,
                project_id=definition.project_id,
                name=definition.name,
                biz_type=definition.biz_type,
                release_type=definition.release_type,
                node_config=definition.node_config,
                graph_data=definition.graph_data,
                is_active=definition.is_active,
                created_by_id=definition.created_by_id,
            )

    for repository in Repository.objects.all().iterator():
        existing = set(
            WorkflowDefinition.objects.filter(
                repository_id=repository.id, biz_type="release"
            ).values_list("release_type", flat=True)
        )
        for release_type, name in BUILTIN_RELEASE_FLOW_NAMES.items():
            if release_type in existing:
                continue
            WorkflowDefinition.objects.create(
                repository_id=repository.id,
                project_id=repository.project_id,
                name=name,
                biz_type="release",
                release_type=release_type,
                node_config=[] if release_type in ("rc", "beta") else DEFAULT_NODE_CONFIG,
                graph_data={},
                is_active=True,
            )


class Migration(migrations.Migration):

    dependencies = [
        ("workflow", "0005_workflowdefinition_repository"),
    ]

    operations = [
        migrations.RunPython(attach_definitions_to_repositories, migrations.RunPython.noop),
    ]
