"""大目录及长差异的有界工作量，使用固定输入避免计时抖动。"""
import json
from types import SimpleNamespace
from unittest.mock import Mock

from apps.workflow import ai_review_model as model
from apps.workflow.ai_review_fragments import split_diff


def sample(diffs):
    run = SimpleNamespace(settings_version=SimpleNamespace(skill_documents=[]),
                          instance=SimpleNamespace(created_by=None))
    scope = SimpleNamespace(diffs=diffs, base_git_hash="a" * 40, head_git_hash="b" * 40,
                            context="", documents={}, context_is_requirement=False)
    return run, scope


def test_large_directory_plan_reads_manifest_once(monkeypatch):
    diffs = [{"new_path": f"src/file-{i}.py", "diff": "@@ -1 +1 @@\n-a\n+b"} for i in range(2000)]
    run, scope = sample(diffs)
    page = Mock(wraps=model._file_page)
    monkeypatch.setattr(model, "_file_page", page)
    names, plan, blocked = model._batch_plan(run, scope)
    assert names == [item["new_path"] for item in diffs] and not blocked
    assert [item for entry in plan for item in entry["diffs"]] == diffs
    assert page.call_count == 1


def test_long_diff_split_work_is_bounded_by_input_size():
    diff = "@@ -0,0 +1,4000 @@\n" + "+" + "x" * 80 + "\n" + ("+" + "x" * 80 + "\n") * 3999
    measured = 0

    def fits(part):
        nonlocal measured
        measured += len(part["diff"])
        return len(part["diff"]) <= 1000

    accepted, blocked = split_diff({"new_path": "large.py", "diff": diff}, fits)
    assert not blocked and len(accepted) > 100
    assert "".join(line + "\n" for part in accepted for line in part["diff"].splitlines() if not line.startswith("@@")) == "\n".join(diff.splitlines()[1:]) + "\n"
    assert measured < len(diff) * 60


def test_paged_source_and_search_reuse_fixed_file(monkeypatch):
    run, scope = sample([{"new_path": "a.py", "diff": "@@ -1 +1 @@\n-a\n+b"}])
    read = Mock(return_value="first\nlast\n")
    monkeypatch.setattr(model.ReleaseService, "_get_provider", lambda *args, **kwargs: SimpleNamespace(get_file_raw=read))
    actions = [
        {"action": "read", "path": "dependency.py", "limit": 1},
        {"action": "read", "path": "dependency.py", "offset": 2, "limit": 1},
        {"action": "search", "path": "dependency.py", "query": "last"},
        {"action": "finish", "reviewed_files": ["a.py"], "dimensions": ["安全"], "findings": []},
    ]
    responses = iter(actions)
    monkeypatch.setattr(model, "_ask", lambda *_: ((payload := next(responses)), json.dumps(payload)))
    release = SimpleNamespace(repository=SimpleNamespace(external_identity="repo"), project=object())
    result = model._review_batch(run, scope, release=release)
    assert result["status"] == "completed"
    assert read.call_count == 1
    assert read.call_args.kwargs == {"ref": "b" * 40}
    scope.head_git_hash = "c" * 40
    responses = iter(actions)
    assert model._review_batch(run, scope, release=release)["status"] == "completed"
    assert read.call_count == 2
    assert read.call_args.kwargs == {"ref": "c" * 40}
