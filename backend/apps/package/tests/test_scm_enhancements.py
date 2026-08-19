"""打包增强测试：Git submodule 拉取、凭证注入脚本内 push、SVN 覆盖式提交。"""
import os
import stat
from unittest.mock import MagicMock, patch

import pytest

from apps.account.models import User
from apps.credential.models import Credential
from apps.package.models import PackageTask
from apps.package.services import PackageService
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository
from utils.provider.svn import SVNProvider

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def user():
    return User.objects.create_user(
        username="enhance_user",
        password="pass",
        nickname="增强用户",
    )


@pytest.fixture
def project(user):
    project = Project.objects.create(
        name="增强项目",
        code="ENH",
        leader=user,
        status=1,
    )
    ProjectMember.objects.create(project=project, user=user, role="software_admin")
    return project


@pytest.fixture
def repository(project):
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="web",
        url="https://gitlab.example.com",
        external_identity="group/web",
        default_branch="main",
    )


@pytest.fixture
def release(project, repository, user):
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="V1.0.0",
        tag_name="V1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        release_doc="# 发布说明",
        publisher=user,
    )


@pytest.fixture
def svn_credential(user):
    cred = Credential.objects.create(
        name="SVN 凭证",
        cred_type="svn_password",
        auth_mode="password",
        owner=user,
        is_active=True,
    )
    cred.set_data({"username": "svnuser", "password": "svnpass"})
    cred.save()
    return cred


def _make_task(project, repository, release, user, snapshot):
    return PackageTask.objects.create(
        release=release,
        project=project,
        repository=repository,
        triggered_by=user,
        name="打包任务",
        build_type="web",
        tag_name=release.tag_name,
        version=release.version,
        config_snapshot=snapshot,
        artifact_info=[],
    )


def _status_xml(entries):
    """构造 svn status --xml 输出，entries 为 (item_status, path) 列表。"""
    body = "".join(
        f'<entry path="{path}"><wc-status item="{item}"></wc-status></entry>'
        for item, path in entries
    )
    return f'<status><target path=".">{body}</target></status>'


# ---------------------------------------------------------------------------
# SVNProvider.sync_directory
# ---------------------------------------------------------------------------

