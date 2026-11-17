"""软件和存量仓库的版本序列，调用方在仓库行锁内改变占用。"""

import re

from django.db.models import Q
from rest_framework import serializers

from apps.release.models import ReleaseRecord, ReleaseVersionClaim
from utils.provider.base import TagInfo

MAX_RELEASE_TAG_LENGTH = 181


def version_tags(repository, tags: list[TagInfo]) -> list[TagInfo]:
    """成功发布历史独立于远端引用寿命；草稿和进行中申请不抬高编号。"""
    history = ReleaseRecord.objects.filter(
        repository=repository, status="released",
    ).filter(Q(software__isnull=True) | Q(software_confirmed_at__isnull=False)).values_list("tag_name", flat=True)
    consumed = ReleaseVersionClaim.objects.filter(repository=repository, software__isnull=True, consumed=True,
        release__isnull=False, release__software__isnull=True).values_list(
        "tag_name", flat=True
    )
    namespaces = set(repository.software.values_list("slug", flat=True))
    remote = [tag for tag in tags if "/" not in tag.name or tag.name.split("/", 1)[0] not in namespaces]
    return [*remote, *[TagInfo(name=name) for name in {*history, *consumed}]]


def software_tag_part(software, tag: str) -> str | None:
    """只接受目标软件的完整命名空间，返回原版本格式部分。"""
    prefix = f"{software.slug}/"
    return tag[len(prefix):] if tag.startswith(prefix) else None


def software_tag(software, part: str, *, release_type: str) -> str:
    """为合法的仓库版本部分加软件命名空间。"""
    full_tag = f"{software.slug}/{part}"
    if len(part) > 100 or len(full_tag) > MAX_RELEASE_TAG_LENGTH:
        raise serializers.ValidationError({"tag_name": "版本 Tag 最多 100 个字符"})
    version_key(software.repository, release_type, part)
    return full_tag


def normalize_software_tag(software, release_type: str, tag: str) -> tuple[str, str]:
    """保留仓库已有的后缀、日期和保存往返规则。"""
    from apps.release.services import ReleaseValidator

    part = software_tag_part(software, tag) or tag
    rule = software.repository.get_version_rule()
    suffixes = rule.get("suffixes") or ReleaseValidator.get_default_suffixes()
    suffix = (suffixes.get(release_type, "") or "").strip("-") if release_type in ("rc", "beta") else ""
    if suffix and not re.search(rf"-{re.escape(suffix)}(?:_\d{{8}})?$", part):
        offset = -9 if re.search(r"_\d{8}$", part) else len(part)
        part = f"{part[:offset]}-{suffix}{part[offset:]}"
    part = ReleaseValidator.ensure_tag_date(part, rule)
    try:
        full_tag = software_tag(software, part, release_type=release_type)
    except serializers.ValidationError:
        if "/" in tag and software_tag_part(software, tag) is None:
            raise serializers.ValidationError({"tag_name": "Tag 前缀必须对应所选软件"})
        raise
    return ReleaseValidator.strip_suffix(part, rule), full_tag


def version_key(repository, release_type: str, tag: str) -> str:
    from apps.release.services import VersionCalculator

    calculator = VersionCalculator(repository.get_version_rule())
    if release_type in ("rc", "beta") and not (calculator.suffixes.get(release_type) or "").strip("-"):
        raise serializers.ValidationError({"version": "仓库未配置该发布类型的版本后缀"})
    match = calculator._build_regex(release_type).fullmatch(tag)
    if not match:
        raise serializers.ValidationError({"version": "版本号不符合仓库当前规则，请修改草稿后重试"})
    return ".".join(str(int(match.group(part))) for part in ("major", "minor", "patch"))


def _claimed_tag_pattern(claim: ReleaseVersionClaim) -> re.Pattern:
    """从占用快照还原旧 Tag 的边界，编号按整数比较，不依赖现行仓库规则。"""
    previous_part = software_tag_part(claim.software, claim.tag_name) if claim.software_id else claim.tag_name
    if previous_part is None:
        return re.compile(re.escape(claim.tag_name))
    old_tag = re.sub(r"_\d{8}$", "", previous_part)
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
    namespace = re.escape(f"{claim.software.slug}/") if claim.software_id else ""
    return re.compile(rf"{namespace}{old_tag}(?:_\d{{8}})?")


