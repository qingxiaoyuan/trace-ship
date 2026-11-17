"""发布说明与下游通知复用的已保存软件名称。"""


def release_software_name(release) -> str:
    """优先使用发布时名称；尚未确认归属的记录保持未知。"""
    if not release.software_id:
        return "软件归属未知"
    return release.software_name_snapshot or release.software.name


def release_delivery_label(release) -> str:
    """用于已授权的发布和审批消息，表达软件版本与固定来源。"""
    details = [release.tag_name, f"源码 {release.git_hash}" if release.git_hash else ""]
    suffix = " · ".join(part for part in details if part)
    return f"{release_software_name(release)} {release.version}" + (f"（{suffix}）" if suffix else "")
