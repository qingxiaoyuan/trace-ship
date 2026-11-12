"""临时 SVN 服务只监听回环地址，不读取或连接业务 SVN。"""
import os
import shutil
import socket
import subprocess
import time
from types import SimpleNamespace

import pytest


@pytest.fixture
def svn_sandbox(tmp_path):
    native = shutil.which("svnadmin") and shutil.which("svnserve")
    docker = os.environ.get("TRACE_SHIP_TEST_SVN_DOCKER") == "1"
    if not native and not docker:
        pytest.skip("真实 SVN 专项需要 subversion 的 svnadmin/svnserve，或显式使用隔离 Docker")
    config = "[general]\nanon-access = none\nauth-access = write\npassword-db = passwd\nauthz-db = authz\n"
    passwd = "[users]\nreader = isolated-pass\nblocked = isolated-pass\n"
    authz = "[/]\nreader = rw\nblocked =\n"
    container = None
    process = None
    if native:
        repo = tmp_path / "repo"
        subprocess.run(["svnadmin", "create", str(repo)], check=True, capture_output=True)
        for name, content in (("svnserve.conf", config), ("passwd", passwd), ("authz", authz)):
            (repo / "conf" / name).write_text(content)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        process = subprocess.Popen([
            "svnserve", "--foreground", "-d", "-r", str(tmp_path),
            "--listen-host", "127.0.0.1", "--listen-port", str(port),
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        import shlex

        script = "set -eu\nsvnadmin create /var/svn/repo\n"
        for name, content in (("svnserve.conf", config), ("passwd", passwd), ("authz", authz)):
            script += f"printf %s {shlex.quote(content)} > /var/svn/repo/conf/{name}\n"
        script += "exec svnserve --foreground -d -r /var/svn --listen-host 0.0.0.0\n"
        container = subprocess.check_output([
            "docker", "run", "-d", "--rm", "--tmpfs", "/var/svn",
            "-p", "127.0.0.1::3690", "--entrypoint", "sh",
            "trace-ship-dev-svn:latest", "-c", script,
        ], text=True).strip()
        port = int(subprocess.check_output(["docker", "port", container, "3690"], text=True).strip().rsplit(":", 1)[1])

    def stop():
        if process:
            process.terminate()
            process.wait(timeout=5)
        if container:
            subprocess.run(["docker", "rm", "-f", container], capture_output=True, check=False)

    try:
        for _ in range(100):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.05)
        else:
            pytest.fail("隔离 SVN 未就绪")
        url = f"svn://127.0.0.1:{port}/repo"

        def svn(*args):
            return subprocess.check_output([
                "svn", "--non-interactive", "--no-auth-cache", "--username", "reader",
                "--password", "isolated-pass", *args,
            ], text=True, stderr=subprocess.PIPE, timeout=30)

        seed = tmp_path / "seed"
        (seed / "task" / "目录 空格").mkdir(parents=True)
        (seed / "other-task").mkdir()
        (seed / "task" / "目录 空格" / "安装包@1%.zip").write_bytes(b"current package")
        (seed / "task" / "release-V1.0.0.md").write_text("系统生成的说明", encoding="utf-8")
        (seed / "other-task" / "other.zip").write_bytes(b"other")
        svn("import", str(seed), url, "-m", "隔离样本")
        yield SimpleNamespace(url=url, svn=svn, stop=stop)
    finally:
        stop()
