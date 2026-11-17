"""单产物归档派发：先提交不可重放的在途记录，再调用无防重能力的 OA。"""
import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from time import monotonic
from typing import Any
from urllib.parse import urlsplit, urlunsplit
from uuid import UUID

from django.db import IntegrityError, OperationalError, connection, transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError

from apps.account.models import User
from apps.package.models import PackageTask
from apps.project.models import Project
from apps.release.delivery_identity import release_software_name
from apps.release.models import OaArchiveApplication, ReleaseRecord
from apps.release.oa_archive import ArchiveFormInput, ArchiveSelectionInput, OaArchivePreparation
from apps.release.oa_http import OaHttpResult, post_archive
from apps.repository.models import Repository
from apps.system.oa_archive import OaArchiveConfig
from utils.permissions import IsProjectManager

# JSON 字符串中的实际 NUL 会编码成单个反斜杠开头的 \u0000；字面转义不受影响。
JSON_NUL = re.compile(r"(?<!\\)(?:\\\\)*\\u0000")
# 生产工作进程的 120 秒上限内，留出落库与响应的余量。
SUBMIT_BUDGET = 95
PREPARATION_BUDGET = 55
LOCK_WAIT_MS = 5_000


@contextmanager
def archive_submit_transaction() -> Iterator[None]:
    """限制归档对业务库行锁的等待，避免尚未发 OA 就耗尽请求时间。"""
    try:
        with transaction.atomic():
            if connection.vendor == "postgresql":
                with connection.cursor() as cursor:
                    cursor.execute("SELECT current_setting('lock_timeout')")
                    previous = cursor.fetchone()[0]
                    cursor.execute("SELECT set_config('lock_timeout', %s, true)", [f"{LOCK_WAIT_MS}ms"])
            yield
            if connection.vendor == "postgresql":
                with connection.cursor() as cursor:
                    cursor.execute("SELECT set_config('lock_timeout', %s, true)", [previous])
    except OperationalError as exc:
        if getattr(exc.__cause__, "pgcode", None) != "55P03":
            raise
        raise ValidationError({"detail": "等待归档资料锁超时，尚未发送 OA，请稍后重试"}) from exc


class ArchiveSubmitInput(ArchiveSelectionInput):
    submission_id = serializers.UUIDField()
    form = ArchiveFormInput()
    previous_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    confirmation = serializers.ChoiceField(choices=["", "reapply", "retry", "checked_no_order"], required=False, default="")


class ArchiveNoOrderInput(serializers.Serializer):
    application_id = serializers.UUIDField()
    confirmation = serializers.ChoiceField(choices=["checked_no_order"])
    evidence = serializers.CharField(max_length=2000)


def lock_repository(repository_id: UUID) -> None:
    """删除先完成时返回资源已失效，不把竞争误报为服务器错误。"""
    if Repository.objects.select_for_update(no_key=True).filter(pk=repository_id).first() is None:
        raise NotFound("来源仓库已删除")


def create_application(**values: Any) -> OaArchiveApplication:
    """数据库唯一键兜底跨仓库碰撞；失败插入绝不获得派发机会。"""
    try:
        with transaction.atomic():
            return OaArchiveApplication.objects.create(**values)
    except IntegrityError as exc:
        raise ValidationError({"detail": "提交标识已使用或产物正在发送，请重新读取归档记录"}) from exc


def creation_result_error(data: Any, *, specified_number: bool) -> str:
    """校验建单结果的外层字段，指出无法确认的原因。"""
    if not isinstance(data, dict):
        return "OA 建单结果缺少 data 对象"
    if not isinstance(data.get("soft_number"), str) or not data["soft_number"].strip():
        return "OA 建单结果的 data.soft_number 缺失或不是非空字符串"
    if not isinstance(data.get("software_archive_id"), dict):
        return "OA 建单结果的 data.software_archive_id 缺失或不是对象"
    if "number_apply_id" not in data:
        return "OA 建单结果缺少 data.number_apply_id"
    number_id = data["number_apply_id"]
    if isinstance(number_id, str) and (number_id.strip() or specified_number):
        return ""
    if number_id is None and specified_number:
        return ""
    return "OA 建单结果的 data.number_apply_id 无效"


