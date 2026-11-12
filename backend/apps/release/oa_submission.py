"""单产物归档派发：先提交不可重放的在途记录，再调用无防重能力的 OA。"""
import json
from contextlib import contextmanager

import requests
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import NotFound, ValidationError

from apps.package.models import PackageTask
from apps.release.models import OaArchiveApplication, ReleaseRecord
from apps.release.oa_archive import ArchiveFormInput, ArchiveSelectionInput, OaArchivePreparation
from apps.repository.models import Repository
from apps.system.oa_archive import OaArchiveConfig


class ArchiveSubmitInput(ArchiveSelectionInput):
    submission_id = serializers.UUIDField()
    form = ArchiveFormInput()
    previous_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    confirmation = serializers.ChoiceField(choices=["", "reapply", "retry", "checked_no_order"], required=False, default="")


def lock_repository(repository_id):
    """删除先完成时返回资源已失效，不把竞争误报为服务器错误。"""
    if Repository.objects.select_for_update(no_key=True).filter(pk=repository_id).first() is None:
        raise NotFound("来源仓库已删除")


def create_application(**values):
    """数据库唯一键兜底跨仓库碰撞；失败插入绝不获得派发机会。"""
    try:
        with transaction.atomic():
            return OaArchiveApplication.objects.create(**values)
    except IntegrityError as exc:
        raise ValidationError({"detail": "提交标识已使用或产物正在发送，请重新读取归档记录"}) from exc


def has_creation_result(data, *, specified_number):
    """校验契约的外层类型，不猜测 software_archive_id 对象内部字段。"""
    if (not isinstance(data, dict) or not isinstance(data.get("soft_number"), str)
            or not data["soft_number"].strip() or not isinstance(data.get("software_archive_id"), dict)
            or "number_apply_id" not in data):
        return False
    number_id = data["number_apply_id"]
    if isinstance(number_id, str):
        return bool(number_id.strip()) or specified_number
    return number_id is None and specified_number


def application_data(record):
    """只暴露项目内可见的业务资料，不提供未约定的 OA 跳转链接。"""
    return {
        "id": str(record.id), "submission_id": str(record.submission_id), "status": record.status,
        "operator": record.operator_snapshot, "source": record.source, "form": record.form,
        "message": record.message, "soft_number": record.soft_number,
        "software_archive_id": record.software_archive_id, "number_apply_id": record.number_apply_id,
        "response": record.response, "created_at": record.created_at.isoformat(),
        "finished_at": record.finished_at.isoformat() if record.finished_at else None,
        "previous_id": str(record.previous_id) if record.previous_id else None,
        "confirmation": record.confirmation,
    }


def guard_archive_delete(*, release=None, task=None):
    """调用方先持来源仓库锁，确保检查在任何文件或远端 Tag 副作用之前。"""
    query = OaArchiveApplication.objects.all()
    if release is not None:
        query = query.filter(protected_release=release)
    elif task is not None:
        query = query.filter(protected_task=task)
    else:
        raise ValueError("必须指定归档来源")
    if query.exists():
        raise ValidationError({"detail": "已有 OA 归档申请正在发送、已发起或结果未确认，不能删除来源记录"})


@contextmanager
def locked_archive_task(task):
    """任务删除与申请遵守仓库→发布→任务锁顺序。"""
    with transaction.atomic():
        lock_repository(task.repository_id)
        if task.release_id:
            ReleaseRecord.objects.select_for_update().filter(pk=task.release_id).first()
        task = PackageTask.objects.select_for_update().filter(pk=task.pk).first()
        if task is None:
            raise NotFound("打包任务已删除")
        guard_archive_delete(task=task)
        yield task


@contextmanager
def locked_archive_parent(instance):
    """父级删除同样先锁仓库，不能通过级联绕过归档来源保护。"""
    with transaction.atomic():
        if isinstance(instance, Repository):
            repositories = Repository.objects.filter(pk=instance.pk)
            protected = OaArchiveApplication.objects.filter(protected_release__repository=instance)
        else:
            repositories = Repository.objects.filter(releases__project=instance).distinct()
            protected = OaArchiveApplication.objects.filter(protected_release__project=instance)
        ids = list(repositories.values_list("pk", flat=True))
        list(Repository.objects.filter(pk__in=ids).order_by("pk").select_for_update(no_key=True))
        if protected.exists():
            raise ValidationError({"detail": "已有 OA 归档申请正在发送、已发起或结果未确认，不能级联删除来源记录"})
        yield


