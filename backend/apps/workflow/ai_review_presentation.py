"""审查展示只返回待核查内容，固定快照和策略排除依据仍保存在后端。"""

from .ai_review_policy import diff_exclusion, path_exclusion


def _visible_warnings(warnings, excluded):
    # 仅去掉 provider 对已排除文件的正文不可读提示，不按路径子串吞掉其他警告。
    redundant = {f"文件 {path} 的差异不可完整读取" for path in excluded}
    return [warning for warning in warnings if warning not in redundant]


def present_coverage(coverage, policy_version=0):
    """策略排除仅展示数量；真实未覆盖文件和上下文缺口保持原样。"""
    result = {key: value for key, value in coverage.items() if key != "excluded_paths"}
    excluded = {item["path"] for item in coverage.get("excluded_paths", [])}
    if "warnings" in result:
        reasons = {item["path"]: item.get("reason") for item in coverage.get("excluded_paths", [])}
        skipped_context, warnings = set(), []
        for warning in _visible_warnings(result["warnings"], excluded):
            path = None
            if warning.startswith("补充文档按策略跳过："):
                candidate = warning.removeprefix("补充文档按策略跳过：")
                if candidate in excluded or (candidate not in coverage.get("unreviewed_paths", [])
                                             and path_exclusion(candidate, policy_version)):
                    path = candidate
            elif warning.startswith("请求的上下文未读取：") and warning.endswith("）"):
                candidate, separator, reason = warning.removeprefix("请求的上下文未读取：").rpartition("（")
                if separator and reason[:-1] in (reasons.get(candidate), path_exclusion(candidate, policy_version)):
                    path = candidate
            if path is not None:
                skipped_context.add(path)
            else:
                warnings.append(warning)
        if skipped_context:
            warnings.append(f"{len(skipped_context)} 个补充上下文按策略跳过，未纳入本轮审查")
        result["warnings"] = warnings
    return result


def review_diff_payload(scope, runs):
    """所有节点均排除才隐藏；历史计划和任何已保存的复核依据优先保留。"""
    candidates = None
    protected = set()
    for run in runs:
        coverage = run.coverage or {}
        manifest = (run.batch_results or {}).get("__plan__")
        if manifest is not None:
            excluded = {
                scope.diffs[ref["index"]].get("new_path") or scope.diffs[ref["index"]].get("old_path")
                for ref in manifest.get("blocked", [])
                if ref.get("category") == "excluded" and "fragment" not in ref
                and type(ref.get("index")) is int and 0 <= ref["index"] < len(scope.diffs)
            } if manifest.get("version") == 3 else set()
        elif "excluded_paths" in coverage:
            excluded = {item["path"] for item in coverage["excluded_paths"]}
        elif run.status in ("queued", "running") and not run.batch_results and not run.history:
            # 首次计划尚未生成时，目录预览复用同一策略，避免先展示大量依赖。
            excluded = {item.get("new_path") or item.get("old_path") for item in scope.diffs if diff_exclusion(item)}
        else:
            # 旧报告没有排除证据，不能用现行规则改写历史范围。
            excluded = set()
        candidates = excluded if candidates is None else candidates & excluded
        records = [{"coverage": coverage, "findings": run.findings}, *(run.history or [])]
        for record in records:
            saved = record.get("coverage") or {}
            protected.update(saved.get("reviewed_paths", []))
            protected.update(saved.get("unreviewed_paths", []))
            protected.update(item.get("path") for item in saved.get("unreviewed_fragments", []))
            protected.update(item.get("path") for item in record.get("findings", []))
            for batch in saved.get("batches", []):
                protected.update(batch.get("paths", []))
    protected.discard(None)
    hidden = candidates or set()
    diffs = [item for item in scope.diffs
             if (item.get("new_path") or item.get("old_path")) not in hidden
             or item.get("new_path") in protected or item.get("old_path") in protected]
    visible = {item.get("new_path") or item.get("old_path") for item in diffs}
    return {"diffs": diffs, "excluded_files": len(scope.diffs) - len(diffs),
            "manifest_complete": scope.manifest_complete,
            "warnings": _visible_warnings(scope.warnings or [], hidden - visible)}