class TestSVNProviderSyncDirectory:
    """SVNProvider.sync_directory 覆盖式同步测试。"""

    def test_sync_add_rm_commit(self, tmp_path):
        """新增文件 add、缺失文件 rm、存在变更时 commit。"""
        local_dir = tmp_path / "local"
        local_dir.mkdir()
        (local_dir / "new.txt").write_text("new", encoding="utf-8")

        provider = SVNProvider("svn://host/repo", {"username": "u", "password": "p"})
        calls: list[list[str]] = []
        statuses = iter([
            _status_xml([
                ("unversioned", "new.txt"),
                ("missing", "old.txt"),
            ]),
            _status_xml([("added", "new.txt"), ("deleted", "old.txt")]),
        ])

        def fake_run(cmd, timeout=60):
            calls.append(cmd)
            if "status" in cmd:
                return next(statuses)
            return ""

        with patch.object(SVNProvider, "_run", side_effect=fake_run):
            provider.sync_directory("svn://host/repo/V1.0.0", str(local_dir), "msg")

        # _base_cmd: [svn, --non-interactive, --no-auth-cache, --username, u, --password, p]，动作在其后第 5 位
        verbs = [cmd[cmd.index("--no-auth-cache") + 5] for cmd in calls]
        assert "checkout" in verbs
        assert "add" in verbs
        assert "rm" in verbs
        assert "commit" in verbs
        # add 使用 --force 递归加入未版本化文件
        add_cmd = next(cmd for cmd in calls if "add" in cmd)
        assert "--force" in add_cmd
        # rm 目标为缺失文件
        rm_cmd = next(cmd for cmd in calls if "rm" in cmd)
        assert "old.txt" in rm_cmd and "--force" in rm_cmd

    def test_sync_skips_commit_when_no_changes(self, tmp_path):
        """无任何变更时跳过 commit。"""
        local_dir = tmp_path / "local"
        local_dir.mkdir()

        provider = SVNProvider("svn://host/repo", {"username": "u", "password": "p"})
        calls: list[list[str]] = []

        def fake_run(cmd, timeout=60):
            calls.append(cmd)
            if "status" in cmd:
                return _status_xml([])
            return ""

        with patch.object(SVNProvider, "_run", side_effect=fake_run):
            provider.sync_directory("svn://host/repo/V1.0.0", str(local_dir), "msg")

        verbs = [cmd[cmd.index("--no-auth-cache") + 5] for cmd in calls]
        assert "commit" not in verbs
        assert "add" not in verbs
        assert "rm" not in verbs

    def test_sync_skips_missing_children_under_removed_parent(self, tmp_path):
        """父目录已删时其子路径不再重复 svn rm。"""
        local_dir = tmp_path / "local"
        local_dir.mkdir()
        (local_dir / "keep.txt").write_text("keep", encoding="utf-8")

        provider = SVNProvider("svn://host/repo", {"username": "u", "password": "p"})
        rm_targets: list[str] = []
        missing_parent = os.path.join("sub")
        missing_child = os.path.join("sub", "a.txt")
        statuses = iter([
            _status_xml([
                ("missing", missing_child),
                ("missing", missing_parent),
                ("modified", "keep.txt"),
            ]),
            _status_xml([("modified", "keep.txt")]),
        ])

        def fake_run(cmd, timeout=60):
            if "status" in cmd:
                return next(statuses)
            if "rm" in cmd:
                rm_targets.append(cmd[-1])
            return ""

        with patch.object(SVNProvider, "_run", side_effect=fake_run):
            provider.sync_directory("svn://host/repo/V1.0.0", str(local_dir), "msg")

        assert rm_targets == [missing_parent]

    def test_sync_copies_local_files_into_workcopy(self, tmp_path):
        """本地文件被覆盖拷贝进检出的工作副本。"""
        local_dir = tmp_path / "local"
        (local_dir / "sub").mkdir(parents=True)
        (local_dir / "sub" / "app.bin").write_bytes(b"bin")

        provider = SVNProvider("svn://host/repo", {"username": "u", "password": "p"})

        def fake_run(cmd, timeout=60):
            if "status" in cmd:
                # status 时拷贝已完成：工作副本中应存在本地文件
                assert os.path.exists(os.path.join(cmd[-1], "sub", "app.bin"))
                return _status_xml([("unversioned", "sub/app.bin")])
            return ""

        with patch.object(SVNProvider, "_run", side_effect=fake_run):
            provider.sync_directory("svn://host/repo/V1.0.0", str(local_dir), "msg")


