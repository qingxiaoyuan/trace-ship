"""
Jenkins 业务服务

封装 Jenkins 任务配置解析、托管 Pipeline 创建、构建触发、状态刷新以及关联发布状态回写。
"""
import json
from typing import Any, Dict

from django.utils import timezone
from rest_framework import serializers

from apps.jenkins.models import JenkinsBuild, JenkinsJob
from apps.repository.models import Repository
from apps.repository.serializers import RepositorySerializer
from apps.system.models import SystemConfig
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider
from utils.provider.jenkins import JenkinsProvider


class JenkinsService:
    """
    Jenkins 业务服务

    提供托管 Pipeline 创建、高级任务触发、构建状态刷新等能力。
    """

    @staticmethod
    def get_global_server_url() -> str:
        """
        获取系统级 Jenkins 地址。

        Jenkins 地址统一由系统参数维护，业务任务不再让用户单独配置。
        """
        config = SystemConfig.objects.filter(key="jenkins.server_url").first()
        value = (config.value if config else "").strip().rstrip("/")
        if not value:
            raise serializers.ValidationError({"jenkins_server": "请先在系统参数中配置 jenkins.server_url"})
        return value

    @staticmethod
    def resolve_server_url(job: JenkinsJob) -> str:
        """解析 Jenkins 服务器地址。"""
        return JenkinsService.get_global_server_url()

    @staticmethod
    def _get_provider(job: JenkinsJob, request_user=None) -> JenkinsProvider:
        """获取 JenkinsProvider 实例。"""
        server_url = JenkinsService.resolve_server_url(job)
        cred_data = resolve_credential(job, request_user)
        return get_provider("jenkins", server_url, cred_data)

    @staticmethod
    def _render_params(template: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """
        渲染参数模板

        将模板中的 {version} / {branch} / {git_hash} / {tag_name} 替换为实际值。
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

    @staticmethod
    def _safe_rel_path(value: str, default: str) -> str:
        """归一化 Jenkins 工作区内相对路径，禁止绝对路径与上跳路径。"""
        path = (value or default or ".").strip().replace("\\", "/").strip("/")
        if not path:
            return "."
        parts = [part for part in path.split("/") if part and part != "."]
        if any(part == ".." for part in parts):
            raise serializers.ValidationError({"path": "构建目录和输出目录不能包含 .."})
        return "/".join(parts) if parts else "."

    @staticmethod
    def _clone_url(repo: Repository) -> str:
        """返回仓库克隆地址。"""
        return RepositorySerializer().get_clone_url(repo)

    @staticmethod
    def _repo_credential_pair(repo: Repository, request_user=None) -> tuple[str, str]:
        """
        解析仓库凭证为 Jenkins username/password 凭据。

        Token 模式没有用户名时按平台提供一个常见占位用户名。
        """
        data = resolve_credential(repo, request_user)
        password = data.get("token") or data.get("password") or ""
        username = data.get("username") or ""
        if not username:
            if repo.vendor == "gitlab":
                username = "oauth2"
            elif repo.vendor in ("gitea", "github", "gitee"):
                username = password
            else:
                username = "git"
        return username, password

    @staticmethod
    def _repo_credential_id(repo: Repository) -> str:
        """生成 Jenkins 中的仓库凭据 ID。"""
        return f"trace-ship-repo-{repo.id}"

    @classmethod
    def _build_simple_pipeline_script(cls, job: JenkinsJob) -> str:
        """
        生成简单模式 Pipeline 脚本。

        Pipeline 固定接收 TAG_NAME 参数，checkout 指定 tag 后在 Docker 容器中执行预设脚本。
        """
        if not job.repository or not job.build_preset:
            raise serializers.ValidationError({"job": "简单模式任务缺少仓库或打包预设"})

        repo_url = cls._clone_url(job.repository)
        credential_id = cls._repo_credential_id(job.repository)
        build_path = cls._safe_rel_path(job.build_path, job.build_preset.default_build_path)
        output_path = cls._safe_rel_path(job.output_path, job.build_preset.default_output_path)
        workspace_build_path = f"/workspace/source/{build_path}" if build_path != "." else "/workspace/source"

        repo_url_q = json.dumps(repo_url)
        credential_id_q = json.dumps(credential_id)
        image_q = json.dumps(job.build_preset.image)
        script_entry_q = json.dumps(job.build_preset.script_entry)
        build_path_q = json.dumps(build_path)
        output_path_q = json.dumps(output_path)

        return f"""
pipeline {{
  agent any
  options {{
    timestamps()
    timeout(time: 60, unit: 'MINUTES')
  }}
  stages {{
    stage('校验参数') {{
      steps {{
        script {{
          if (!params.TAG_NAME?.trim()) {{
            error('TAG_NAME 不能为空')
          }}
        }}
      }}
    }}
    stage('拉取代码') {{
      steps {{
        dir('source') {{
          checkout([$class: 'GitSCM',
            branches: [[name: "refs/tags/${{params.TAG_NAME}}"]],
            userRemoteConfigs: [[url: {repo_url_q}, credentialsId: {credential_id_q}]]
          ])
        }}
      }}
    }}
    stage('容器打包') {{
      steps {{
        sh '''#!/bin/sh
set -eu
mkdir -p "source/{output_path}"
docker run --rm \\
  -e TAG_NAME="${{TAG_NAME}}" \\
  -e BUILD_PATH={build_path_q} \\
  -e OUTPUT_PATH={output_path_q} \\
  -v "$WORKSPACE/source:/workspace/source" \\
  -w "{workspace_build_path}" \\
  {image_q} {script_entry_q}
'''
      }}
    }}
    stage('归档产物') {{
      steps {{
        archiveArtifacts artifacts: 'source/{output_path}/**/*', allowEmptyArchive: true
      }}
    }}
  }}
}}
""".strip()

    @classmethod
    def ensure_managed_pipeline(cls, job: JenkinsJob, request_user=None) -> None:
        """
        为简单模式任务创建或更新 Jenkins 托管 Pipeline。
        """
        if job.config_mode != "simple":
            return
        provider = cls._get_provider(job, request_user)
        username, password = cls._repo_credential_pair(job.repository, request_user)
        credential_id = cls._repo_credential_id(job.repository)
        try:
            provider.create_or_update_username_password_credential(
                credential_id=credential_id,
                username=username,
                password=password,
                description=f"Trace Ship 仓库凭据: {job.repository.name}",
            )
            pipeline_script = cls._build_simple_pipeline_script(job)
            provider.create_or_update_pipeline_job(job.job_name, pipeline_script)
        except ProviderError as exc:
            raise serializers.ValidationError({"jenkins": str(exc)})

        job.managed_job = True
        job.pipeline_config = {
            "repo_credential_id": credential_id,
            "image": job.build_preset.image,
            "script_entry": job.build_preset.script_entry,
            "build_path": cls._safe_rel_path(job.build_path, job.build_preset.default_build_path),
            "output_path": cls._safe_rel_path(job.output_path, job.build_preset.default_output_path),
        }
        job.save(update_fields=["managed_job", "pipeline_config", "updated_at"])

    @classmethod
    def trigger_build(
        cls,
        job: JenkinsJob,
        release=None,
        request_user=None,
        tag_name: str = "",
    ) -> JenkinsBuild:
        """
        触发 Jenkins 构建。

        简单模式固定传 TAG_NAME；高级模式按 params_template 渲染。
        """
        if not job.is_active:
            raise serializers.ValidationError({"job": "任务已停用"})

        provider = cls._get_provider(job, request_user)
        if job.config_mode == "simple":
            tag = tag_name or getattr(release, "tag_name", "") or getattr(release, "version", "")
            if not tag:
                raise serializers.ValidationError({"tag_name": "简单模式触发构建必须指定 tag_name"})
            actual_params = {"TAG_NAME": tag}
        else:
            context = {
                "version": getattr(release, "version", ""),
                "branch": getattr(release, "branch", ""),
                "git_hash": getattr(release, "git_hash", ""),
                "tag_name": tag_name or getattr(release, "tag_name", ""),
            }
            actual_params = cls._render_params(job.params_template or {}, context)

        try:
            result = provider.trigger_build(job.job_name, actual_params)
        except ProviderError as exc:
            raise serializers.ValidationError({"job": str(exc)})

        release_id = getattr(release, "id", None)
        build = JenkinsBuild.objects.create(
            job=job,
            release_id=release_id,
            triggered_by=request_user,
            queue_id=str(result.get("queue_id", "")),
            status="queue",
            params=actual_params,
            stage_info={
                "mode": job.config_mode,
                "stages": ["校验参数", "拉取代码", "容器打包", "归档产物"] if job.config_mode == "simple" else [],
            },
        )

        if release_id:
            from apps.release.models import ReleaseRecord

            ReleaseRecord.objects.filter(id=release_id, jenkins_build__isnull=True).update(
                jenkins_build=build,
                updated_at=timezone.now(),
            )

        from apps.jenkins.tasks import poll_jenkins_build

        poll_jenkins_build.delay(str(build.id))
        return build

    @classmethod
    def trigger_auto_builds_for_release(cls, release, request_user=None) -> list[JenkinsBuild]:
        """
        发布推 tag 成功后触发同仓库启用的简单模式自动打包任务。
        """
        jobs = JenkinsJob.objects.filter(
            repository=release.repository,
            config_mode="simple",
            auto_build_on_release=True,
            is_active=True,
        ).select_related("project", "repository", "credential", "build_preset")
        builds = []
        for job in jobs:
            builds.append(cls.trigger_build(job, release=release, request_user=request_user, tag_name=release.tag_name))
        return builds

    @classmethod
    def refresh_build_status(cls, build: JenkinsBuild) -> JenkinsBuild:
        """刷新 Jenkins 构建状态。"""
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
            duration = info.get("duration") or 0
            estimated = info.get("estimated_duration") or 0
            if duration:
                build.duration = duration
            if estimated:
                build.estimated_duration = estimated
            if build.status in ("success", "failure", "aborted"):
                build.finished_at = build.finished_at or timezone.now()
            build.save(update_fields=[
                "status", "log_url", "artifact_info", "duration",
                "estimated_duration", "finished_at", "updated_at",
            ])
            cls._update_release_status(build)

        return build

    @staticmethod
    def _update_release_status(build: JenkinsBuild) -> None:
        """
        根据构建结果回写关联的 ReleaseRecord 状态。

        已发布的 release 不因后置打包失败回滚。
        """
        from apps.release.services import ReleaseService

        release = build.release
        if release and release.status == "released":
            return
        success = build.status == "success"
        error_msg = ""
        if not success:
            error_msg = f"Jenkins 构建{build.get_status_display()}"
        ReleaseService.handle_build_completed(build, success, error_msg)

    @classmethod
    def get_build_log(cls, build: JenkinsBuild) -> str:
        """获取构建日志文本。"""
        if build.build_number is None:
            return ""
        provider = cls._get_provider(build.job)
        try:
            return provider.get_build_log(build.job.job_name, build.build_number)
        except ProviderError:
            return ""
