"""从实际规划、模型工具与恢复入口验证过滤和整轮容量保护。"""
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from apps.release.tests.test_ai_review_partial import sample
from apps.workflow import ai_review_model as model


def change(path, **kwargs):
    return {"old_path": path, "new_path": path, "diff": "@@ -1 +1 @@\n-a\n+b", **kwargs}


@pytest.mark.parametrize("path", [
    "vendor/acme/lib.py", "web/node_modules/pkg/index.js", "third_party/lib/a.cpp", "3rdparty/lib/a.h",
    "config/app.yaml", "appsettings.Production.json", "src/settings/prod.py", "vite.config.ts",
    ".env.production", "package.json", "pyproject.toml", "pom.xml", "web/package-lock.json",
    "yarn.lock", "Cargo.lock", "go.sum", "web/dist/bundle.js", "assets/app.min.js", "app.js.map",
    "api/schema.pb.go", "assets/logo.png",
])
def test_non_business_files_never_enter_model_batches(path):
    run, scope = sample([change(path), change("src/service.py")])
    names, plan, omitted = model._batch_plan(run, scope)
    assert names == [path, "src/service.py"]
    assert [p for entry in plan for p in entry["paths"]] == ["src/service.py"]
    assert omitted[0]["path"] == path and omitted[0]["category"] == "excluded"
    assert model._restore_plan(scope, model._save_plan(scope, names, plan, omitted)) == (names, plan, omitted)


def test_business_code_deletions_and_renames_out_of_vendor_are_reviewed():
    diffs = [change("lib/service.py"), change("common/configuration.py"), change("external/business.py"), change("src/data.json"),
             change("src/old.py", deleted_file=True, diff="@@ -1 +0,0 @@\n-a"),
             change("src/new.py", old_path="vendor/old.py", renamed_file=True)]
    run, scope = sample(diffs)
    _, plan, omitted = model._batch_plan(run, scope)
    assert not omitted
    assert [item for entry in plan for item in entry["diffs"]] == diffs


def test_skips_do_not_flush_small_business_batches_or_count_as_reviewed():
    run, scope = sample([change("a.py"), change("vendor/pkg/lib.py"), change("b.py")])
    names, plan, omitted = model._batch_plan(run, scope)
    assert len(plan) == 1
    report = model._batch_outcome(scope, names, plan, omitted, {
        plan[0]["id"]: {"status": "completed", "dimensions": ["安全"], "findings": []},
    })
    assert report["status"] == "completed"
    assert report["coverage"]["total_files"] == 3
    assert report["coverage"]["reviewed_files"] == report["coverage"]["eligible_files"] == 2
    assert report["coverage"]["excluded_files"] == 1
    assert report["coverage"]["unreviewed_paths"] == []


@pytest.mark.parametrize("known, expected", [(True, "filtered"), (False, "incomplete")])
def test_all_skipped_does_not_call_model_or_claim_review(known, expected, monkeypatch):
    run, scope = sample([change("vendor/a.py")], status="ready" if known else "incomplete")
    ask = Mock(side_effect=AssertionError("不应请求模型"))
    monkeypatch.setattr(model, "_ask", ask)
    report = model.review_scope(run, scope)
    assert report["status"] == expected
    assert report["coverage"]["reviewed_files"] == 0
    assert report["coverage"]["excluded_files"] == 1
    ask.assert_not_called()


def test_capacity_overflow_stays_uncovered_and_plan_can_resume(monkeypatch):
    monkeypatch.setattr(model, "MAX_REVIEW_BATCHES", 2, raising=False)
    monkeypatch.setattr(model, "MAX_BATCH_FILES", 1, raising=False)
    run, scope = sample([change(f"src/{i}.py") for i in range(5)])
    names, plan, omitted = model._batch_plan(run, scope)
    assert len(plan) == 2
    assert {item["path"] for item in omitted} == {f"src/{i}.py" for i in range(2, 5)}
    assert all(item.get("category") != "excluded" for item in omitted)
    assert model._restore_plan(scope, model._save_plan(scope, names, plan, omitted)) == (names, plan, omitted)


def test_large_diff_is_rejected_before_validation_and_fragmentation(monkeypatch):
    monkeypatch.setattr(model, "MAX_FILE_DIFF_BYTES", 100, raising=False)
    validate = Mock(side_effect=AssertionError("超限文件不应解析全文"))
    monkeypatch.setattr(model, "_valid_hunks", validate)
    run, scope = sample([change("large.py", diff="@@ -0,0 +1,1 @@\n+" + "中" * 100)])
    _, plan, omitted = model._batch_plan(run, scope)
    assert not plan and "容量" in omitted[0]["reason"]
    validate.assert_not_called()


