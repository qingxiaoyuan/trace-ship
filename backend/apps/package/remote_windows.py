"""远程 Windows 打包节点执行器（SSH/SFTP）

节点接入要求：
- Windows 安装 OpenSSH Server，默认 shell 为 cmd；
- 节点安装 git 且能访问 GitLab（源码由节点自行克隆）；
- 节点预装构建环境（MSBuild/.NET 等）；
- 约定源码根目录提供 pack.bat 入口（未配置自定义脚本时执行）。
"""
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path, PureWindowsPath
from typing import Any, Callable

from apps.credential.models import Credential
from utils.probe_output import parse_probe_output

logger = logging.getLogger(__name__)

# 节点只读工具探测命令：where 常用构建工具并输出版本、PATH。
# 由平台硬编码执行，不包含用户/AI 内容，不会修改节点任何状态。
NODE_PROBE_CMD = r"""
@echo off
echo --- versions ---
for %%c in (node npm npx pnpm yarn python python3 java mvn gradle dotnet go gcc g++ make cmake ruby bundle php composer msbuild) do (
    where "%%c" >nul 2>nul
    if not errorlevel 1 (
        echo [%%c]
        %%c --version 2>&1
    )
)
echo --- path ---
echo %PATH%
""".strip()


class RemoteNodeError(RuntimeError):
    """远程节点操作失败。"""


# 作业对象资源限制包装脚本：优先级 / 核数亲和性 / 内存硬上限（进程树生效）
# 平台在启用内存上限时上传到节点执行，退出码透传给平台判定。
# -NoNewWindow 让子进程继承 SSH 管道的 stdout/stderr，构建日志才能回传平台。
RUN_LIMITED_PS1 = r"""
param(
    [int]$MemMB = 0,
    [int]$Cores = 0,
    [string]$Priority = "BelowNormal",
    [Parameter(Mandatory = $true)][string]$Script
)
$ErrorActionPreference = "Stop"

$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "`"$Script`"" -PassThru -NoNewWindow

# 优先级与核数亲和性（构建子进程继承）
if ($Priority -and $Priority -ne "Normal") {
    try { $p.PriorityClass = $Priority } catch {}
}
if ($Cores -gt 0) {
    try { $p.ProcessorAffinity = [IntPtr](([long]1 -shl $Cores) - 1) } catch {}
}

# 作业对象内存硬上限（JOB_MEMORY 覆盖整棵进程树；KILL_ON_JOB_CLOSE 保证取消时整树回收）
if ($MemMB -gt 0) {
    $sig = @"
using System;
using System.Runtime.InteropServices;
public static class JobApi {
    [DllImport("kernel32.dll")] public static extern IntPtr CreateJobObject(IntPtr attr, string name);
    [DllImport("kernel32.dll")] public static extern bool SetInformationJobObject(IntPtr job, int type, IntPtr info, uint length);
    [DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [StructLayout(LayoutKind.Sequential)]
    public struct IO_COUNTERS {
        public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount;
        public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct BASIC_LIMIT {
        public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit; public IntPtr Affinity;
        public uint PriorityClass; public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct EXTENDED_LIMIT {
        public BASIC_LIMIT BasicLimitInformation; public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
    }
}
"@
    Add-Type -TypeDefinition $sig
    $job = [JobApi]::CreateJobObject([IntPtr]::Zero, "trace-ship-pack")
    $info = New-Object "JobApi+EXTENDED_LIMIT"
    $basic = $info.BasicLimitInformation
    # JOB_OBJECT_LIMIT_JOB_MEMORY(0x1000) | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE(0x2000)
    $basic.LimitFlags = 0x1000 -bor 0x2000
    $info.BasicLimitInformation = $basic
    $info.JobMemoryLimit = [UIntPtr]([uint64]$MemMB * 1MB)
    $size = [Runtime.InteropServices.Marshal]::SizeOf($info)
    $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
    try {
        [Runtime.InteropServices.Marshal]::StructureToPtr($info, $ptr, $false) | Out-Null
        # 9 = JobObjectExtendedLimitInformation
        [void][JobApi]::SetInformationJobObject($job, 9, $ptr, [uint32]$size)
    } finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
    }
    [void][JobApi]::AssignProcessToJobObject($job, $p.Handle)
}

$p.WaitForExit()
exit $p.ExitCode
""".strip()



def _import_paramiko():
    """延迟导入 paramiko，缺失时给出友好错误。"""
    try:
        import paramiko
    except ImportError as exc:
        raise RemoteNodeError("后端缺少 paramiko 依赖，无法连接远程打包节点") from exc
    return paramiko


def decode_remote_line(data: bytes) -> str:
    """解码远程命令输出的一行：优先 UTF-8，回退 GBK（中文 Windows 默认代码页）。"""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("gbk", errors="replace")


def cmd_quote(value: str) -> str:
    """cmd 双引号包裹，内部双引号按 cmd 规范用 \"\" 转义。

    命令最终由远程 OpenSSH 的默认 shell（cmd）执行，cmd 在双引号字符串内
    以两个连续双引号表示一个字面量双引号；C 运行时的 \\\" 转义在此不适用。
    """
    return '"' + str(value).replace('"', '""') + '"'


def build_set_env_prefix(env: dict[str, str]) -> str:
    """把环境变量字典转换为 cmd 的 set 前缀（set "K=V" && ...）。"""
    parts = []
    for key, value in env.items():
        name = str(key)
        raw = str(value)
        if '"' in raw or "%" in raw:
            raise RemoteNodeError(f"环境变量 {name} 的值不能包含双引号或 % 字符")
        parts.append(f"set \"{name}={raw}\"")
    return " && ".join(parts)


