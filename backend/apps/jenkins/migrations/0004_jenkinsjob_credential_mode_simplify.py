# Generated manually for simplifying jenkins job credential binding

from django.db import migrations, models


def convert_credential_mode(apps, schema_editor):
    """
    将旧凭证模式转换为 personal / project：
    - fixed：按绑定凭证的 scope 转为 project / personal
    - current_user / specified_user / global：开发环境直接重置，解绑凭证并置为 project（需重新绑定）
    """
    JenkinsJob = apps.get_model("jenkins", "JenkinsJob")

    for job in JenkinsJob.objects.exclude(credential__isnull=True):
        cred = job.credential
        if cred and cred.scope == "project":
            job.credential_mode = "project"
        else:
            job.credential_mode = "personal"
        job.save(update_fields=["credential_mode"])

    JenkinsJob.objects.exclude(credential_mode__in=["personal", "project"]).update(
        credential=None,
        credential_mode="project",
    )


class Migration(migrations.Migration):

    dependencies = [
        ("jenkins", "0003_jenkins_build_triggered_by_duration"),
    ]

    operations = [
        migrations.AlterField(
            model_name="jenkinsjob",
            name="credential_mode",
            field=models.CharField(
                choices=[("personal", "个人"), ("project", "项目")],
                default="project",
                max_length=20,
                verbose_name="凭证来源",
            ),
        ),
        migrations.RemoveField(
            model_name="jenkinsjob",
            name="specified_user",
        ),
        migrations.RunPython(convert_credential_mode, migrations.RunPython.noop),
    ]
