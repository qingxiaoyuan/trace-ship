"""
凭证作用范围收敛迁移

- 删除 scope / project / is_global 字段：凭证录入不再选择范围，统一为个人凭证
- SVN 凭证（svn_password）的全系统共享语义由 cred_type 推导（is_system_shared），
  无需落库字段；历史项目级凭证收敛为归属人的个人凭证
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("credential", "0006_remove_gitea_cred_type"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="credential",
            name="scope",
        ),
        migrations.RemoveField(
            model_name="credential",
            name="project",
        ),
        migrations.RemoveField(
            model_name="credential",
            name="is_global",
        ),
    ]