def unknown_result_message(reason: str) -> str:
    return f"{reason}。请核对 OA 是否建单，系统不会自动重发"


def application_data(record: OaArchiveApplication) -> dict:
    """只暴露项目内可见的业务资料，不提供未约定的 OA 跳转链接。"""
    endpoint = urlsplit(record.endpoint)
    return {
        "id": str(record.id), "submission_id": str(record.submission_id), "status": record.status,
        "operator": record.operator_snapshot, "source": record.source, "form": record.form,
        "message": record.message, "soft_number": record.soft_number,
        "software_archive_id": record.software_archive_id, "number_apply_id": record.number_apply_id,
        "response": record.response, "oa_response": record.oa_response,
        "oa_endpoint": urlunsplit((endpoint.scheme, endpoint.netloc.rsplit("@", 1)[-1], endpoint.path, "", "")),
        "created_at": record.created_at.isoformat(),
        "finished_at": record.finished_at.isoformat() if record.finished_at else None,
        "previous_id": str(record.previous_id) if record.previous_id else None,
        "confirmation": record.confirmation,
        "no_order_confirmation": record.no_order_confirmation,
    }


def archive_records(release: ReleaseRecord, project: Project):
    """无任务外键的历史按原始来源快照授权。"""
    return release.oa_applications.filter(
        Q(task__project=project) | Q(task__isnull=True, source__project_id=str(project.pk))
    )


def guard_archive_delete(*, release: ReleaseRecord | None = None, task: PackageTask | None = None) -> None:
    """调用方先持来源仓库锁，确保检查在任何文件或远端 Tag 副作用之前。"""
    query = OaArchiveApplication.objects.all()
    if release is not None:
        query = query.filter(Q(protected_release=release) | Q(protected_task__release=release))
    elif task is not None:
        query = query.filter(protected_task=task)
    else:
        raise ValueError("必须指定归档来源")
    if query.exists():
        raise ValidationError({"detail": "已有 OA 归档申请正在发送、已发起、结果未确认或失败尚未核对，不能删除来源记录"})


@contextmanager
def locked_archive_task(task: PackageTask) -> Iterator[PackageTask]:
    """任务删除与申请遵守仓库→发布→任务锁顺序。"""
    with transaction.atomic():
        lock_repository(task.repository_id)
        if task.release_id:
            ReleaseRecord.objects.select_for_update().filter(pk=task.release_id).first()
        task = PackageTask.objects.select_for_update().filter(pk=task.pk).first()
        if task is None:
            raise NotFound("打包任务已删除")
        yield task


@contextmanager
def locked_archive_parent(instance: Repository | Project, *, user: User | None = None) -> Iterator[None]:
    """父级删除同样先锁仓库，不能通过级联绕过归档来源保护。"""
    with transaction.atomic():
        if isinstance(instance, Repository):
            repositories = Repository.objects.filter(pk=instance.pk)
            protected = OaArchiveApplication.objects.filter(
                Q(protected_release__repository=instance) | Q(protected_task__repository=instance)
                | Q(protected_task__release__repository=instance)
            )
            tasks = PackageTask.objects.filter(Q(repository=instance) | Q(release__repository=instance))
        else:
            tasks = PackageTask.objects.filter(Q(project=instance) | Q(release__project=instance))
            repositories = Repository.objects.filter(
                Q(releases__project=instance) | Q(package_tasks__in=tasks)
                | Q(software__project_links__project=instance) | Q(project_components__project=instance)
            ).distinct()
            protected = OaArchiveApplication.objects.filter(
                Q(protected_release__project=instance) | Q(protected_task__project=instance)
                | Q(protected_task__release__project=instance)
            )
        ids = set(repositories.values_list("pk", flat=True))
        list(Repository.objects.filter(pk__in=ids).order_by("pk").select_for_update(no_key=True))
        if isinstance(instance, Project):
            project = Project.objects.select_for_update(no_key=True).filter(pk=instance.pk).first()
            if project is None:
                raise NotFound("项目已删除")
            if user is not None and not IsProjectManager()._check(project, user):
                raise PermissionDenied("没有在当前项目删除记录的权限")
            if set(repositories.values_list("pk", flat=True)) - ids:
                raise ValidationError({"detail": "项目仓库关联在删除期间已变更，请刷新后重试"})
        if protected.exists():
            raise ValidationError({"detail": "已有 OA 归档申请正在发送、已发起、结果未确认或失败尚未核对，不能级联删除来源记录"})
        if tasks.filter(status__in=["queued", "running"]).exists():
            raise ValidationError({"detail": "仍有关联打包任务排队或运行，当前记录不能删除"})
        if tasks.filter(
            Q(software__isnull=False) | Q(release__software__isnull=False)
            | (Q(release__isnull=False) & ~Q(project_id=F("release__project_id")))
        ).exists():
            raise ValidationError({"detail": "仍有关联软件打包历史，请保留来源记录并停用当前对象"})
        yield