class OaArchiveSubmission:
    timeout = (5, 30)

    @classmethod
    def submit(cls, release, user, values):
        with transaction.atomic():
            lock_repository(release.repository_id)
            release = ReleaseRecord.objects.select_for_update().filter(pk=release.pk).first()
            if release is None:
                raise NotFound("发布记录已删除")
            OaArchivePreparation.require_permission(release, user)
            OaArchivePreparation.require_release(release)
            task = PackageTask.objects.select_for_update().filter(pk=values["task_id"]).first()
            if task is None:
                raise NotFound("打包任务已删除")
            OaArchivePreparation.require_task(release, task)
            # 重放只读取原结果；资料变更必须是新的显式操作，不能换标识重发。
            existing = OaArchiveApplication.objects.filter(submission_id=values["submission_id"]).first()
            if existing:
                if (existing.release_id != release.id or existing.task_id != task.id
                        or existing.operator_id != user.id or existing.form != values["form"]
                        or existing.source.get("artifact_id") != values["artifact_id"]
                        or existing.previous_id != values["previous_id"]
                        or existing.confirmation != values["confirmation"]):
                    raise ValidationError({"detail": "提交标识已用于其他申请资料，请重新读取归档记录"})
                return existing, False
            artifact = OaArchivePreparation.local_artifact(task, values["artifact_id"])
            previous = OaArchiveApplication.objects.filter(task=task, artifact_path=artifact["path"]).first()
            if previous:
                if previous.status == "sending":
                    raise ValidationError({"detail": "该产物正在发送，请等待结果；不能重复派发"})
                if previous.id != values["previous_id"]:
                    raise ValidationError({"detail": "该产物已有新的申请记录，请重新读取并确认最新结果"})
                expected = {"success": "reapply", "failure": "retry", "unknown": "checked_no_order"}[previous.status]
                if values["confirmation"] != expected:
                    raise ValidationError({"detail": "请确认已有申请；结果未确认时须先核对 OA 并确认未建单，再主动重试"})
            elif values["previous_id"] or values["confirmation"]:
                raise ValidationError({"detail": "此前申请不属于当前产物，请重新读取归档记录"})
            url = OaArchiveConfig.get_url()
            if not url:
                raise ValidationError({"detail": "尚未配置 OA 软件归档接口地址，请联系系统配置维护者"})
            record = create_application(
                submission_id=values["submission_id"], release=release, task=task,
                protected_release=release, protected_task=task, operator=user,
                operator_snapshot={"id": str(user.id), "username": user.username, "nickname": user.nickname},
                artifact_path=artifact["path"], form=values["form"], endpoint=url,
                previous=previous, confirmation=values["confirmation"],
                source={"release_id": str(release.id), "project_id": str(release.project_id),
                        "repository_id": str(release.repository_id), "version": release.version,
                        "tag_name": release.tag_name, "git_hash": release.git_hash,
                        "task_id": str(task.id), "task_name": task.name, "artifact_id": values["artifact_id"],
                        "path": artifact["path"], "artifact": artifact, "kind": "local", "supplemented": False,
                        "svn": task.stage_info.get("svn_push", {})},
            )
        # 必须在事务提交后发送；进程中断留下 sending，绝不自动重发。
        cls.dispatch(record)
        return record, True

    @classmethod
    def dispatch(cls, record):
        record.status = "unknown"
        record.message = "无法可靠取得 OA 创建结果，请核对 OA；系统不会自动重发"
        try:
            # 禁用环境认证/netrc 与重定向；只发 JSON，不携带请求用户令牌。
            with requests.Session() as session:
                session.trust_env = False
                response = session.post(record.endpoint, json=record.form, timeout=cls.timeout, allow_redirects=False)
            if 200 <= response.status_code < 300:
                body = response.json()
                # 部分 JSON 解码器接受 NaN/Infinity，数据库不接受；按未知结果落库。
                json.dumps(body, allow_nan=False)
                record.response = body
                if isinstance(body, dict) and type(body.get("code")) is int:
                    data = body.get("data")
                    if body["code"] == 0 and has_creation_result(data, specified_number=bool(record.form.get("soft_number"))):
                        record.status = "success"
                        record.message = "已发起归档"
                        record.soft_number = data["soft_number"]
                        record.software_archive_id = data["software_archive_id"]
                        record.number_apply_id = data.get("number_apply_id")
                    elif body["code"] == -1 and isinstance(body.get("msg"), str):
                        record.status = "failure"
                        record.message = body["msg"]
                        record.protected_release = None
                        record.protected_task = None
        except (requests.RequestException, ValueError):
            pass
        record.finished_at = timezone.now()
        record.save(update_fields=["status", "message", "response", "soft_number", "software_archive_id", "number_apply_id", "protected_release", "protected_task", "finished_at"])