# ---------------------------------------------------------------------------
# _push_artifacts_to_svn 覆盖式提交模式
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestPushArtifactsOverwriteMode:
    """SVN 覆盖式提交模式测试。"""

    def _workspace(self, tmp_path):
        workspace = tmp_path / "workspace"
        (workspace / "artifacts").mkdir(parents=True)
        (workspace / "artifacts" / "app.tar.gz").write_bytes(b"fake artifact")
        return workspace

    def _snapshot(self, svn_credential, mode):
        return {
            "svn_push_enabled": True,
            "svn_url": "svn://host/releases",
            "svn_credential_id": str(svn_credential.id),
            "svn_path_template": "{version}",
            "svn_commit_mode": mode,
        }

    def test_overwrite_existing_dir_uses_sync_directory(
        self, project, repository, release, user, svn_credential, tmp_path
    ):
        """overwrite 模式下目录已存在时走 sync_directory 镜像覆盖。"""
        task = _make_task(project, repository, release, user, self._snapshot(svn_credential, "overwrite"))
        workspace = self._workspace(tmp_path)

        mock_provider = MagicMock()
        mock_provider.remote_exists.return_value = True

        with patch("apps.package.services.get_provider", return_value=mock_provider):
            result = PackageService._push_artifacts_to_svn(task, workspace)

        mock_provider.sync_directory.assert_called_once()
        mock_provider.import_path.assert_not_called()
        args = mock_provider.sync_directory.call_args.args
        assert args[0] == "svn://host/releases/V1.0.0"
        assert args[1] == str(workspace / "tmp" / "svn_upload")
        assert result["remote_url"] == "svn://host/releases/V1.0.0"
        assert result["file_count"] == 2

    def test_overwrite_new_dir_falls_back_to_import(
        self, project, repository, release, user, svn_credential, tmp_path
    ):
        """overwrite 模式下目录不存在时仍走 import_path 首次导入。"""
        task = _make_task(project, repository, release, user, self._snapshot(svn_credential, "overwrite"))
        workspace = self._workspace(tmp_path)

        mock_provider = MagicMock()
        mock_provider.remote_exists.return_value = False

        with patch("apps.package.services.get_provider", return_value=mock_provider):
            PackageService._push_artifacts_to_svn(task, workspace)

        mock_provider.import_path.assert_called_once()
        mock_provider.sync_directory.assert_not_called()

    def test_new_dir_mode_existing_dir_still_fails(
        self, project, repository, release, user, svn_credential, tmp_path
    ):
        """new_dir 模式（显式指定）目录已存在时报错，保持旧行为。"""
        task = _make_task(project, repository, release, user, self._snapshot(svn_credential, "new_dir"))
        workspace = self._workspace(tmp_path)

        mock_provider = MagicMock()
        mock_provider.remote_exists.return_value = True

        with patch("apps.package.services.get_provider", return_value=mock_provider):
            with pytest.raises(RuntimeError, match="SVN 目录已存在"):
                PackageService._push_artifacts_to_svn(task, workspace)

        mock_provider.sync_directory.assert_not_called()
        mock_provider.import_path.assert_not_called()


# ---------------------------------------------------------------------------
# clone_submodules
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestCheckoutSourceSubmodules:
    """clone_submodules 开关测试。"""

    def _run_checkout(self, project, repository, release, user, tmp_path, monkeypatch, snapshot):
        task = _make_task(project, repository, release, user, snapshot)
        workspace = tmp_path / "workspace"
        (workspace / "source").mkdir(parents=True)
        captured: dict = {}

        def capture_command(task, command, cwd, env=None, shell=False):
            captured["command"] = command

        monkeypatch.setattr(PackageService, "_run_command", capture_command)
        monkeypatch.setattr(PackageService, "_build_auth_env", lambda repo, request_user=None: {})

        PackageService._checkout_source(task, workspace)
        return captured["command"]

    def test_clone_includes_recurse_submodules_when_enabled(
        self, project, repository, release, user, tmp_path, monkeypatch
    ):
        command = self._run_checkout(
            project, repository, release, user, tmp_path, monkeypatch,
            {"clone_submodules": True},
        )
        assert "--recurse-submodules" in command
        # 主仓库仍浅克隆，且不浅化子模块（子模块需完整历史以便 push）
        assert "--depth" in command
        assert "--shallow-submodules" not in command

    def test_clone_without_submodules_by_default(
        self, project, repository, release, user, tmp_path, monkeypatch
    ):
        command = self._run_checkout(project, repository, release, user, tmp_path, monkeypatch, {})
        assert "--recurse-submodules" not in command


