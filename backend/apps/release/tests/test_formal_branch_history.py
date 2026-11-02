"""用真实 Git 分叉历史核验维护分支正式说明的区间。"""

import subprocess
from types import SimpleNamespace

import pytest
from rest_framework.test import APIClient

from apps.release.models import ReleaseRecord
from apps.workflow.models import WorkflowDefinition
from utils.provider.gitlab import GitLabProvider

pytestmark = pytest.mark.django_db


@pytest.fixture
def branch_history(tmp_path, monkeypatch):
    """只替换 GitLab HTTP 传输，Tag、祖先链和提交区间由真实 Git 计算。"""
    source = tmp_path / "repository"
    source.mkdir()

    def git(*args):
        return subprocess.check_output([
            "git", "-C", str(source), "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", *args,
        ], text=True, stderr=subprocess.DEVNULL).strip()

    git("init", "-b", "master")
    git("config", "user.name", "分支回归测试")
    git("config", "user.email", "test@example.invalid")

    def commit(message):
        git("commit", "--allow-empty", "-m", message)
        return git("rev-parse", "HEAD")

    common = commit("A 公共历史")
    git("branch", "a")
    for index in range(10):
        commit(f"A 主线功能{index}")
        git("tag", f"5.8.{index}" if index < 9 else "5.9.4")
    master = git("rev-parse", "HEAD")
    git("checkout", "a")
    base = commit("A 维护分支上一版")
    git("tag", "5.2.39")
    head = commit("F 维护分支本次修复")
    assert git("merge-base", base, head) == base
    assert git("merge-base", master, head) != master

    def commit_data(ref):
        sha, message, date = git("show", "-s", "--format=%H%x00%B%x00%cI", ref).split("\0")
        return {"id": sha, "message": message.strip(), "committed_date": date}

    def request(method, path, **kwargs):
        assert method == "GET", "生成说明不得修改远端仓库"
        params = kwargs.get("params", {})
        if path.endswith("/repository/tags"):
            payload = [{"name": name, "commit": commit_data(name)} for name in git("tag").splitlines()]
        elif "/repository/branches/" in path:
            branch = path.rsplit("/", 1)[-1]
            payload = {"name": branch, "commit": commit_data(branch)}
        elif path.endswith("/repository/merge_base"):
            refs = [value for key, value in params if key == "refs[]"]
            payload = {"id": git("merge-base", *refs)}
        elif path.endswith("/repository/commits"):
            payload = [commit_data(sha) for sha in git("rev-list", params["ref_name"]).splitlines()]
        elif path.endswith("/merge_requests"):
            payload = []
        else:
            raise AssertionError(f"意外的 GitLab 请求：{path}")
        return SimpleNamespace(json=lambda: payload, headers={"X-Next-Page": ""})

    provider = GitLabProvider("https://gitlab.example.invalid", {"token": "test-only"})
    monkeypatch.setattr(provider, "_request", request)
    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: provider)
    return {"base": base, "head": head, "master": master, "common": common, "provider": provider, "git": git}


@pytest.fixture
def api(project, repository, user):
    repository.version_rule = {"prefix": "", "major": 5, "minor": 2, "patch": 0, "with_date": False}
    repository.save(update_fields=["version_rule"])
    client = APIClient()
    client.force_authenticate(user)
    WorkflowDefinition.objects.create(
        repository=repository, project=project, name="正式审批", release_type="formal",
        node_config=[{"node_id": "check", "node_name": "确认", "mode": "any",
                      "approvers": [{"type": "user", "user_id": str(user.id)}]}],
    )
    return client


@pytest.mark.parametrize("with_history", [False, True])
@pytest.mark.parametrize("version_input", ["tag_only", "stale_input", "legacy_draft", "legacy_initialized"])
def test_generate_5240_on_a_uses_5239_when_master_is_ten_releases_ahead(
    api, project, repository, user, branch_history, with_history, version_input,
):
    if with_history:
        for version, branch, sha in [
            ("5.2.39", "a", branch_history["base"]), ("5.9.4", "master", branch_history["master"]),
        ]:
            ReleaseRecord.objects.create(
                project=project, repository=repository, publisher=user, release_type="formal", status="released",
                version=version, tag_name=version, branch=branch, git_hash=sha,
            )
    payload = {
        "project": str(project.id), "repository": str(repository.id), "branch": "a",
        "release_type": "formal", "tag_name": "5.2.40", "package_config_ids": [],
    }
    if version_input == "stale_input":
        # 兼容同时发送自动计算版本和手工 Tag 的客户端，最终发布身份应取 Tag。
        payload["version"] = "5.9.5"
    created = api.post("/api/releases/", payload, format="json")
    assert created.status_code == 201, created.data
    identity = created.data["data"]["id"]
    if version_input.startswith("legacy"):
        # 复现旧版接受两个不同身份字段后遗留的草稿。
        ReleaseRecord.objects.filter(pk=identity).update(version="5.9.5")
    if version_input == "legacy_initialized":
        ReleaseRecord.objects.filter(pk=identity).update(
            base_tag="5.9.4", base_git_hash=branch_history["master"], changes_initialized=True,
            release_doc="旧版说明", updates=[{"type": "A", "content": "旧版内容"}],
            related_changes=[{"key": "旧版引用", "value": "5.9.4"}],
        )
    preview = api.get(f"/api/releases/{identity}/changes-preview/")
    assert preview.status_code == 200, preview.data
    assert preview.data["data"]["base_tag"] == "5.2.39"
    if version_input.startswith("legacy"):
        assert ReleaseRecord.objects.get(pk=identity).version == "5.9.5", "预览不得修改草稿"
    generated = api.post(f"/api/releases/{identity}/generate-doc/")
    assert generated.status_code == 200, generated.data
    release = ReleaseRecord.objects.get(pk=identity)
    assert release.version == "5.2.40" and release.tag_name == "5.2.40"
    assert (release.base_tag, release.base_git_hash) == ("5.2.39", branch_history["base"])
    assert release.git_hash == branch_history["head"]
    assert "维护分支本次修复" in generated.data["data"]
    assert "主线功能" not in generated.data["data"]
    assert "旧版内容" not in generated.data["data"] and not release.related_changes
    assert list(release.release_commits.values_list("commit__commit_hash", flat=True)) == [branch_history["head"]]
    submitted = api.post(f"/api/releases/{identity}/submit-audit/")
    assert submitted.status_code == 200, submitted.data