def historical_version_keys(release: ReleaseRecord) -> set[str]:
    """去除已证实的命名空间；旧 Tag 保留原边界，以及真实占用保存的编号。"""
    if release.historical_base_version:
        return {release.historical_base_version}
    versions = {
        claim.base_version for claim in release.version_claims.all()
        if claim.repository_id == release.repository_id and claim.release_type == release.release_type
        and claim.software_id == release.software_id
    }
    if versions:
        return versions
    tag = software_tag_part(release.software, release.tag_name) if release.software_id else release.tag_name
    suffix = r"-.+" if release.release_type in ("rc", "beta") else r"(?:_\d{8})?"
    return {
        ".".join(str(int(part)) for part in match.group("version").split("."))
        for match in re.finditer(rf"(?:^|(?<=\.))(?=(?P<version>\d+\.\d+\.\d+){suffix}$)", tag or "")
    }


def _history_matches_version(release: ReleaseRecord, key: str) -> bool:
    versions = historical_version_keys(release)
    if key not in versions:
        return False
    if len(versions) > 1:
        raise serializers.ValidationError({
            "version": f"历史发布 {release.tag_name} 的版本身份存在歧义，请核对该记录的版本号与 Tag 后重试",
        })
    return True


def _other_release_tag_names(software, tags: list[TagInfo]) -> set[str]:
    """仓库里已有平台身份的旧 Tag 不能按词法前缀改判归属。"""
    return set(ReleaseRecord.objects.filter(
        repository_id=software.repository_id, tag_name__in=[tag.name for tag in tags],
    ).exclude(status="draft").exclude(software=software).values_list("tag_name", flat=True))


def software_version_candidates(software, release_type: str, tags: list[TagInfo]) -> list[tuple]:
    """返回基础编号、完整 Tag 与源码 SHA，平台发布的快照优先。"""
    from apps.release.services import VersionCalculator

    pattern = VersionCalculator(software.repository.get_version_rule())._build_regex(release_type)
    history = list(ReleaseRecord.objects.filter(software=software, release_type=release_type, status="released")
                   .prefetch_related("version_claims"))
    unavailable = _other_release_tag_names(software, tags) | {release.tag_name for release in history}
    candidates = []
    for tag in tags:
        match = pattern.fullmatch(software_tag_part(software, tag.name) or "")
        if match and tag.name not in unavailable:
            key = tuple(int(match.group(field)) for field in ("major", "minor", "patch"))
            candidates.append((key, tag.name, tag.commit_hash or ""))
    for release in history:
        versions = historical_version_keys(release)
        if len(versions) != 1:
            raise serializers.ValidationError({"version": f"软件发布 {release.tag_name} 缺少唯一版本身份"})
        key = tuple(map(int, next(iter(versions)).split(".")))
        candidates.append((key, release.tag_name, release.git_hash))
    return candidates


def suggest_software_version(software, release_type: str, tags: list[TagInfo]) -> dict:
    from apps.release.services import VersionCalculator

    calculator = VersionCalculator(software.repository.get_version_rule())
    candidates = software_version_candidates(software, release_type, tags)
    latest = max(candidates, default=None)
    # 在途及推送未确认仍占用编号，但只把真实版本作为最近发布和变更基线。
    claims = ReleaseVersionClaim.objects.filter(
        repository=software.repository, software=software, release_type=release_type, release__isnull=False,
    ).filter(Q(consumed=True) | Q(release__status__in=("pending", "rejected")))
    occupied = max((tuple(map(int, key.split("."))) for key in claims.values_list("base_version", flat=True)), default=None)
    previous = max(filter(None, (latest[0] if latest else None, occupied)), default=None)
    version, tag = calculator.calculate([], release_type, previous_version=previous)
    return {
        "latest_tag": latest[1] if latest else None,
        "next_version": version,
        "next_tag_name": software_tag(software, tag, release_type=release_type),
    }



