"""
新增 JenkinsBuild 触发人、构建耗时、预估耗时字段。
"""
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('jenkins', '0002_remove_jenkinsjob_integration_jenkinsjob_repository'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='jenkinsbuild',
            name='triggered_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='triggered_jenkins_builds',
                to=settings.AUTH_USER_MODEL,
                verbose_name='触发人',
            ),
        ),
        migrations.AddField(
            model_name='jenkinsbuild',
            name='duration',
            field=models.IntegerField(blank=True, null=True, verbose_name='构建耗时(ms)'),
        ),
        migrations.AddField(
            model_name='jenkinsbuild',
            name='estimated_duration',
            field=models.IntegerField(blank=True, null=True, verbose_name='预估耗时(ms)'),
        ),
    ]
