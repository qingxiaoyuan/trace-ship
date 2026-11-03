"""容量降级仍保留可核验报告，按片段统计覆盖。"""
import json
import uuid
from types import SimpleNamespace

import pytest

from apps.workflow import ai_review_model as model


def sample(diffs, *, status="ready"):
    run = SimpleNamespace(id=uuid.uuid4(), settings_version=SimpleNamespace(skill_documents=[]),
                          instance=SimpleNamespace(created_by=None), batch_results={}, history=[])
    scope = SimpleNamespace(diffs=diffs, base_git_hash="a" * 40, head_git_hash="b" * 40,
                            context="", documents={}, context_is_requirement=False, status=status,
                            warnings=[] if status == "ready" else ["远端比较超时，清单不完整"])
    return run, scope


def finish(paths):
    return {"action": "finish", "reviewed_files": paths, "dimensions": ["安全"], "findings": []}, "{}"


@pytest.mark.parametrize("diff", [
    "@@ -5,160 +5,160 @@\n" + "".join(f"-旧行{i}=" + "x" * 60 + "\n+新行=" + "y" * 60 + "\n" for i in range(160)),
    "".join(f"@@ -{i * 10 + 1} +{i * 10 + 1} @@\n-旧值\n+新值" + "x" * 100 + "\n" for i in range(100)),
    "@@ -0,0 +1,200 @@\n" + "+新行内容\n" * 199 + "+最后一行\n\\ No newline at end of file\n",
    "@@ -1,200 +0,0 @@\n" + "-旧行内容\n" * 200,
], ids=["single_hunk", "multi_hunks", "new_file", "deleted_file"])
def test_large_file_is_partitioned_without_losing_lines_or_positions(monkeypatch, diff):
    monkeypatch.setattr(model, "MAX_INPUT", 4500)
    run, scope = sample([{"old_path": "large.ts", "new_path": "large.ts", "diff": diff}])
    names, plan, blocked = model._batch_plan(run, scope)
    assert names == ["large.ts"] and not blocked and len(plan) > 1
    actual = {"old": set(), "new": set()}
    lines = []
    for entry in plan:
        part = entry["diffs"][0]["diff"]
        assert model._valid_hunks(part)
        assert len(json.dumps(model._initial_payload(run, scope, entry["diffs"]), ensure_ascii=False).encode()) <= model.MAX_INPUT
        lines.extend(line for line in part.splitlines() if not line.startswith("@@"))
        for side, positions in model._line_positions(part).items():
            assert not actual[side] & positions
            actual[side].update(positions)
    assert lines == [line for line in diff.splitlines() if not line.startswith("@@")]
    assert actual == model._line_positions(diff)
    restored = model._restore_plan(scope, model._save_plan(scope, names, plan, blocked))
    assert restored == (names, plan, blocked)


@pytest.mark.django_db(transaction=True)
def test_one_failed_fragment_does_not_stop_other_batches_or_count_file_complete(monkeypatch):
    monkeypatch.setattr(model, "MAX_INPUT", 4500)
    run, scope = sample([{"old_path": "large.ts", "new_path": "large.ts",
                          "diff": "@@ -1,150 +1,150 @@\n" + ("-" + "a" * 40 + "\n+" + "b" * 40 + "\n") * 150}])
    monkeypatch.setattr("apps.workflow.services.resolve_release", lambda _: SimpleNamespace(repository=object()))
    calls = []

    def review(_run, batch, **kwargs):
        calls.append(batch.diffs)
        if len(calls) == 1:
            raise ValueError("外部服务故障")
        return {"status": "completed", "coverage": {"reviewed_paths": ["large.ts"]}, "dimensions": ["安全"], "findings": []}

    monkeypatch.setattr(model, "_review_batch", review)
    saved = {}
    report = model.review_scope(run, scope, checkpoint=lambda results, _: saved.update(results) or True)
    assert len(calls) > 2 and len(calls) == len(report["coverage"]["batches"])
    assert report["status"] == "partial"
    assert report["coverage"]["reviewed_files"] == 0
    assert report["coverage"]["reviewed_fragments"] > 0
    assert report["coverage"]["unreviewed_paths"] == ["large.ts"]
    assert len(report["coverage"]["unreviewed_fragments"]) == 1
    # 自动交人工后不允许原节点重试；此处验证中断恢复时仍只补未完成片段。
    run.batch_results = saved
    calls.clear()
    monkeypatch.setattr(model, "_review_batch", lambda _run, batch, **kwargs: calls.append(batch.diffs) or {
        "status": "completed", "coverage": {}, "dimensions": ["安全"], "findings": []})
    assert model.review_scope(run, scope)["status"] == "completed"
    assert len(calls) == 1