def suggest_software_versions(software, release_type: str, tags: list[TagInfo]) -> dict:
    """请求类型单独校验，其余类型各自提供可用的建议。"""
    requested = suggest_software_version(software, release_type, tags)
    all_types = {release_type: requested}
    for kind in ("formal", "rc", "beta"):
        if kind == release_type:
            continue
        try:
            all_types[kind] = suggest_software_version(software, kind, tags)
        except serializers.ValidationError:
            continue
    return {
        **requested,
        "has_existing_tags": any(item["latest_tag"] for item in all_types.values()),
        "all_types": all_types,
    }

def guard_software_tag_identity(software, tag_name: str) -> None:
    """即使远端暂缺，已被其他身份记录的完整 Tag 也不能重新指向源码。"""
    records = ReleaseRecord.objects.filter(repository_id=software.repository_id, tag_name=tag_name).exclude(software=software)
    if records.filter(
        Q(status__in=("released", "pending")) | Q(status="rejected", workflow_instance__status="completed")
        | Q(status="rejected", version_claims__isnull=False)
    ).exists() or ReleaseVersionClaim.objects.filter(
        repository_id=software.repository_id, tag_name=tag_name, release__isnull=False,
    ).exclude(software=software).exists():
        raise serializers.ValidationError({"tag_name": "原 Tag 名称受其他软件或待归属历史保护，不能使用此完整名称"})


def claim_version(release: ReleaseRecord, tags: list[TagInfo]) -> None:
    """调用方持有仓库行锁；唯一约束兜底，不按项目或日期分隔。"""
    software = release.software
    if software:
        guard_software_tag_identity(software, release.tag_name)
    part = software_tag_part(software, release.tag_name) if software else release.tag_name
    key = version_key(release.repository, release.release_type, part or "")
    claim = ReleaseVersionClaim.objects.filter(
        repository=release.repository, software=software, release_type=release.release_type, base_version=key,
    ).first()
    old_tag_pattern = _claimed_tag_pattern(claim) if claim else None

    def same_version(tag: str) -> bool:
        # 远端 Tag 没有发布记录，继续使用当前规则和占用保存的原身份核验。
        if old_tag_pattern and old_tag_pattern.fullmatch(tag):
            return True
        part = software_tag_part(software, tag) if software else tag
        if part is None:
            return False
        try:
            return version_key(release.repository, release.release_type, part) == key
        except serializers.ValidationError:
            return False

    other_tag_names = _other_release_tag_names(software, tags) if software else set()
    for tag in tags:
        if tag.name == release.tag_name or (tag.name not in other_tag_names and same_version(tag.name)):
            raise serializers.ValidationError({"version": "该版本已发布，不能覆盖"})
    # 升级前已在审批的记录没有占用行，仍必须参与冲突检查。
    previous = ReleaseRecord.objects.filter(
        repository=release.repository, software=software, release_type=release.release_type,
    ).exclude(pk=release.pk)
    if software is None:
        # 确认归属保留原始仓库占用与老标签，旧申请仍可识别该历史编号。
        previous = previous | ReleaseRecord.objects.filter(
            repository=release.repository, release_type=release.release_type, software_confirmed_at__isnull=False,
        )
    for other in previous.select_related("workflow_instance").prefetch_related("version_claims"):
        occupied = other.status in ("pending", "released") or (
            other.status == "rejected" and other.workflow_instance_id and other.workflow_instance.status == "completed"
        )
        if occupied and _history_matches_version(other, key):
            raise serializers.ValidationError(
                {"version": "该版本已发布，不能覆盖" if other.status == "released" else "已有同版本在发布"}
            )
    claim, created = ReleaseVersionClaim.objects.get_or_create(
        repository=release.repository,
        software=software,
        release_type=release.release_type,
        base_version=key,
        defaults={"release": release, "tag_name": release.tag_name},
    )
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