def test_fragment_overflow_keeps_remaining_coordinates_and_restores(monkeypatch):
    monkeypatch.setattr(model, "MAX_INPUT", 4500)
    monkeypatch.setattr(model, "MAX_REVIEW_BATCHES", 2)
    run, scope = sample([change("large.py", diff="@@ -0,0 +1,300 @@\n" + ("+" + "x" * 100 + "\n") * 300)])
    names, plan, omitted = model._batch_plan(run, scope)
    assert len(plan) == 2 and omitted and all("fragment" in item for item in omitted)
    assert model._restore_plan(scope, model._save_plan(scope, names, plan, omitted)) == (names, plan, omitted)
    assert max(item["new_end"] for item in omitted) == 300


@pytest.mark.parametrize("limit,value", [("MAX_REVIEW_FILES", 2), ("MAX_REVIEW_DIFF_BYTES", 46)])
def test_total_file_and_byte_capacity_preserves_uncovered_paths(monkeypatch, limit, value):
    monkeypatch.setattr(model, limit, value)
    run, scope = sample([change(f"{i}.py") for i in range(5)])
    names, plan, omitted = model._batch_plan(run, scope)
    assert sum(len(entry["paths"]) for entry in plan) == 2
    assert len(omitted) == 3
    assert model._restore_plan(scope, model._save_plan(scope, names, plan, omitted)) == (names, plan, omitted)


def test_binary_and_pure_rename_are_distinct_from_incomplete_text():
    run, scope = sample([change("image.unknown", binary=True, diff=""),
                         change("b.py", old_path="a.py", renamed_file=True, diff="", diff_missing=False),
                         change("c.py", old_path="d.py", renamed_file=True, collapsed=True, diff="")])
    _, plan, omitted = model._batch_plan(run, scope)
    assert not plan
    assert [item.get("category") for item in omitted] == ["excluded", "excluded", None]


@pytest.mark.parametrize("old,new", [("vendor/a.py", "src/a.py"), ("src/a.py", "vendor/a.py")])
def test_pure_rename_crossing_filter_boundary_stays_uncovered(old, new):
    run, scope = sample([change(new, old_path=old, renamed_file=True, diff="", diff_missing=False)])
    names, plan, omitted = model._batch_plan(run, scope)
    assert not plan and omitted[0].get("category") != "excluded"
    assert model._batch_outcome(scope, names, plan, omitted, {})["status"] == "incomplete"


def test_legacy_empty_rename_without_body_evidence_stays_uncovered():
    run, scope = sample([change("b.py", old_path="a.py", renamed_file=True, diff="")], status="incomplete")
    names, plan, omitted = model._batch_plan(run, scope)
    report = model._batch_outcome(scope, names, plan, omitted, {})
    assert report["coverage"]["unreviewed_paths"] == ["b.py"]
    assert report["coverage"]["excluded_files"] == 0


def test_cross_boundary_document_uses_same_budget_during_plan_and_execution(monkeypatch):
    run, scope = sample([change("vendor/a.py", old_path="src/a.py", renamed_file=True,
                               diff="@@ -0,0 +1,150 @@\n" + ("+" + "x" * 100 + "\n") * 150)])
    scope.documents = {"vendor/a.py": "x" * 90_000}
    _, plan, omitted = model._batch_plan(run, scope)
    assert not omitted and len(plan) > 1
    monkeypatch.setattr(model, "_ask", lambda *_: (
        {"action": "finish", "dimensions": ["安全"], "reviewed_files": ["vendor/a.py"], "findings": []}, "{}"))
    for batch in plan:
        batch_scope = SimpleNamespace(**{**vars(scope), "diffs": batch["diffs"], "all_diffs": scope.diffs,
                                        "policy_version": 1, "allowed_paths": {"src/a.py", "vendor/a.py"}})
        assert model._review_batch(run, batch_scope, release=object())["status"] == "completed"


@pytest.mark.django_db(transaction=True)
def test_total_deadline_stops_new_batches_and_keeps_completed_result(monkeypatch):
    from threading import Event

    monkeypatch.setattr(model, "MAX_BATCH_FILES", 1)
    now = [0]
    monkeypatch.setattr(model.time, "monotonic", lambda: now[0])
    monkeypatch.setattr("apps.workflow.services.resolve_release", lambda _: SimpleNamespace(repository=object()))
    run, scope = sample([change(f"src/{i}.py") for i in range(6)])
    gate = Event()
    calls = []

    def review(_run, batch, **_kwargs):
        calls.append(batch.diffs)
        if len(calls) == 1:
            gate.wait(2)
        else:
            now[0] = model.MAX_REVIEW_SECONDS
            gate.set()
        return {"status": "completed", "dimensions": ["安全"], "findings": [], "coverage": {}}

    monkeypatch.setattr(model, "_review_batch", review)
    report = model.review_scope(run, scope)
    assert len(calls) == 2
    assert report["status"] == "partial" and report["coverage"]["reviewed_files"] == 2
    assert any("时间预算" in item for item in report["coverage"]["warnings"])