# ---------------------------------------------------------------------------
# inject_git_credential
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestGitCredentialInjection:
    """inject_git_credential 凭证注入测试。"""

    def _auth_env(self, repo, request_user=None):
        return {
            "TRACE_SHIP_GIT_USERNAME": "oauth2",
            "TRACE_SHIP_GIT_PASSWORD": "token-123",
            "GIT_ASKPASS": "/host/utils/git_askpass.sh",
        }

    def test_disabled_returns_empty(self, project, repository, release, user, tmp_path, monkeypatch):
        task = _make_task(project, repository, release, user, {})
        monkeypatch.setattr(PackageService, "_build_auth_env", self._auth_env)
        assert PackageService._git_inject_env_args(task, tmp_path) == []

    def test_enabled_injects_askpass_and_identity(
        self, project, repository, release, user, tmp_path, monkeypatch
    ):
        """开启时注入容器内 GIT_ASKPASS / 凭证 / 提交身份，并写入 askpass 脚本。"""
        task = _make_task(project, repository, release, user, {"inject_git_credential": True})
        workspace = tmp_path / "workspace"
        (workspace / "tmp").mkdir(parents=True)
        monkeypatch.setattr(PackageService, "_build_auth_env", self._auth_env)

        args = PackageService._git_inject_env_args(task, workspace)

        pairs = {args[i + 1] for i, v in enumerate(args) if v == "-e"}
        assert "GIT_ASKPASS=/workspace/tmp/git-askpass.sh" in pairs
        assert "GIT_TERMINAL_PROMPT=0" in pairs
        assert "TRACE_SHIP_GIT_USERNAME=oauth2" in pairs
        assert "TRACE_SHIP_GIT_PASSWORD=token-123" in pairs
        assert f"GIT_AUTHOR_NAME={user.nickname}" in pairs
        assert "GIT_COMMITTER_EMAIL=trace-ship@local" in pairs
        # askpass 脚本已复制到挂载点且可执行
        askpass = workspace / "tmp" / "git-askpass.sh"
        assert askpass.exists()
        assert askpass.stat().st_mode & stat.S_IXUSR

    def test_run_container_carries_injection_args(
        self, project, repository, release, user, tmp_path, monkeypatch
    ):
        """容器命令包含凭证注入参数。"""
        task = _make_task(project, repository, release, user, {
            "image": "trace-ship/web-builder:node22",
            "script_entry": "/workspace/scripts/pack.sh",
            "build_path": ".",
            "output_path": "artifacts",
            "inject_git_credential": True,
        })
        workspace = tmp_path / "workspace"
        for sub in ("source", "artifacts", "tmp"):
            (workspace / sub).mkdir(parents=True)
        captured: dict = {}

        def capture_command(task, command, cwd, env=None, shell=False):
            captured["command"] = command

        monkeypatch.setattr(PackageService, "_run_command", capture_command)
        monkeypatch.setattr(PackageService, "_build_auth_env", self._auth_env)

        PackageService._run_container(task, workspace)

        command = captured["command"]
        assert "GIT_ASKPASS=/workspace/tmp/git-askpass.sh" in command
        assert "TRACE_SHIP_GIT_PASSWORD=token-123" in command
        # 日志展示脱敏：-e 后的值不泄露明文
        display = PackageService._display_command(command)
        assert "token-123" not in display


@pytest.mark.django_db
class TestRevokeRemoteGitCredential:
    """远程节点构建后回收 Git 认证头测试。"""

    def test_revoke_issues_unset_commands(self, project, repository, release, user):
        """开启注入时构建后 unset 主仓库与子模块的 http.extraHeader。"""
        task = _make_task(project, repository, release, user, {
            "inject_git_credential": True,
            "clone_submodules": True,
        })
        client = MagicMock()
        client.run.return_value = 0

        PackageService._revoke_remote_git_credential(task, client)

        commands = [call.args[0] for call in client.run.call_args_list]
        assert any("config --unset http.extraHeader" in cmd and "submodule" not in cmd for cmd in commands)
        assert any("submodule foreach --recursive" in cmd for cmd in commands)

    def test_revoke_skipped_when_not_injected(self, project, repository, release, user):
        """未开启注入时不执行任何回收命令。"""
        task = _make_task(project, repository, release, user, {})
        client = MagicMock()

        PackageService._revoke_remote_git_credential(task, client)

        client.run.assert_not_called()

    def test_revoke_failure_not_fatal(self, project, repository, release, user, tmp_path):
        """回收命令异常仅记日志，不抛出。"""
        task = _make_task(
            project, repository, release, user, {"inject_git_credential": True},
        )
        task.workspace_path = str(tmp_path / "workspace")
        (tmp_path / "workspace" / "logs").mkdir(parents=True)
        task.log_path = str(tmp_path / "workspace" / "logs" / "build.log")
        client = MagicMock()
        client.run.side_effect = RuntimeError("ssh broken")

        # 不抛异常
        PackageService._revoke_remote_git_credential(task, client)
