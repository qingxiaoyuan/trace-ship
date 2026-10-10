"""手动清理 RC 远端标签，保留平台历史并在仓库行锁内重新核验。"""

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.release.models import ReleaseRecord, ReleaseTagCleanupAttempt
from apps.release.references import ReleaseReferences
from apps.repository.models import Repository, RepositoryTag
from utils.provider.exceptions import NotFoundError, ProviderError


def validation_message(exc: serializers.ValidationError) -> str:
    value = next(iter(exc.detail.values())) if isinstance(exc.detail, dict) else exc.detail
    return str(value[0] if isinstance(value, list) else value)


class TagCleanup:
    @staticmethod
    def preview(release: ReleaseRecord, tags: list) -> dict:
        result = {
            "id": str(release.id),
            "tag_name": release.tag_name,
            "git_hash": release.git_hash,
            "allowed": False,
            "reason": "",
            "protected_by": "",
            "cleanup_status": release.tag_cleanup_status,
        }
        try:
            if release.release_type != "rc" or release.status != "released":
                raise serializers.ValidationError({"release": "仅已发布 RC 可以清理 Tag"})
            # 即使原 RC 仍在，也必须找到可用正式引用后才允许删除。
            reference = ReleaseReferences.resolve(release, tags, excluded=release.tag_name)
            current = next((tag for tag in tags if tag.name == release.tag_name), None)
            if current and current.commit_hash != release.git_hash:
                raise serializers.ValidationError({"tag": "RC Tag 已被改写，停止清理"})
            ReleaseReferences.guard_delete(release.repository, release.tag_name, tags, allow_rc_cleanup=True)
            result.update(allowed=True, protected_by=reference)
        except serializers.ValidationError as exc:
            result["reason"] = validation_message(exc)
        return result

    @classmethod
    def execute(cls, release: ReleaseRecord, tag_name: str, user) -> dict:
        from django.core.cache import cache

        from apps.release.services import ReleaseService, tags_cache_key
        from apps.repository.services import RepositoryService

        if tag_name != release.tag_name:
            raise serializers.ValidationError({"tag_name": "请确认完整 RC Tag 名称，仅删除远端标签"})
        # 意图先提交，远端成功后本地写入失败时仍可据此对账。
        attempt = ReleaseTagCleanupAttempt.objects.create(release=release, actor=user)
        with transaction.atomic():
            Repository.objects.select_for_update(no_key=True).get(pk=release.repository_id)
            release = ReleaseRecord.objects.select_for_update().get(pk=release.pk)
            status, reason, reference = "failure", "", ""
            try:
                provider = ReleaseService._get_provider(
                    release.repository, user, project=release.project, operation="delete_tag"
                )
                tags = provider.list_tags(release.repository.external_identity)
                preview = cls.preview(release, tags)
                reference = preview["protected_by"]
                if not preview["allowed"]:
                    status, reason = "blocked", preview["reason"]
                else:
                    current = next((tag for tag in tags if tag.name == tag_name), None)
                    if current is None:
                        previous_intent = (
                            release.cleanup_attempts.exclude(pk=attempt.pk)
                            .filter(status__in=["attempting", "failure"])
                            .exists()
                        )
                        status = (
                            "already_cleaned"
                            if release.tag_cleanup_status == "cleaned"
                            else ("reconciled_missing" if previous_intent else "external_missing")
                        )
                    else:
                        try:
                            provider.delete_tag(release.repository.external_identity, tag_name)
                            status = "success"
                        except NotFoundError:
                            status = "external_missing"
                        # 验证删除确实生效；未知结果记录失败，下次先重新查验。
                        if any(
                            tag.name == tag_name for tag in provider.list_tags(release.repository.external_identity)
                        ):
                            raise ProviderError("远端 Tag 仍存在，未确认清理成功")
                    release.tag_cleanup_status = (
                        "cleaned" if status in ("success", "already_cleaned") else "external_missing"
                    )
                    if status == "reconciled_missing":
                        reason = "此前有未确认操作，现确认 Tag 已缺失；无法确定由平台还是外部删除"
                    release.tag_cleanup_reference = reference
                    if status != "already_cleaned":
                        release.tag_cleaned_at, release.tag_cleaned_by = timezone.now(), user
                    release.save(
                        update_fields=[
                            "tag_cleanup_status",
                            "tag_cleanup_reference",
                            "tag_cleaned_at",
                            "tag_cleaned_by",
                        ]
                    )
                    RepositoryTag.objects.filter(repository=release.repository, name=tag_name).delete()
                    cache.delete(
                        tags_cache_key(
                            release.repository.external_identity,
                            RepositoryService._resolve_server_url(release.repository),
                        )
                    )
            except serializers.ValidationError as exc:
                status, reason = "blocked", validation_message(exc)
            except ProviderError:
                status, reason = "failure", "远端操作未确认成功，请检查连接或凭证后重试对账"
            attempt.status, attempt.message, attempt.protected_by = status, reason, reference
            attempt.save(update_fields=["status", "message", "protected_by"])
            return {
                "id": str(release.id),
                "tag_name": tag_name,
                "status": status,
                "reason": reason,
                "protected_by": reference,
            }
