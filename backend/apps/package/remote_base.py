"""远程打包节点 SSH/SFTP 基类（OS 无关部分）

封装 paramiko 连接/重试、流式命令执行、SFTP 上传下载与凭证解析；
Windows / 麒麟 Linux 的 shell 语义（转义、路径、换行、探测命令）由子类实现。
"""
import logging
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from apps.credential.models import Credential
from utils.probe_output import parse_probe_output

logger = logging.getLogger(__name__)


class RemoteNodeError(RuntimeError):
    """远程节点操作失败。"""


def _import_paramiko():
    """延迟导入 paramiko，缺失时给出友好错误。"""
    try:
        import paramiko
    except ImportError as exc:
        raise RemoteNodeError("后端缺少 paramiko 依赖，无法连接远程打包节点") from exc
    return paramiko


def decode_line_utf8(data: bytes) -> str:
    """默认行解码：UTF-8，非法字节替换（Linux 节点默认 UTF-8 环境）。"""
    return data.decode("utf-8", errors="replace")


def load_node_credential(credential_id: str) -> tuple[str, str]:
    """解析节点登录凭证，返回 (username, password)；凭证问题抛 RemoteNodeError。"""
    try:
        credential = Credential.objects.get(id=credential_id)
    except Credential.DoesNotExist as exc:
        raise RemoteNodeError("登录凭证不存在") from exc
    if not credential.is_active:
        raise RemoteNodeError("登录凭证已停用")
    data = credential.get_data()
    username = data.get("username") or ""
    password = data.get("password") or ""
    if not username or not password:
        raise RemoteNodeError("凭证缺少用户名或密码")
    return username, password


class RemoteSSHClient:
    """封装 paramiko SSH/SFTP 的远程节点操作基类，OS 语义由子类实现。"""

    # SFTP 递归下载时的远程路径分隔符（Windows 子类覆盖为 "\\"）
    remote_sep = "/"

    def __init__(self, host: str, port: int, username: str, password: str, timeout: int = 15):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.timeout = timeout
        self._client = None

    @classmethod
    def from_snapshot(cls, snapshot: dict[str, Any]) -> "RemoteSSHClient":
        """从任务配置快照构建客户端（凭证运行时解析，不落快照）。"""
        host = snapshot.get("node_host") or ""
        if not host:
            raise RemoteNodeError("打包配置缺少远程节点信息")
        cred_id = snapshot.get("node_credential_id")
        if not cred_id:
            raise RemoteNodeError("远程节点未配置登录凭证")
        try:
            username, password = load_node_credential(cred_id)
        except RemoteNodeError as exc:
            raise RemoteNodeError(f"远程节点{exc}") from exc
        return cls(
            host=host,
            port=int(snapshot.get("node_port") or 22),
            username=username,
            password=password,
        )

    def __enter__(self) -> "RemoteSSHClient":
        self.connect()
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def connect(self) -> None:
        """建立 SSH 连接。

        并发打包或节点负载较高时，节点 OpenSSH 可能在握手阶段直接断开
        新连接（paramiko 报 No existing session / banner 读取失败），
        属于瞬时故障，做有限重试；认证失败不重试。
        """
        paramiko = _import_paramiko()
        last_exc: Exception | None = None
        for attempt in range(3):
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            try:
                client.connect(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    password=self.password,
                    timeout=self.timeout,
                    # 握手/认证超时放宽：节点繁忙时 banner 交换可能较慢
                    banner_timeout=30,
                    auth_timeout=30,
                    look_for_keys=False,
                    allow_agent=False,
                )
                self._client = client
                return
            except paramiko.AuthenticationException as exc:
                raise RemoteNodeError(f"远程节点认证失败，请检查用户名密码: {self.host}") from exc
            except Exception as exc:
                last_exc = exc
                try:
                    client.close()
                except Exception:
                    pass
                if attempt < 2:
                    logger.warning(
                        "连接远程节点失败，2s 后重试（第 %d 次）%s:%s error=%s",
                        attempt + 1, self.host, self.port, exc,
                    )
                    time.sleep(2)
        raise RemoteNodeError(f"无法连接远程节点 {self.host}:{self.port}: {last_exc}") from last_exc

    def close(self) -> None:
        """关闭连接。"""
        if self._client is not None:
            try:
                self._client.close()
            finally:
                self._client = None

    def _decode_line(self, data: bytes) -> str:
        """解码远程命令输出的一行；子类可覆盖（如 Windows 的 GBK 回退）。"""
        return decode_line_utf8(data)

    def run(
        self,
        command: str,
        on_line: Callable[[str], None] | None = None,
        should_stop: Callable[[], None] | None = None,
    ) -> int:
        """执行远程命令并流式回传输出，返回退出码。

        Args:
            command: 远程 shell 命令行（由节点 SSH 默认 shell 执行）
            on_line: 每行输出回调
            should_stop: 取消检查回调，抛出异常时关闭会话终止远程进程
        """
        if self._client is None:
            raise RemoteNodeError("远程节点未连接")
        channel = self._client.get_transport().open_session()
        channel.set_combine_stderr(True)
        channel.exec_command(command)
        buffer = b""
        try:
            while True:
                if should_stop is not None:
                    should_stop()
                while channel.recv_ready():
                    buffer += channel.recv(4096)
                    while b"\n" in buffer:
                        line, buffer = buffer.split(b"\n", 1)
                        if on_line is not None:
                            on_line(self._decode_line(line).rstrip("\r"))
                if channel.exit_status_ready():
                    # 读完剩余输出
                    while channel.recv_ready():
                        buffer += channel.recv(4096)
                    if buffer and on_line is not None:
                        on_line(self._decode_line(buffer).rstrip("\r"))
                    return channel.recv_exit_status()
                time.sleep(0.5)
        finally:
            channel.close()

    def run_checked(
        self,
        command: str,
        on_line: Callable[[str], None] | None = None,
        should_stop: Callable[[], None] | None = None,
        error_hint: str = "",
    ) -> None:
        """执行远程命令，非零退出码抛 RemoteNodeError。"""
        code = self.run(command, on_line=on_line, should_stop=should_stop)
        if code != 0:
            hint = f"（{error_hint}）" if error_hint else ""
            raise RemoteNodeError(f"远程命令执行失败，退出码 {code}{hint}")

    def download_dir(
        self,
        remote_dir,
        local_dir: Path,
        should_stop: Callable[[], None] | None = None,
    ) -> int:
        """递归下载远程目录到本地目录，返回文件数。

        Args:
            remote_dir: 远程目录
            local_dir: 本地目录
            should_stop: 取消检查回调，抛出异常时中断传输
        """
        if self._client is None:
            raise RemoteNodeError("远程节点未连接")
        sftp = self._client.open_sftp()
        count = 0
        try:
            count = self._sftp_download(sftp, str(remote_dir), local_dir, should_stop)
        finally:
            sftp.close()
        return count

    def _sftp_download(
        self,
        sftp,
        remote_path: str,
        local_path: Path,
        should_stop: Callable[[], None] | None = None,
    ) -> int:
        """递归下载：目录则展开，文件则拉取。远程不存在时返回 0。"""
        import stat as stat_module

        try:
            attrs = sftp.listdir_attr(remote_path)
        except FileNotFoundError:
            return 0
        count = 0
        local_path.mkdir(parents=True, exist_ok=True)
        for entry in attrs:
            if should_stop is not None:
                should_stop()
            entry_remote = remote_path + self.remote_sep + entry.filename
            entry_local = local_path / entry.filename
            if stat_module.S_ISDIR(entry.st_mode):
                count += self._sftp_download(sftp, entry_remote, entry_local, should_stop)
            else:
                sftp.get(entry_remote, str(entry_local))
                count += 1
        return count


