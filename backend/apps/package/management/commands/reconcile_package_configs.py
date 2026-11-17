"""只读盘点旧打包配置，并按明确确认的项目范围建立共享归属。"""

import json
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q
from django.http import Http404
from rest_framework.exceptions import ValidationError

from apps.account.models import User
from apps.package.models import PackageConfig, PackageConfigAssignment
from apps.package.services.configurations import CONFIG_RELATIONS, can_maintain_config, lock_package_config
from apps.release.models import ReleaseRecord
from apps.software.models import ProjectSoftware, Software
from apps.software.services import usable_project_repositories


class Command(BaseCommand):
    help = "盘点待归属的旧打包配置；提供软件、共享项目与依据后可显式确认。"

    def add_arguments(self, parser):
        parser.add_argument("--mapping", type=Path, help="JSON 数组，每项填写配置、软件、共享项目和依据")
        parser.add_argument("--actor", help="实际确认人登录名")
        parser.add_argument("--apply", action="store_true", help="写入确认后的共享归属；默认只读")

    def handle(self, *args, **options):
        entries = self._load_mapping(options["mapping"])
        apply = options["apply"]
        if entries or apply:
            actor = User.objects.filter(username=options["actor"], is_active=True).first()
            if actor is None or not entries:
                raise CommandError("确认归属须提供非空映射和启用的操作者账号")
        else:
            actor = None

        with transaction.atomic():
            result = self._confirm(entries, actor, apply)
            blocked = any(row["status"] == "blocked" for row in result)
            inventory = [
                self._inventory(row)
                for row in PackageConfig.objects.select_related(*CONFIG_RELATIONS, "assignment")
            ] if not (blocked and apply) else None
            if blocked and apply:
                transaction.set_rollback(True)
        if inventory is None:
            inventory = [
                self._inventory(row)
                for row in PackageConfig.objects.select_related(*CONFIG_RELATIONS, "assignment")
            ]
        self.stdout.write(json.dumps(
            {"applied": apply and not blocked, "configurations": inventory, "confirmations": result},
            ensure_ascii=False, indent=2,
        ))
        if blocked:
            raise CommandError("存在无法确认的配置；请核对报告后重试")

    @staticmethod
    def _load_mapping(path):
        if path is None:
            return {}
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(rows, list):
                raise ValueError
            entries = {}
            for row in rows:
                config_id = UUID(row["config"])
                basis = row["basis"].strip()
                projects = row["projects"]
                if config_id in entries or not basis or not isinstance(projects, list):
                    raise ValueError
                entries[config_id] = (UUID(row["software"]), sorted({str(UUID(pk)) for pk in projects}), basis)
            return entries
        except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
            raise CommandError("映射必须是有效 JSON，各条目须有唯一的 config、software、projects 和非空 basis") from exc

    def _confirm(self, entries, actor, apply):
        configs = {
            config.pk: config for config in
            PackageConfig.objects.filter(pk__in=entries).select_related(*CONFIG_RELATIONS)
        }
        order = sorted(entries, key=lambda pk: (str(configs[pk].source_repository_id) if pk in configs else "", str(pk)))
        report = []
        for pk in order:
            config = configs.get(pk)
            software_id, projects, basis = entries[pk]
            row = {"config": str(pk), "software": str(software_id), "projects": projects}
            if config is None:
                state, reason = "blocked", "打包配置不存在"
            else:
                try:
                    if apply:
                        config = lock_package_config(config)
                except (Http404, ValidationError):
                    state, reason = "blocked", "配置已变更或删除，请重新执行盘点"
                else:
                    state, reason = self._confirm_one(config, software_id, projects, basis, actor, apply)
            report.append({**row, "status": state, "reason": reason})
        return report

    @staticmethod
    def _confirm_one(config, software_id, projects, basis, actor, apply):
        if config.software_id:
            evidence = getattr(config, "assignment", None)
            if (evidence and config.software_id == software_id and evidence.shared_project_ids == projects
                    and evidence.basis == basis and evidence.confirmed_by_id == actor.pk):
                return "confirmed", ""
            return "blocked", "配置已归属，现有确认资料与请求不同"

        component = config.project_component
        software = Software.objects.filter(pk=software_id, repository_id=component.repository_id, is_active=True).first()
        if software is None:
            return "blocked", "目标必须是同仓库的启用软件"
        if not (can_maintain_config(actor, component=component) and can_maintain_config(actor, software=software)):
            return "blocked", "操作者须同时有权维护原项目配置和目标软件配置"

        active_projects = sorted(
            str(link.project_id)
            for link in ProjectSoftware.objects.filter(software=software, is_active=True).select_related("project")
            if usable_project_repositories(link.project).filter(pk=software.repository_id).exists()
        )
        if str(component.project_id) not in active_projects or projects != active_projects:
            return "blocked", "确认范围须包括原项目并与当前可使用该软件的项目一致"

        blocking_releases = Command._pending_release_ids(config)
        if blocking_releases:
            return "blocked", f"请先处理引用配置的旧发布申请：{', '.join(blocking_releases)}"

        if not apply:
            return "ready", ""
        PackageConfigAssignment.objects.create(
            config=config, legacy_component_id=component.pk, legacy_project_id=component.project_id,
            shared_project_ids=projects, confirmed_by=actor, confirmed_by_username=actor.username, basis=basis,
        )
        config.project_component = None
        config.software = software
        config.save(update_fields=["project_component", "software", "updated_at"])
        return "confirmed", ""

    @staticmethod
    def _pending_release_ids(config):
        component = config.project_component
        retryable = Q(status="rejected") & (
            Q(workflow_instance__status="completed")
            | (Q(workflow_instance__isnull=True) & ~Q(release_type="formal"))
        )
        unfinished = ReleaseRecord.objects.filter(
            Q(status__in=("draft", "pending")) | retryable,
            project_id=component.project_id, repository_id=component.repository_id,
        ).values_list("id", "package_config_ids")
        return sorted(
            str(release_id) for release_id, selected in unfinished
            if (selected is None and config.auto_package_on_release)
            or (isinstance(selected, list) and str(config.pk) in map(str, selected))
        )

    @staticmethod
    def _svn_target(value):
        try:
            parts = urlsplit(value)
            if not parts.hostname:
                return ""
            port = f":{parts.port}" if parts.port else ""
        except ValueError:
            return ""
        host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
        return f"{parts.scheme}://{host}{port}{parts.path}"

    def _inventory(self, config):
        evidence = getattr(config, "assignment", None)
        return {
            "config": str(config.pk), "name": config.name,
            "repository": str(config.source_repository_id),
            "legacy_component": str(evidence.legacy_component_id if evidence else config.project_component_id or ""),
            "software": str(config.software_id) if config.software_id else None,
            "config_status": "confirmed" if evidence else "shared" if config.software_id else "unassigned",
            "executor": config.executor_type, "has_custom_script": bool(config.custom_script),
            "environment_keys": sorted(config.env_vars) if isinstance(config.env_vars, dict) else [],
            "svn_credential_id": str(config.svn_credential_id) if config.svn_credential_id else None,
            "svn_push_enabled": config.svn_push_enabled,
            "svn_target": self._svn_target(config.svn_url),
            "svn_path_template": config.svn_path_template,
            "svn_commit_mode": config.svn_commit_mode,
            "task_count": config.tasks.count(),
            "confirmation": ({
                "confirmed_by": evidence.confirmed_by_username, "basis": evidence.basis,
                "confirmed_at": evidence.confirmed_at.isoformat(), "projects": evidence.shared_project_ids,
                "legacy_project": str(evidence.legacy_project_id),
            } if evidence else None),
        }