def test_turn_limit_reserves_one_final_answer_and_keeps_report(monkeypatch):
    run, scope = sample([{"new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}])
    monkeypatch.setattr(model, "MAX_TURNS", 3)
    calls = []

    def ask(_, messages):
        calls.append(messages.copy())
        if len(calls) < 3:
            return {"action": "diff"}, '{"action":"diff"}'
        assert "finish" in messages[-1]["content"]
        return finish(["a.py"])

    monkeypatch.setattr(model, "_ask", ask)
    result = model._review_batch(run, scope, release=object())
    assert len(calls) == 3 and result["coverage"]["reviewed_paths"] == ["a.py"]


def test_oversized_tool_reply_still_gets_bounded_finalization(monkeypatch):
    run, scope = sample([{"new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}])
    monkeypatch.setattr(model, "MAX_INPUT", 4500)
    provider = SimpleNamespace(get_file_raw=lambda *args, **kwargs: "私有源码" * 5000)
    monkeypatch.setattr(model.ReleaseService, "_get_provider", lambda *args, **kwargs: provider)
    calls = []

    def ask(_, messages):
        assert len(json.dumps(messages, ensure_ascii=False).encode()) <= model.MAX_INPUT
        calls.append(messages.copy())
        return ({"action": "read", "path": "a.py"}, "{}") if len(calls) == 1 else finish(["a.py"])

    monkeypatch.setattr(model, "_ask", ask)
    release = SimpleNamespace(repository=SimpleNamespace(external_identity="repo"), project=object())
    report = model._review_batch(run, scope, release=release)
    assert len(calls) == 2
    assert report["status"] == "incomplete" and report["coverage"]["reviewed_files"] == 1
    assert any("容量" in item for item in report["coverage"]["warnings"])


@pytest.mark.parametrize("change", ["missing", "duplicate", "changed_scope", "unknown_version"])
def test_saved_fragments_reject_missing_overlapping_or_changed_ranges(monkeypatch, change):
    monkeypatch.setattr(model, "MAX_INPUT", 4500)
    run, scope = sample([{"new_path": "a.py", "diff": "@@ -0,0 +1,200 @@\n" + "+" + "x" * 50 + "\n" + ("+" + "x" * 50 + "\n") * 199}])
    names, plan, blocked = model._batch_plan(run, scope)
    saved = model._save_plan(scope, names, plan, blocked)
    if change == "missing":
        saved["batches"].pop()
    elif change == "duplicate":
        saved["batches"].append(saved["batches"][0])
    elif change == "changed_scope":
        scope.diffs[0]["diff"] += "+unexpected"
    else:
        saved["version"] = 99
    with pytest.raises(ValueError):
        model._restore_plan(scope, saved)


def test_old_whole_file_plan_can_resume_without_replanning():
    import hashlib

    diffs = [{"new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}]
    _, scope = sample([*diffs, {"new_path": "blob.bin", "diff": "", "binary": True}])
    digest = hashlib.sha256(json.dumps(diffs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    legacy = {"digest": model._scope_digest(scope), "batches": [{"id": digest, "indexes": [0]}],
              "blocked": [{"index": 1, "reason": "文件差异不可完整读取"}]}
    names, plan, blocked = model._restore_plan(scope, legacy)
    assert names == ["a.py", "blob.bin"] and plan[0]["diffs"] == diffs
    assert plan[0]["id"] == digest and blocked[0]["path"] == "blob.bin"


def test_model_ignoring_finalization_does_not_get_extra_tools_or_fake_report(monkeypatch):
    run, scope = sample([{"new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}])
    calls = []
    monkeypatch.setattr(model, "MAX_TURNS", 2)
    monkeypatch.setattr(model, "_ask", lambda *args: calls.append(True) or ({"action": "diff"}, "{}"))
    report = model._review_batch(run, scope, release=object())
    assert len(calls) == 2 and report["status"] == "incomplete"
    assert report["coverage"]["reviewed_files"] == 0


def test_single_unreadable_line_keeps_exact_uncovered_range(monkeypatch):
    monkeypatch.setattr(model, "MAX_INPUT", 4500)
    run, scope = sample([{"old_path": "before.py", "new_path": "after.py",
                          "diff": "@@ -7,2 +7,2 @@\n-a\n-b\n+" + "x" * 5000 + "\n+ok\n"}])
    names, plan, blocked = model._batch_plan(run, scope)
    assert len(blocked) == 1 and blocked[0]["new_start"] == blocked[0]["new_end"] == 7
    assert "old_start" not in blocked[0]
    assert model._restore_plan(scope, model._save_plan(scope, names, plan, blocked)) == (names, plan, blocked)
    results = {entry["id"]: {"status": "completed", "dimensions": ["安全"], "findings": []} for entry in plan}
    report = model._batch_outcome(scope, names, plan, blocked, results)
    assert report["status"] == "partial" and report["coverage"]["reviewed_files"] == 0


@pytest.mark.parametrize("action", ["diff", "read"])
def test_context_pages_reach_large_file_tail_with_bounded_payload(monkeypatch, action):
    monkeypatch.setattr(model, "MAX_INPUT", 4500)
    content = "".join(f"+中文行{i}\n" for i in range(300))
    item = {"new_path": "large.py", "diff": "@@ -0,0 +1,300 @@\n" + content} if action == "diff" else {"path": "large.py", "content": content}
    offset, chunks = 1, []
    while offset is not None:
        page = model._context_page({"action": action, "offset": offset, "limit": 30}, item)
        assert len(json.dumps(page, ensure_ascii=False).encode()) <= model.MAX_INPUT // 4
        if action == "diff":
            diff = page["diffs"][0]["diff"]
            assert model._valid_hunks(diff)
            chunks.extend(line + "\n" for line in diff.splitlines() if not line.startswith("@@"))
        else:
            chunks.append(page["content"])
        assert page["next_offset"] is None or page["next_offset"] > offset
        offset = page["next_offset"]
    assert "".join(chunks) == content


@pytest.mark.parametrize("continue_reading", [False, True])
@pytest.mark.parametrize("action", ["read", "diff"])
def test_unconsumed_context_pages_are_disclosed_until_read(monkeypatch, continue_reading, action):
    run, scope = sample([{"new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}])
    content = "".join(f"line {number:04d} = " + "x" * 20 + "\n" for number in range(1000))
    scope.all_diffs = [*scope.diffs, {"new_path": "dependency.py", "diff": "@@ -0,0 +1,1000 @@\n" + "".join("+" + line for line in content.splitlines(keepends=True))}]
    provider = SimpleNamespace(get_file_raw=lambda *args, **kwargs: content)
    monkeypatch.setattr(model.ReleaseService, "_get_provider", lambda *args, **kwargs: provider)
    release = SimpleNamespace(repository=SimpleNamespace(external_identity="repo"), project=object())

    def ask(_, messages):
        if len(messages) == 1:
            return {"action": action, "path": "dependency.py"}, "{}"
        page = json.loads(messages[-1]["content"])
        if continue_reading and page.get("next_offset"):
            return {"action": action, "path": "dependency.py", "offset": page["next_offset"]}, "{}"
        return finish(["a.py"])

    monkeypatch.setattr(model, "_ask", ask)
    report = model._review_batch(run, scope, release=release)
    assert report["status"] == ("completed" if continue_reading else "incomplete")
    unread = report["coverage"].get("unread_context", [])
    assert unread == ([] if continue_reading else [{"path": "dependency.py", "kind": action, "start": 201, "end": 1000}])


@pytest.mark.parametrize("kind", ["diff", "read", "fragment"])
def test_initial_payload_evidence_is_not_reported_as_unread(monkeypatch, kind):
    run, scope = sample([{"new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}])
    scope.documents = {"a.py": "b\nsecond line\n"} if kind == "read" else {}
    if kind == "fragment":
        scope.all_diffs = scope.diffs
        scope.diffs = [model.fragment(scope.diffs[0], model.diff_lines(scope.diffs[0]["diff"]), 1, 2)]
    calls = []
    provider = SimpleNamespace(get_file_raw=lambda *args, **kwargs: scope.documents["a.py"])
    monkeypatch.setattr(model.ReleaseService, "_get_provider", lambda *args, **kwargs: provider)
    release = SimpleNamespace(repository=SimpleNamespace(external_identity="repo"), project=object())

    def ask(_, messages):
        calls.append(True)
        return ({"action": "read" if kind == "read" else "diff", "path": "a.py", "offset": 1, "limit": 1}, "{}") if len(calls) == 1 else finish(["a.py"])

    monkeypatch.setattr(model, "_ask", ask)
    report = model._review_batch(run, scope, release=release)
    assert report["status"] == "completed"
    assert report["coverage"]["unread_context"] == []


def test_old_and_new_paths_share_context_coverage_for_renamed_file(monkeypatch):
    run, scope = sample([{"new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}])
    scope.all_diffs = [*scope.diffs, {"old_path": "old.py", "new_path": "new.py", "diff": "@@ -1 +1 @@\n-old\n+new"}]
    actions = iter([{"action": "diff", "path": "old.py", "offset": 1, "limit": 1},
                    {"action": "diff", "path": "new.py", "offset": 2, "limit": 1}, finish(["a.py"])[0]])
    monkeypatch.setattr(model, "_ask", lambda *args: (next(actions), "{}"))
    report = model._review_batch(run, scope, release=object())
    assert report["status"] == "completed" and not report["coverage"]["unread_context"]