def build_remote_client(snapshot: dict[str, Any]) -> RemoteSSHClient:
    """按任务快照中的节点 OS 构建对应远程客户端（旧快照无 node_os_type 时按 Windows 兼容）。"""
    os_type = (snapshot.get("node_os_type") or "windows").lower()
    if os_type == "kylin":
        from apps.package.remote_kylin import RemoteKylinClient

        return RemoteKylinClient.from_snapshot(snapshot)
    from apps.package.remote_windows import RemoteWindowsClient

    return RemoteWindowsClient.from_snapshot(snapshot)


def test_node_connection(
    host: str,
    port: int,
    credential_id: str,
    work_root: str = "",
    os_type: str = "windows",
) -> dict[str, Any]:
    """测试远程节点连通性入口：按节点 OS 分发到对应客户端实现。

    Returns:
        {"ok": True, "os": 系统版本, "git": git 路径或空串, "work_root_ready": bool}

    Raises:
        RemoteNodeError: 连接 / 认证 / 凭证问题
    """
    if (os_type or "windows").lower() == "kylin":
        from apps.package.remote_kylin import test_kylin_node_connection

        return test_kylin_node_connection(host, port, credential_id, work_root)
    from apps.package.remote_windows import test_windows_node_connection

    return test_windows_node_connection(host, port, credential_id, work_root)


def probe_node_tools_impl(
    client_cls: type[RemoteSSHClient],
    probe_cmd: str,
    host: str,
    port: int,
    credential_id: str,
    timeout: int = 30,
) -> tuple[dict[str, Any] | None, str | None]:
    """对远程节点执行只读工具探测的共用实现（具体探测命令由 OS 客户端模块提供）。

    用于 AI 生成打包脚本时提供节点侧工具链上下文；失败返回 (None, 原因)
    供调用方降级，不抛异常。探测命令为平台硬编码只读命令，不修改节点状态。

    Returns:
        ({"versions": ..., "path": ...}, None) 成功；(None, 失败原因) 失败
    """
    try:
        credential = Credential.objects.get(id=credential_id)
    except Credential.DoesNotExist:
        return None, "远程节点登录凭证不存在"
    if not credential.is_active:
        return None, "远程节点登录凭证已停用"
    data = credential.get_data()
    username = data.get("username") or ""
    password = data.get("password") or ""
    if not username or not password:
        return None, "远程节点凭证缺少用户名或密码"

    def _probe() -> str:
        lines: list[str] = []
        with client_cls(
            host=host,
            port=int(port or 22),
            username=username,
            password=password,
        ) as client:
            client.run(probe_cmd, on_line=lines.append)
        return "\n".join(lines)

    try:
        pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="node-probe")
        future = pool.submit(_probe)
        try:
            output = future.result(timeout=timeout)
        finally:
            # 超时后立即返回，不等待后台线程（shutdown(wait=True) 会阻塞到探测结束）
            pool.shutdown(wait=False, cancel_futures=True)
    except TimeoutError:
        return None, f"节点工具探测超时（超过 {timeout} 秒）"
    except RemoteNodeError as exc:
        return None, f"节点工具探测失败：{exc}"
    except Exception as exc:
        return None, f"节点工具探测失败：{exc}"

    parsed = parse_probe_output(output)
    if not parsed.get("versions"):
        return None, "节点未检测到常用构建工具（请确认工具已加入节点 PATH）"
    return parsed, None
