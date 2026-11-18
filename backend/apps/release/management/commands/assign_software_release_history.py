"""只读盘点、预检和显式确认历史发布的软件归属。"""

import json
from pathlib import Path
from uuid import UUID

from django.core.management.base import BaseCommand, CommandError

from apps.account.models import User
from apps.release.software_history import assign_history, inventory


class Command(BaseCommand):
    help = "盘点历史发布与 Tag，并通过显式确认表附加软件归属。默认只读。"

    def add_arguments(self, parser):
        parser.add_argument("--repository", type=UUID, help="仅报告该主仓库")
        parser.add_argument("--mapping", type=Path, help="确认表 JSON 文件，包含 release、software 与 basis")
        parser.add_argument("--confirmed-by", help="软件维护负责人或超管的登录名")
        parser.add_argument("--apply", action="store_true", help="重新核验远端证据后保存确认")

    def handle(self, *args, **options):
        path = options["mapping"]
        if options["apply"] and not path:
            raise CommandError("--apply 必须提供 --mapping 与 --confirmed-by")
        proposals, user = [], None
        if path:
            user = User.objects.filter(username=options["confirmed_by"], is_active=True).first()
            if user is None:
                raise CommandError("请通过 --confirmed-by 指定启用的确认账号")
            try:
                source = json.loads(Path(path).read_text(encoding="utf-8"))
                if not isinstance(source, list) or not source:
                    raise ValueError("确认表必须为非空数组")
                for row in source:
                    basis = row["basis"].strip()
                    if not basis:
                        raise ValueError("每条确认记录均须填写依据")
                    proposals.append({"release": UUID(row["release"]), "software": UUID(row["software"]), "basis": basis})
            except (OSError, ValueError, TypeError, AttributeError, KeyError) as exc:
                raise CommandError("确认表必须是包含有效 release、software UUID 与依据的 JSON 数组") from exc

        repository_id = options["repository"]
        before = inventory(repository_id)
        results = assign_history(proposals, user, apply=options["apply"], repository_id=repository_id) if proposals else []
        after = inventory(repository_id) if options["apply"] else before
        self.stdout.write(json.dumps({
            "mode": "apply" if options["apply"] else "dry-run",
            "tag_evidence": "盘点只读本地 Tag 缓存；保存确认时实时核验原始 Tag 或有效等价引用",
            "before": before, "after": after, "proposals": results,
        }, ensure_ascii=False, indent=2, default=str))
        if options["apply"] and any(row["status"] == "blocked" for row in results):
            raise CommandError("确认表存在阻断项，本批次没有写入任何归属")
