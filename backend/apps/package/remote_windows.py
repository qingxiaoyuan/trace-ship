"""远程 Windows 打包节点执行器（SSH/SFTP）

节点接入要求：
- Windows 安装 OpenSSH Server，默认 shell 为 cmd；
- 节点安装 git 且能访问 GitLab（源码由节点自行克隆）；
- 节点预装构建环境（MSBuild/.NET 等）；
- 约定源码根目录提供 pack.bat 入口（未配置自定义脚本时执行）。

SSH 连接、流式执行与 SFTP 传输等 OS 无关能力在 remote_base.RemoteSSHClient 基类中。
"""
import logging
from pathlib import PureWindowsPath
from typing import Any

from apps.package.remote_base import (
    RemoteNodeError,
    RemoteSSHClient,
    load_node_credential,
    probe_node_tools_impl,
)

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


def decode_remote_line(data: bytes) -> str:
    """解码远程命令输出的一行：优先 UTF-8，回退 GBK（中文 Windows 默认代码页）。"""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("gbk", errors="replace")


def cmd_quote(value: str) -> str:
    """cmd 双引号包裹，内部双引号按 cmd 规范用 "" 转义。

    命令最终由远程 OpenSSH 的默认 shell（cmd）执行，cmd 在双引号字符串内
    以两个连续双引号表示一个字面量双引号；C 运行时的 \\" 转义在此不适用。
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


class RemoteWindowsClient(RemoteSSHClient):
    """远程 Windows 节点操作（cmd 语义）；连接/传输等通用能力见 RemoteSSHClient。"""

    remote_sep = "\\"

    def _decode_line(self, data: bytes) -> str:
        """Windows 节点输出优先 UTF-8，回退 GBK。"""
        return decode_remote_line(data)

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


def test_windows_node_connection(host: str, port: int, credential_id: str, work_root: str = "") -> dict[str, Any]:
    """测试 Windows 节点连通性：SSH 登录 + 系统信息 + git 检测 + 工作目录创建。

    Returns:
        {"ok": True, "os": 系统版本, "git": git 路径或空串, "work_root_ready": bool}

    Raises:
        RemoteNodeError: 连接 / 认证 / 凭证问题
    """
    username, password = load_node_credential(credential_id)

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
    return probe_node_tools_impl(RemoteWindowsClient, NODE_PROBE_CMD, host, port, credential_id, timeout)
