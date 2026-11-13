"""浏览器验收专用回环 OA HTTP 与真实 SVN 服务；所有数据由本次入口创建。"""
import argparse
import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlparse

OA_PATH = "/api/v1/ticketscript/create_software_archive_with_number"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    runtime = args.runtime.resolve(strict=True)
    run_id = os.environ["SMOKE_RUN_ID"]
    if (runtime / ".browser-smoke").read_text() != run_id:
        raise RuntimeError("拒绝使用不属于本次验收的临时目录")
    for command in ("svn", "svnadmin", "svnserve"):
        if not shutil.which(command):
            raise RuntimeError(f"真实浏览器 SVN 验收需要 {command}，不能跳过或连接业务服务")
    root = runtime / "external-svn"
    root.mkdir(mode=0o700)
    repo = root / "repo"
    subprocess.run(["svnadmin", "create", str(repo)], check=True, capture_output=True)
    username, password = "browser_reader", secrets.token_urlsafe(24)
    for name, text in {
        "svnserve.conf": "[general]\nanon-access = none\nauth-access = write\npassword-db = passwd\nauthz-db = authz\n",
        "passwd": f"[users]\n{username} = {password}\n",
        "authz": f"[/]\n{username} = rw\n",
    }.items():
        target = repo / "conf" / name
        target.write_text(text, encoding="utf-8")
        target.chmod(0o600)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        svn_port = listener.getsockname()[1]
    svn_process = subprocess.Popen([
        "svnserve", "--foreground", "-d", "-r", str(root),
        "--listen-host", "127.0.0.1", "--listen-port", str(svn_port),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    stopped = threading.Event()
    lock = threading.Lock()
    server = None
    mode = "success"
    receipts = []
    svn_url = f"svn://127.0.0.1:{svn_port}/repo"

    def svn(*arguments):
        # 完整命令含临时密码，异常和日志均不能回显参数。
        try:
            result = subprocess.run([
                "svn", "--non-interactive", "--no-auth-cache", "--username", username,
                "--password", password, *arguments,
            ], text=True, capture_output=True, timeout=30, check=False)
        except subprocess.TimeoutExpired:
            raise RuntimeError("隔离 SVN 操作超时") from None
        if result.returncode:
            raise RuntimeError("隔离 SVN 操作失败")
        return result.stdout

    def shutdown(*_args):
        stopped.set()
        if server:
            threading.Thread(target=server.shutdown, daemon=True).start()

    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, shutdown)
    try:
        for _ in range(100):
            if svn_process.poll() is not None:
                raise RuntimeError("隔离 SVN 启动失败")
            try:
                with socket.create_connection(("127.0.0.1", svn_port), timeout=0.2):
                    break
            except OSError:
                time.sleep(0.05)
        else:
            raise RuntimeError("隔离 SVN 启动超时")
        seed = root / "seed"
        files = {
            "first/目录 空格/安装包@1%.zip": "首次归档产物\n",
            "first/嵌套目录/配套资源.dat": "同次构建的配套资源\n",
            **{f"{name}/{filename}": f"{name} 场景产物\n"
               for name in ("second", "mobile", "confirm", "failure", "timeout", "reapply", "reapply-unknown", "reapply-failure", "reapply-mobile")
               for filename in (f"{name}.zip", "嵌套目录/配套资源.dat")},
            "history/目录 空格/历史安装包@1%.zip": "历史原构建产物\n",
            "history/release-V1.0.0.md": "系统生成说明\n",
            "supplement/目录 空格/补录安装包.zip": "无清单补录文件\n",
            "other-task/邻接任务.zip": "其他任务不可选\n",
        }
        for relative, content in files.items():
            target = seed / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
        svn("import", str(seed), svn_url, "-m", "浏览器隔离样本")
        working = root / "working"
        svn("checkout", svn_url, str(working))
        control_path = f"/control/{run_id}"

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def reply(self, data, status=200):
                payload = json.dumps(data, ensure_ascii=False).encode()
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def do_GET(self):
                if self.path == f"/__browser_smoke__/{run_id}":
                    self.reply({"run": run_id})
                elif self.path == control_path:
                    with lock:
                        self.reply({"requests": list(receipts), "count": len(receipts)})
                else:
                    self.reply({"error": "未找到隔离入口"}, 404)

            def do_POST(self):
                nonlocal mode
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if length > 1024 * 1024:
                        self.reply({"error": "隔离样本过大"}, 413)
                        return
                    body = json.loads(self.rfile.read(length))
                except (ValueError, UnicodeDecodeError):
                    self.reply({"error": "无效样本"}, 400)
                    return
                if self.path == control_path:
                    with lock:
                        if body.get("mode") in {"success", "failure", "timeout", "invalid", "disconnect"}:
                            mode = body["mode"]
                        if body.get("svn") in {"write", "delete"}:
                            relative = body.get("path", "")
                            target = (working / relative).resolve()
                            if not relative or target == working or not target.is_relative_to(working) or ".svn" in target.parts:
                                self.reply({"error": "拒绝越过样本 SVN 目录"}, 400)
                                return
                            if body["svn"] == "delete":
                                svn("delete", str(target) + "@")
                            else:
                                target.parent.mkdir(parents=True, exist_ok=True)
                                target.write_text(body.get("content", "覆盖后的当前内容\n"), encoding="utf-8")
                                svn("add", "--parents", "--force", str(target) + "@")
                            svn("commit", str(working), "-m", "浏览器样本变更")
                    self.reply({"mode": mode})
                    return
                if urlparse(self.path).path != OA_PATH:
                    self.reply({"error": "仅允许本次 OA 接口"}, 404)
                    return
                with lock:
                    selected_mode = mode
                    receipts.append({
                        "method": "POST", "path": OA_PATH, "body": body,
                        "contentType": self.headers.get("Content-Type"),
                        "hasAuthorization": bool(self.headers.get("Authorization")),
                        "hasCookie": bool(self.headers.get("Cookie")), "mode": selected_mode,
                    })
                    number = len(receipts)
                if selected_mode == "timeout":
                    # 真实超过产品 30 秒读取超时，不修改生产超时配置。
                    stopped.wait(35)
                if selected_mode == "disconnect":
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                if selected_mode == "failure":
                    self.reply({"code": -1, "msg": "隔离 OA 明确拒绝本次申请"})
                elif selected_mode == "invalid":
                    self.reply({"code": 0, "data": {"soft_number": "缺少归档对象"}})
                else:
                    self.reply({"code": 0, "msg": "已创建", "data": {
                        "soft_number": body.get("soft_number") or f"OA-SMOKE-{number:03d}",
                        "software_archive_id": {"opaque": {"ticket": f"archive-{number}"}},
                        "number_apply_id": None if body.get("soft_number") else f"number-{number}",
                    }})

        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
        server.daemon_threads = True
        external = {
            "oa_url": f"http://127.0.0.1:{args.port}{OA_PATH}",
            "control_url": f"http://127.0.0.1:{args.port}{control_path}",
            "svn": {"url": svn_url, "username": username, "password": password,
                    "files": {key: f"{svn_url}/{quote(key)}" for key in files}},
        }
        manifest = runtime / "external.json"
        manifest.write_text(json.dumps(external, ensure_ascii=False), encoding="utf-8")
        manifest.chmod(0o600)
        print("隔离 OA HTTP 与原生 SVN 服务就绪；只监听回环地址。", flush=True)
        server.serve_forever(poll_interval=0.1)
    finally:
        stopped.set()
        if server:
            server.server_close()
        svn_process.terminate()
        try:
            svn_process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            svn_process.kill()
            svn_process.wait(timeout=2)
        print("隔离 OA HTTP 与 SVN 子进程已停止。", flush=True)


if __name__ == "__main__":
    main()