def test_version_two_plan_keeps_its_original_config_review(monkeypatch):
    run, scope = sample([change("src/settings/prod.py")])
    import hashlib
    digest = hashlib.sha256(json.dumps(scope.diffs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    manifest = {"version": 2, "digest": model._scope_digest(scope),
                "batches": [{"id": digest, "items": [{"index": 0}]}], "blocked": []}
    names, plan, omitted = model._restore_plan(scope, manifest)
    assert names == ["src/settings/prod.py"] and not omitted
    assert plan[0]["diffs"] == scope.diffs


@pytest.mark.parametrize("acquired", [False, True])
def test_process_slot_wait_obeys_execution_deadline(monkeypatch, acquired):
    from threading import Event

    slots = Mock()
    slots.acquire.return_value = acquired
    monkeypatch.setattr(model, "_BATCH_SLOTS", slots)
    monkeypatch.setattr(model.time, "monotonic", lambda: 10)
    callback = Mock()
    with pytest.raises(ValueError, match="审查批次超时"):
        model._limited_batch(callback, Event(), deadline=5)
    callback.assert_not_called()
    assert slots.release.call_count == int(acquired)


def test_finish_returned_after_deadline_is_preserved_without_new_request(monkeypatch):
    run, scope = sample([change("a.py")])
    now = [0]
    scope.execution_deadline = 10
    monkeypatch.setattr(model.time, "monotonic", lambda: now[0])

    def ask(*_):
        now[0] = 11
        return {"action": "finish", "dimensions": ["安全"], "reviewed_files": ["a.py"], "findings": []}, "{}"

    request = Mock(side_effect=ask)
    monkeypatch.setattr(model, "_ask", request)
    assert model._review_batch(run, scope, release=object())["status"] == "completed"
    assert request.call_count == 1


@pytest.mark.django_db(transaction=True)
def test_repeated_failures_stop_dispatch_and_retry_preserves_plan(monkeypatch):
    monkeypatch.setattr(model, "MAX_BATCH_FILES", 1, raising=False)
    monkeypatch.setattr("apps.workflow.services.resolve_release", lambda _: SimpleNamespace(repository=object()))
    run, scope = sample([change(f"src/{i}.py") for i in range(10)])
    calls = Mock(side_effect=ValueError("服务不可用"))
    monkeypatch.setattr(model, "_review_batch", calls)
    saved = {}
    report = model.review_scope(run, scope, checkpoint=lambda results, _: saved.update(results) or True)
    assert report["status"] == "failed"
    assert 3 <= calls.call_count <= 4
    assert any("连续" in warning for warning in report["coverage"]["warnings"])
    assert len(report["coverage"]["unreviewed_paths"]) == 10
    run.batch_results = saved
    monkeypatch.setattr(model, "_review_batch", lambda *_args, **_kwargs: {
        "status": "completed", "dimensions": ["安全"], "findings": [], "coverage": {},
    })
    assert model.review_scope(run, scope)["status"] == "completed"


@pytest.mark.parametrize("action", ["read", "search", "diff"])
def test_model_cannot_read_skipped_paths_through_tools(monkeypatch, action):
    run, scope = sample([change("a.py")])
    scope.policy_version = 1
    provider = Mock(side_effect=AssertionError("不应读取配置或依赖源码"))
    monkeypatch.setattr(model.ReleaseService, "_get_provider", provider)
    responses = iter([
        {"action": action, "path": "vendor/private.py", "query": "password"},
        {"action": "finish", "reviewed_files": ["a.py"], "dimensions": ["安全"], "findings": []},
    ])
    messages_seen = []
    def ask(_, messages):
        messages_seen.append(list(messages))
        payload = next(responses)
        return payload, json.dumps(payload)
    monkeypatch.setattr(model, "_ask", ask)
    report = model._review_batch(run, scope, release=object())
    assert report["status"] == "incomplete" and report["report_valid"]
    assert "策略" in messages_seen[1][-1]["content"]
    from apps.workflow.ai_review_presentation import present_coverage

    display = present_coverage(report["coverage"], policy_version=1)
    assert "vendor/private.py" not in str(display)
    assert "1 个补充上下文按策略跳过，未纳入本轮审查" in display["warnings"]
    provider.assert_not_called()