class RemoteWindowsClient:
    """封装 paramiko SSH/SFTP 的远程 Windows 节点操作。"""

    def __init__(self, host: str, port: int, username: str, password: str, timeout: int = 15):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.timeout = timeout
        self._client = None

    @classmethod
    def from_snapshot(cls, snapshot: dict[str, Any]) -> "RemoteWindowsClient":
        """从任务配置快照构建客户端（凭证运行时解析，不落快照）。"""
        host = snapshot.get("node_host") or ""
        if not host:
            raise RemoteNodeError("打包配置缺少远程节点信息")
        cred_id = snapshot.get("node_credential_id")
        if not cred_id:
            raise RemoteNodeError("远程节点未配置登录凭证")
        try:
            credential = Credential.objects.get(id=cred_id)
        except Credential.DoesNotExist as exc:
            raise RemoteNodeError("远程节点登录凭证不存在") from exc
        if not credential.is_active:
            raise RemoteNodeError("远程节点登录凭证已停用")
        data = credential.get_data()
        username = data.get("username") or ""
        password = data.get("password") or ""
        if not username or not password:
            raise RemoteNodeError("远程节点凭证缺少用户名或密码")
        return cls(
            host=host,
            port=int(snapshot.get("node_port") or 22),
            username=username,
            password=password,
        )

    def __enter__(self) -> "RemoteWindowsClient":
        self.connect()
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def connect(self) -> None:
        """建立 SSH 连接。

        并发打包或节点负载较高时，Windows OpenSSH 可能在握手阶段直接断开
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

    def run(
        self,
        command: str,
        on_line: Callable[[str], None] | None = None,
        should_stop: Callable[[], None] | None = None,
    ) -> int:
        """执行远程命令并流式回传输出，返回退出码。

        Args:
            command: cmd 命令行（OpenSSH 默认以 cmd /c 执行）
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
                            on_line(decode_remote_line(line).rstrip("\r"))
                if channel.exit_status_ready():
                    # 读完剩余输出
                    while channel.recv_ready():
                        buffer += channel.recv(4096)
                    if buffer and on_line is not None:
                        on_line(decode_remote_line(buffer).rstrip("\r"))
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

    def mkdirs(self, *paths: PureWindowsPath) -> None:
        """批量创建远程目录（cmd mkdir 自动创建中间层级）。"""
        for path in paths:
            self.run_checked(f"if not exist {cmd_quote(str(path))} mkdir {cmd_quote(str(path))}")

    def remove_dir(self, path: PureWindowsPath) -> None:
        """删除远程目录（忽略失败，仅用于清理）。"""
        try:
            self.run(f"if exist {cmd_quote(str(path))} rmdir /s /q {cmd_quote(str(path))}")
        except Exception:
            logger.warning("清理远程目录失败 %s:%s", self.host, path)

    def upload_text(self, remote_path: PureWindowsPath, content: str) -> None:
        """上传文本内容到远程文件（统一转 CRLF，供 cmd/call 使用）。"""
        if self._client is None:
            raise RemoteNodeError("远程节点未连接")
        data = content.replace("\r\n", "\n").replace("\n", "\r\n")
        sftp = self._client.open_sftp()
        try:
            with sftp.open(str(remote_path), "w") as f:
                f.write(data)
        finally:
            sftp.close()

    def download_dir(
        self,
        remote_dir: PureWindowsPath,
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
            entry_remote = remote_path + "\\" + entry.filename
            entry_local = local_path / entry.filename
            if stat_module.S_ISDIR(entry.st_mode):
                count += self._sftp_download(sftp, entry_remote, entry_local, should_stop)
            else:
                sftp.get(entry_remote, str(entry_local))
                count += 1
        return count


def test_node_connection(host: str, port: int, credential_id: str, work_root: str = "") -> dict[str, Any]:
    """测试远程节点连通性：SSH 登录 + 系统信息 + git 检测 + 工作目录创建。

    Returns:
        {"ok": True, "os": 系统版本, "git": git 路径或空串, "work_root_ready": bool}

    Raises:
        RemoteNodeError: 连接 / 认证 / 凭证问题
    """
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

    result: dict[str, Any] = {"ok": True, "os": "", "git": "", "work_root_ready": False}
    with RemoteWindowsClient(host=host, port=int(port or 22), username=username, password=password) as client:
        lines: list[str] = []
        client.run("ver", on_line=lines.append)
        result["os"] = " ".join(line.strip() for line in lines if line.strip())

        lines.clear()
        code = client.run("where git", on_line=lines.append)
        if code == 0 and lines:
            result["git"] = lines[0].strip()

        if work_root:
            client.mkdirs(PureWindowsPath(work_root))
            result["work_root_ready"] = True
    return result


def probe_node_tools(
    host: str,
    port: int,
    credential_id: str,
    timeout: int = 30,
) -> tuple[dict[str, Any] | None, str | None]:
    """
    对远程 Windows 节点执行只读工具探测（where 常用构建工具 + --version + PATH）。

    用于 AI 生成打包脚本时提供节点侧工具链上下文；失败返回 (None, 原因)
    供调用方降级，不抛异常。探测命令为平台硬编码只读命令，不修改节点状态。

    Args:
        host: 节点主机地址
        port: SSH 端口
        credential_id: windows_password 凭证 id
        timeout: 探测总超时秒数

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
        with RemoteWindowsClient(
            host=host,
            port=int(port or 22),
            username=username,
            password=password,
        ) as client:
            client.run(NODE_PROBE_CMD, on_line=lines.append)
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