class OaArchiveSubmission:
    timeout = (5, 30)

    @classmethod
    def submit(cls, release: ReleaseRecord, user: User, values: dict, project_id=None) -> tuple[OaArchiveApplication, bool]:
        started = monotonic()
        prepare_by = started + PREPARATION_BUDGET
        with archive_submit_transaction():
            lock_repository(release.repository_id)
            release = ReleaseRecord.objects.select_for_update().filter(pk=release.pk).first()
            if release is None:
                raise NotFound("发布记录已删除")
            project = OaArchivePreparation.project(release, user, project_id)
            OaArchivePreparation.require_permission(release, project, user)
            OaArchivePreparation.require_release(release)
            task = PackageTask.objects.select_for_update().filter(pk=values["task_id"], project=project).first()
            if task is None:
                raise NotFound("打包任务不存在或无权查看")
            OaArchivePreparation.require_task(release, project, task)
            # 重放只读取原结果；资料变更必须是新的显式操作，不能换标识重发。
            existing = OaArchiveApplication.objects.filter(submission_id=values["submission_id"]).first()
            if existing:
                if (existing.release_id != release.id or existing.task_id != task.id
                        or existing.operator_id != user.id or existing.form != values["form"]
                        or existing.artifact_path != OaArchivePreparation.selection_path(task, values)
                        or existing.previous_id != values["previous_id"]
                        or existing.confirmation != values["confirmation"]):
                    raise ValidationError({"detail": "提交标识已用于其他申请资料，请重新读取归档记录"})
                return existing, False
            try:
                artifact = OaArchivePreparation.selected_artifact(task, values, deadline=prepare_by)
            except APIException as exc:
                if monotonic() < prepare_by:
                    raise
                raise ValidationError({"detail": "核验打包产物超时，尚未发送 OA，请稍后重试"}) from exc
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
            if monotonic() >= prepare_by:
                raise ValidationError({"detail": "核验打包产物超时，尚未发送 OA，请稍后重试"})
            record = create_application(
                submission_id=values["submission_id"], release=release, task=task,
                protected_release=release, protected_task=task, operator=user,
                operator_snapshot={"id": str(user.id), "username": user.username, "nickname": user.nickname},
                artifact_path=artifact["path"], form=values["form"], endpoint=url,
                previous=previous, confirmation=values["confirmation"],
                source={"release_id": str(release.id), "project_id": str(task.project_id),
                        "release_project_id": str(release.project_id),
                        "software_id": str(release.software_id) if release.software_id else None,
                        "software_name": release_software_name(release) if release.software_id else None,
                        "software_slug": release.software.slug if release.software_id else None,
                        "repository_id": str(release.repository_id), "repository_name": release.repository.name,
                        "version": release.version, "branch": release.branch,
                        "tag_name": release.tag_name, "git_hash": release.git_hash,
                        "task_id": str(task.id), "task_name": task.name, "artifact_id": artifact.get("artifact_id"),
                        "path": artifact["path"], "scope": artifact.get("scope", "file"),
                        "artifact": artifact, "kind": artifact["kind"], "supplemented": artifact["supplemented"],
                        "svn": task.stage_info.get("svn_push", {})},
            )
        # 必须在事务提交后发送；进程中断留下 sending，绝不自动重发。
        cls.dispatch(record, deadline=started + SUBMIT_BUDGET)
        return record, True

    @classmethod
    def confirm_no_order(cls, release: ReleaseRecord, user: User, values: dict, project_id=None) -> OaArchiveApplication:
        """只解除本条失败申请的保护；不发送、不查单，保留核对依据。"""
        with transaction.atomic():
            lock_repository(release.repository_id)
            release = ReleaseRecord.objects.select_for_update().filter(pk=release.pk).first()
            if release is None:
                raise NotFound("发布记录已删除")
            project = OaArchivePreparation.project(release, user, project_id, history=True)
            OaArchivePreparation.require_permission(release, project, user)
            record = archive_records(release, project).filter(pk=values["application_id"]).first()
            if record is None:
                raise NotFound("归档申请不属于当前发布")
            if record.task_id:
                PackageTask.objects.select_for_update().filter(pk=record.task_id).first()
            record = OaArchiveApplication.objects.select_for_update().get(pk=record.pk)
            if record.status != "failure":
                raise ValidationError({"detail": "仅 OA 明确返回失败的申请可确认未建单；其他结果须继续保留来源"})
            if record.no_order_confirmation:
                return record
            record.no_order_confirmation = {
                "operator": {"id": str(user.id), "username": user.username, "nickname": user.nickname},
                "confirmed_at": timezone.now().isoformat(), "evidence": values["evidence"],
            }
            record.protected_release = None
            record.protected_task = None
            record.save(update_fields=["no_order_confirmation", "protected_release", "protected_task"])
            return record

    @classmethod
    def dispatch(cls, record: OaArchiveApplication, *, deadline: float) -> None:
        record.status = "unknown"
        total_timeout = min(cls.timeout[1], deadline - monotonic())
        response = OaHttpResult(error="归档提交等待超时")
        if total_timeout >= 0.001:
            try:
                response = post_archive(record.endpoint, record.form, connect_timeout=cls.timeout[0], total_timeout=total_timeout)
            except OSError:
                response = OaHttpResult(error="OA 响应暂存失败")
        cls.apply_response(record, response)
        record.finished_at = timezone.now()
        record.save(update_fields=["status", "message", "response", "oa_response", "soft_number", "software_archive_id", "number_apply_id", "finished_at"])

    @staticmethod
    def apply_response(record: OaArchiveApplication, response: OaHttpResult) -> None:
        snapshot = record.oa_response = response.snapshot()
        if response.error or snapshot is None:
            reason = response.error or "未收到 OA 响应"
            if snapshot is not None:
                reason += f"（已收到 HTTP {snapshot['status_code']}，正文不完整）"
            record.message = unknown_result_message(reason)
            return
        try:
            if "body_base64" in snapshot:
                raise ValueError("OA 正文不能完整表示为文本")
            body = json.loads(snapshot["body"].removeprefix("\ufeff"))
            # PostgreSQL JSONB 拒绝非有限数字、NUL 和无效代理字符。
            serialized = json.dumps(body, allow_nan=False, ensure_ascii=False)
            serialized.encode("utf-8")
            if JSON_NUL.search(serialized):
                raise ValueError("OA JSON 正文含有 NUL 字符")
        except (ValueError, RecursionError):
            body = None
        record.response = body
        msg = body.get("msg") if isinstance(body, dict) else None
        if not 200 <= snapshot["status_code"] < 300:
            reason = f"OA 返回 HTTP {snapshot['status_code']}"
            if isinstance(msg, str) and msg.strip():
                reason += f"：{msg}"
            record.message = unknown_result_message(reason)
        elif isinstance(body, dict) and type(body.get("code")) is int and body["code"] == -1 and isinstance(msg, str):
            record.status = "failure"
            record.message = msg or "OA 拒绝本次申请"
        elif isinstance(body, dict) and type(body.get("code")) is int and body["code"] == 0:
            data = body.get("data")
            error = creation_result_error(data, specified_number=bool(record.form.get("soft_number")))
            if error:
                record.message = unknown_result_message(error)
                return
            record.status = "success"
            record.message = "已发起归档"
            record.soft_number = data["soft_number"]
            record.software_archive_id = data["software_archive_id"]
            record.number_apply_id = data["number_apply_id"]
        else:
            if "body_base64" in snapshot:
                reason = "OA 返回正文无法完整解码为文本"
            else:
                reason = "OA 未返回有效 JSON" if body is None else "OA 返回的业务状态或错误信息格式不符合约定"
            record.message = unknown_result_message(reason)