@pytest.mark.parametrize("mode", ["nearest", "multiple", "none", "same", "snapshot", "initialized"])
def test_diverged_formal_tags_fall_back_to_reachable_history(api, project, repository, user, branch_history, mode):
    git = branch_history["git"]
    git("tag", "-f", "5.2.39", branch_history["master"])
    expected_tag = "5.2.37" if mode == "multiple" else "5.2.38"
    expected_base = branch_history["head"] if mode == "same" else branch_history["base"]
    if mode != "none":
        git("tag", expected_tag, expected_base)
    else:
        expected_tag = expected_base = ""
    if mode == "multiple":
        git("tag", "5.2.38", branch_history["master"])
    if mode == "snapshot":
        # 远端同名 Tag 被改写后，平台历史快照仍优先参与祖先筛选。
        ReleaseRecord.objects.create(
            project=project, repository=repository, publisher=user, release_type="formal", status="released",
            version="5.2.39", tag_name="5.2.39", branch="master", git_hash=branch_history["master"],
        )
        git("tag", "-f", "5.2.39", branch_history["base"])
    created = api.post("/api/releases/", {
        "project": str(project.id), "repository": str(repository.id), "branch": "a",
        "release_type": "formal", "tag_name": "5.2.40", "package_config_ids": [],
    }, format="json")
    assert created.status_code == 201, created.data
    identity = created.data["data"]["id"]
    if mode == "initialized":
        ReleaseRecord.objects.filter(pk=identity).update(
            base_tag="5.2.39", base_git_hash=branch_history["master"], changes_initialized=True,
            release_doc="原来固定到了其他分支的说明",
        )
    preview = api.get(f"/api/releases/{identity}/changes-preview/")
    assert preview.status_code == 200, preview.data
    assert preview.data["data"]["base_tag"] == expected_tag
    if mode == "initialized":
        assert ReleaseRecord.objects.get(pk=identity).base_tag == "5.2.39", "预览不得修改已保存草稿"
    generated = api.post(f"/api/releases/{identity}/generate-doc/")
    assert generated.status_code == 200, generated.data
    release = ReleaseRecord.objects.get(pk=identity)
    assert (release.base_tag, release.base_git_hash) == (expected_tag, expected_base)
    assert release.git_hash == branch_history["head"]
    assert "5.2.39" in generated.data["data"] and "基线回退" in generated.data["data"]
    assert "主线功能" not in generated.data["data"]
    if mode == "none":
        assert "全部可达历史" in generated.data["data"] and "公共历史" in generated.data["data"]
    else:
        assert expected_tag in generated.data["data"]
        assert "公共历史" not in generated.data["data"]
    assert list(release.release_commits.filter(is_included=True).values_list("commit__commit_hash", flat=True)) == (
        [] if mode == "same" else
        [branch_history["head"], branch_history["base"], branch_history["common"]] if mode == "none" else
        [branch_history["head"]]
    )
    # 新增更近的可达 Tag 不改变已生成的固定区间，也不丢失原回退提示。
    git("tag", "-f", "5.2.39", branch_history["head"])
    regenerated = api.post(f"/api/releases/{identity}/generate-doc/")
    assert regenerated.status_code == 200, regenerated.data
    release.refresh_from_db()
    assert (release.base_tag, release.base_git_hash) == (expected_tag, expected_base)
    assert "基线回退" in regenerated.data["data"]
    submitted = api.post(f"/api/releases/{identity}/submit-audit/")
    assert submitted.status_code == 200, submitted.data


def test_failed_legacy_regeneration_rolls_back_identity_and_old_associations(
    api, project, repository, user, commit, branch_history, monkeypatch,
):
    from apps.release.models import ReleaseCommit
    from utils.provider.exceptions import ConnectionError

    release = ReleaseRecord.objects.create(
        project=project, repository=repository, publisher=user, release_type="formal", status="draft",
        version="5.9.5", tag_name="5.2.40", branch="a", git_hash=branch_history["head"],
        changes_initialized=True, base_tag="5.9.4", base_git_hash=branch_history["master"],
        release_doc="待重新生成的旧说明",
    )
    association = ReleaseCommit.objects.create(release=release, commit=commit)

    def fail(identity):
        raise ConnectionError("远端暂不可用")

    monkeypatch.setattr(branch_history["provider"], "list_tags", fail)
    generated = api.post(f"/api/releases/{release.id}/generate-doc/")
    assert generated.status_code == 502, generated.data
    release.refresh_from_db()
    assert release.version == "5.9.5" and release.base_tag == "5.9.4"
    assert release.changes_initialized and release.release_doc == "待重新生成的旧说明"
    assert release.release_commits.filter(pk=association.pk).exists()
