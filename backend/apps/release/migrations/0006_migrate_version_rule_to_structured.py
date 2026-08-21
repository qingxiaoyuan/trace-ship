"""将旧 version_rule 格式（format/initial）迁移为结构化格式（prefix/major/minor/patch/suffixes）"""
import re

from django.db import migrations


def parse_old_format(fmt: str, initial: str):
    """从旧 format 字符串解析 prefix 和字段名"""
    if not fmt:
        return "VA", 1, 0, 0
    # 匹配 {prefix}.{field1}.{field2}.{field3} 或 {field1}.{field2}.{field3}
    m = re.match(r"^(?:(?P<prefix>[^.{}]+)\.)?\{(\w+)\}\.\{(\w+)\}\.\{(\w+)\}$", fmt)
    if not m:
        return "VA", 1, 0, 0
    prefix = m.group("prefix") or ""
    # 从 initial 解析默认值
    parts = re.split(r"[.\-]", initial) if initial else []
    major = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 1
    minor = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
    patch = int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else 0
    return prefix, major, minor, patch


def forward(apps, schema_editor):
    Project = apps.get_model("project", "Project")
    for project in Project.objects.all():
        vr = project.version_rule or {}
        if "prefix" in vr:
            continue  # 已是新格式
        fmt = vr.get("format", "")
        initial = vr.get("initial", "")
        prefix, major, minor, patch = parse_old_format(fmt, initial)
        project.version_rule = {
            "prefix": prefix,
            "major": major,
            "minor": minor,
            "patch": patch,
            "suffixes": {"rc": "rc", "beta": "beta"},
        }
        # 清理 release_rule 中的旧 tag_prefixes
        rr = project.release_rule or {}
        rr.pop("tag_prefixes", None)
        rr.pop("test_prefix", None)
        project.release_rule = rr
        project.save(update_fields=["version_rule", "release_rule"])


def reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("release", "0005_merge_branches"),
        ("project", "0003_delete_projectintegration"),
    ]
    operations = [migrations.RunPython(forward, reverse)]
