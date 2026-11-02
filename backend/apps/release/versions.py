"""仓库级版本序列与流程占用，调用方在仓库行锁内改变占用。"""

import re

from rest_framework import serializers

from apps.release.models import ReleaseRecord, ReleaseVersionClaim
from utils.provider.base import TagInfo


def version_tags(repository, tags: list[TagInfo]) -> list[TagInfo]:
    """成功发布历史独立于远端引用寿命；草稿和进行中申请不抬高编号。"""
    history = ReleaseRecord.objects.filter(
        repository=repository,
        status="released",
    ).values_list("tag_name", flat=True)
    consumed = ReleaseVersionClaim.objects.filter(repository=repository, consumed=True, release__isnull=False).values_list(
        "tag_name", flat=True
    )
    return [*tags, *[TagInfo(name=name) for name in {*history, *consumed}]]


def version_key(repository, release_type: str, tag: str) -> str:
    from apps.release.services import VersionCalculator

    calculator = VersionCalculator(repository.get_version_rule())
    match = calculator._build_regex(release_type).fullmatch(tag)
    if not match:
        raise serializers.ValidationError({"version": "版本号不符合仓库当前规则，请修改草稿后重试"})
    return ".".join(str(int(match.group(part))) for part in ("major", "minor", "patch"))


def _claimed_tag_pattern(claim: ReleaseVersionClaim) -> re.Pattern:
    """从占用快照还原旧 Tag 的边界，编号按整数比较，不依赖现行仓库规则。"""
    old_tag = re.sub(r"_\d{8}$", "", claim.tag_name)
    version = r"\.".join(f"0*{int(part)}" for part in claim.base_version.split("."))
    identity = re.fullmatch(rf"(?P<prefix>.*\.)?{version}(?P<suffix>-.*)?", old_tag)
    if identity:
        old_tag = (
            re.escape(identity.group("prefix") or "")
            + version
            + re.escape(identity.group("suffix") or "")
        )
    else:
        old_tag = re.escape(old_tag)
    return re.compile(rf"{old_tag}(?:_\d{{8}})?")


def claim_version(release: ReleaseRecord, tags: list[TagInfo]) -> None:
    """调用方持有仓库行锁；唯一约束兜底，不按项目或日期分隔。"""
    key = version_key(release.repository, release.release_type, release.tag_name)
    for tag in tags:
        try:
            other = version_key(release.repository, release.release_type, tag.name)
        except serializers.ValidationError:
            continue
        if other == key:
            raise serializers.ValidationError({"version": "该版本已发布，不能覆盖"})
    # 升级前已在审批的记录没有占用行，仍必须参与冲突检查。
    previous = ReleaseRecord.objects.filter(repository=release.repository, release_type=release.release_type).exclude(
        pk=release.pk
    )
    for other in previous.select_related("workflow_instance"):
        occupied = other.status in ("pending", "released") or (
            other.status == "rejected" and other.workflow_instance_id and other.workflow_instance.status == "completed"
        )
        try:
            other_key = version_key(release.repository, other.release_type, other.tag_name)
        except serializers.ValidationError:
            continue
        if occupied and other_key == key:
            raise serializers.ValidationError(
                {"version": "该版本已发布，不能覆盖" if other.status == "released" else "已有同版本在发布"}
            )
    claim, created = ReleaseVersionClaim.objects.get_or_create(
        repository=release.repository,
        release_type=release.release_type,
        base_version=key,
        defaults={"release": release, "tag_name": release.tag_name},
    )
    if not created:
        # 提审、推送与重试均核验原占用身份，不能因当前规则变化忽略旧 Tag。
        old_tag_pattern = _claimed_tag_pattern(claim)
        if any(old_tag_pattern.fullmatch(tag.name) for tag in tags):
            raise serializers.ValidationError({"version": "该版本已发布，不能覆盖"})
    if not created and claim.consumed and claim.release_id is None:
        # 转移使用权但保留旧 Tag 依据，审批期间外部恢复引用仍须阻止推送。
        claim.release = release
        claim.consumed = False
        claim.reused = True
        claim.save(update_fields=["release", "consumed", "reused"])
        return
    if not created and (claim.consumed or claim.release_id != release.id):
        raise serializers.ValidationError(
            {"version": "该版本已发布，不能覆盖" if claim.consumed else "已有同版本在发布"}
        )


def release_claim(release: ReleaseRecord) -> None:
    # 终止复用申请时恢复旧孤立占用，保留下一次申请检查旧身份的依据。
    release.version_claims.filter(consumed=False, reused=True).update(
        release=None, consumed=True, reused=False,
    )
    release.version_claims.filter(consumed=False).delete()
