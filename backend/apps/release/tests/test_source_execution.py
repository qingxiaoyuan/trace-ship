"""公开打包执行边界：真实临时 Git 检出，仅替代外部 Docker 可执行文件。"""

import os
import subprocess

import pytest

from apps.package.models import PackageTask
from apps.package.services import PackageService
from apps.release.models import ReleaseRecord
from utils.provider.base import TagInfo

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize("drift", [False, True])
def test_cleaned_rc_checkout_preserves_sha_and_stops_before_build_on_drift(
    tmp_path, settings, monkeypatch, repository, project, user, drift
):
    repo_path = tmp_path / "source.git"
    repo_path.mkdir()

    def git(*args):
        return subprocess.check_output(["git", "-C", str(repo_path), *args], text=True).strip()

    git("init")
    git("config", "user.name", "测试")
    git("config", "user.email", "test@example.com")
    (repo_path / "version.txt").write_text("RC tested code")
    git("add", ".")
    git("commit", "-m", "tested")
    sha = git("rev-parse", "HEAD")
    git("tag", "VA.1.0.0")
    (repo_path / "version.txt").write_text("later branch code")
    git("commit", "-am", "later")
    if drift:
        git("tag", "-f", "VA.1.0.0")
    repository.url = repo_path.as_uri()
    repository.save()
    rc = ReleaseRecord.objects.create(
        repository=repository,
        project=project,
        publisher=user,
        release_type="rc",
        status="released",
        version="VA.9.0.0",
        tag_name="VA.9.0.0-rc",
        git_hash=sha,
        release_doc="历史RC说明",
    )
    ReleaseRecord.objects.create(
        repository=repository,
        project=project,
        publisher=user,
        release_type="formal",
        status="released",
        version="VA.1.0.0",
        tag_name="VA.1.0.0",
        git_hash=sha,
        source_rc=rc,
    )

    class Remote:
        def list_tags(self, identity):
            return [TagInfo(name="VA.1.0.0", commit_hash=sha)]

    monkeypatch.setattr("apps.release.services.get_provider", lambda *args: Remote())
    binary = tmp_path / "bin"
    binary.mkdir()
    # 外部 Docker 边界替身读取实际挂载源码，留下执行证据与产物。
    docker = binary / "docker"
    docker.write_text("""#!/usr/bin/env python3
import sys, pathlib, subprocess
args=sys.argv[1:]
source=next(x.split(':')[0] for x in args if x.endswith(':/workspace/source'))
artifacts=next(x.split(':')[0] for x in args if x.endswith(':/workspace/artifacts'))
sha=subprocess.check_output(['git','-C',source,'rev-parse','HEAD'],text=True)
pathlib.Path(artifacts,'result.txt').write_text(sha + pathlib.Path(source,'version.txt').read_text())
""")
    docker.chmod(0o755)
    monkeypatch.setenv("PATH", str(binary) + os.pathsep + os.environ["PATH"])
    settings.PACKAGE_WORKSPACE_ROOT = tmp_path / "work"
    task = PackageTask.objects.create(
        repository=repository,
        project=project,
        release=rc,
        triggered_by=user,
        tag_name=rc.tag_name,
        version=rc.version,
        commit_hash=sha,
        config_snapshot={"image": "external-docker-test"},
    )
    result = PackageService.run_task(task)
    assert result.status == ("failure" if drift else "success"), result.error_message
    outputs = list((tmp_path / "work").rglob("result.txt"))
    if drift:
        assert not outputs
        assert "实际检出" in result.error_message
    else:
        assert outputs[0].read_text() == sha + "\nRC tested code"
        assert result.tag_name == rc.tag_name and result.version == rc.version
        assert result.source_ref == "VA.1.0.0"
