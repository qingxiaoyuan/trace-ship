"""删除 Repository.project 历史登记项目字段，项目归属统一走 ProjectComponent。

同时把 CommitRecord.project 调整为可空（仓库未关联任何项目组件时，
同步提交没有可归项目）。依赖 project.0008 以确保所有读取 repository.project_id
的历史回填迁移都已执行完毕。
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("repository", "0012_unconditional_physical_repository_identity"),
        ("project", "0008_rename_project_component"),
    ]

    operations = [
        migrations.RemoveIndex(
            model_name="repository",
            name="sys_repo_project_37f35e_idx",
        ),
        migrations.RemoveIndex(
            model_name="repository",
            name="sys_repo_project_923219_idx",
        ),
        migrations.RemoveField(
            model_name="repository",
            name="project",
        ),
        migrations.AlterField(
            model_name="commitrecord",
            name="project",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="commits",
                to="project.project",
                verbose_name="项目",
            ),
        ),
    ]
