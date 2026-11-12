# 为独立 OA 申请及来源删除保护创建持久记录。

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('package', '0033_remove_svn_release_type_switches'),
        ('release', '0023_review_manifest_completeness'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='OaArchiveApplication',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('submission_id', models.UUIDField(unique=True)),
                ('operator_snapshot', models.JSONField(default=dict)),
                ('source', models.JSONField(default=dict)),
                ('artifact_path', models.TextField()),
                ('form', models.JSONField(default=dict)),
                ('endpoint', models.URLField(max_length=2000)),
                ('status', models.CharField(choices=[('sending', '发送中'), ('success', '已发起归档'), ('failure', 'OA 返回失败'), ('unknown', '结果未确认')], default='sending', max_length=16)),
                ('message', models.TextField(blank=True)),
                ('response', models.JSONField(null=True)),
                ('soft_number', models.TextField(blank=True)),
                ('software_archive_id', models.JSONField(null=True)),
                ('number_apply_id', models.JSONField(null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('finished_at', models.DateTimeField(null=True)),
                ('operator', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='oa_applications', to=settings.AUTH_USER_MODEL)),
                ('previous', models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name='following', to='release.oaarchiveapplication')),
                ('protected_release', models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name='oa_protections', to='release.releaserecord')),
                ('protected_task', models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name='oa_protections', to='package.packagetask')),
                ('release', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='oa_applications', to='release.releaserecord')),
                ('task', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='oa_applications', to='package.packagetask')),
            ],
            options={
                'db_table': 'oa_archive_application',
                'ordering': ['-created_at', '-id'],
            },
        ),
        migrations.AddConstraint(
            model_name='oaarchiveapplication',
            constraint=models.UniqueConstraint(condition=models.Q(('status', 'sending')), fields=('task', 'artifact_path'), name='oa_one_sending_per_file'),
        ),
    ]
