"""
Jenkins 业务服务

封装 Jenkins 任务配置解析、凭证解析、构建触发、状态刷新以及关联发布状态回写。
"""
from datetime import datetime
from typing import Any, Dict, Optional

from django.utils import timezone
from rest_framework import serializers

from apps.jenkins.models import JenkinsBuild, JenkinsJob
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider
from utils.provider.jenkins import JenkinsProvider


class JenkinsService:
    """
    Jenkins 业务服务

    提供从任务到构建的全流程封装。
    """

    @staticmethod
    def resolve_server_url(job: JenkinsJob) -> str:
        """
        解析 Jenkins 服务器地址

        任务直接保存服务器地址，不再经过外站绑定层。

        Args:
            job: JenkinsJob 实例

        Returns:
            服务器地址字符串
        """
        return job.server_url

    @staticmethod
    def _get_provider(job: JenkinsJob, request_user=None) -> JenkinsProvider:
        """
        获取 JenkinsProvider 实例

        Args:
            job: JenkinsJob 实例
            request_user: 当前请求用户

        Returns:
            JenkinsProvider 实例
        """
        server_url = JenkinsService.resolve_server_url(job)
        cred_data = resolve_credential(job, request_user)
        return get_provider("jenkins", server_url, cred_data)

    @staticmethod
    def _render_params(template: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        渲染参数模板

        将模板中的 {{version}} / {{branch}} / {{git_hash}} 替换为实际值。

        Args:
            template: 参数模板字典
            context: 上下文变量

        Returns:
            渲染后的参数字典
        """
        rendered: Dict[str, Any] = {}
        for key, value in template.items():
            if isinstance(value, str):
                try:
                    rendered[key] = value.format(**context)
                except KeyError:
                    rendered[key] = value
            else:
                rendered[key] = value
        return rendered

    @classmethod
    def trigger_build(
        cls,
        job: JenkinsJob,
        release,
        request_user=None,
    ) -> JenkinsBuild:
        """
        触发 Jenkins 构建

        Args:
            job: JenkinsJob 实例
            release: ReleaseRecord 实例
            request_user: 当前请求用户

        Returns:
            新创建的 JenkinsBuild
        """
        provider = cls._get_provider(job, request_user)

        context = {
            "version": release.version,
            "branch": release.target_branch,
            "git_hash": release.git_hash,
        }
        actual_params = cls._render_params(job.params_template or {}, context)

        try:
            result = provider.trigger_build(job.job_name, actual_params)
        except ProviderError as exc:
            raise serializers.ValidationError({"job": str(exc)})

        build = JenkinsBuild.objects.create(
            job=job,
            queue_id=str(result.get("queue_id", "")),
            status="queue",
            params=actual_params,
        )

        # 关联发布记录
        from apps.release.models import ReleaseRecord
        ReleaseRecord.objects.filter(id=release.id).update(
            jenkins_build=build,
            updated_at=timezone.now(),
        )

        # 启动 Celery 轮询任务
        from apps.jenkins.tasks import poll_jenkins_build
        poll_jenkins_build.delay(str(build.id))
        return build

    @classmethod
    def refresh_build_status(cls, build: JenkinsBuild) -> JenkinsBuild:
        """
        刷新 Jenkins 构建状态

        Args:
            build: JenkinsBuild 实例

        Returns:
            更新后的 JenkinsBuild
        """
        provider = cls._get_provider(build.job)

        if build.build_number is None and build.queue_id:
            build_number = provider.get_build_number(build.job.job_name, build.queue_id)
            if build_number == -1:
                build.status = "aborted"
                build.finished_at = timezone.now()
                build.save(update_fields=["status", "finished_at", "updated_at"])
                cls._update_release_status(build)
                return build
            if build_number is not None:
                build.build_number = build_number
                build.status = "running"
                build.started_at = build.started_at or timezone.now()
                build.save(update_fields=["build_number", "status", "started_at", "updated_at"])

        if build.build_number is not None:
            info = provider.get_build_info(build.job.job_name, build.build_number)
            build.status = info.get("status", build.status)
            build.log_url = info.get("url", "")
            build.artifact_info = info.get("artifacts", [])
            if build.status in ("success", "failure", "aborted"):
                build.finished_at = build.finished_at or timezone.now()
            build.save(update_fields=["status", "log_url", "artifact_info", "finished_at", "updated_at"])
            cls._update_release_status(build)

        return build

    @staticmethod
    def _update_release_status(build: JenkinsBuild) -> None:
        """
        根据构建结果回写关联的 ReleaseRecord 状态

        Args:
            build: JenkinsBuild 实例
        """
        from apps.release.services import ReleaseService

        success = build.status == "success"
        error_msg = ""
        if not success:
            error_msg = f"Jenkins 构建{build.get_status_display()}"
        ReleaseService.handle_build_completed(build, success, error_msg)

    @classmethod
    def get_build_log(cls, build: JenkinsBuild) -> str:
        """
        获取构建日志文本

        Args:
            build: JenkinsBuild 实例

        Returns:
            日志文本
        """
        if build.build_number is None:
            return ""
        provider = cls._get_provider(build.job)
        try:
            return provider.get_build_log(build.job.job_name, build.build_number)
        except ProviderError:
            return ""
