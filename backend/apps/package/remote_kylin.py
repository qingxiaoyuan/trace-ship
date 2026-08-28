"""远程麒麟 Linux 打包节点执行器（SSH/SFTP）

节点接入要求：
- 节点开启 SSH 服务，默认 shell 为 sh/bash；
- 节点安装 git 且能访问 GitLab（源码由节点自行克隆）；
- 节点预装构建环境；
- 约定源码根目录提供 pack.sh 入口（未配置自定义脚本时执行）。

资源限制用 POSIX 工具实现（ulimit -v / taskset / nice），不依赖 systemd。
"""
import logging
import re
import shlex
from pathlib import PurePosixPath
from typing import Any

from apps.package.remote_base import (
    RemoteNodeError,
    RemoteSSHClient,
    load_node_credential,
    probe_node_tools_impl,
)

logger = logging.getLogger(__name__)

# 节点只读工具探测命令：command -v 常用构建工具并输出版本、PATH。
# 由平台硬编码执行，不包含用户/AI 内容，不会修改节点任何状态。
NODE_PROBE_CMD = r"""
echo --- versions ---
for c in node npm npx pnpm yarn python python3 java mvn gradle dotnet go gcc g++ make cmake ruby bundle php composer; do
    if command -v "$c" >/dev/null 2>&1; then
        echo "[$c]"
        "$c" --version 2>&1
    fi
done
echo --- path ---
echo "$PATH"
""".strip()

# 构建 CPU 优先级 → nice 值（越大优先级越低）
PRIORITY_NICE = {"normal": 0, "belownormal": 10, "low": 19}

_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def sh_quote(value: str) -> str:
    """sh 参数转义（shlex.quote，单引号包裹）。"""
    return shlex.quote(str(value))


def build_export_lines(env: dict[str, str]) -> list[str]:
    """把环境变量字典转换为 sh 的 export 行（export K='V'）。"""
    lines = []
    for key, value in env.items():
        name = str(key)
        if not _ENV_KEY_RE.match(name):
            raise RemoteNodeError(f"环境变量名不合法: {name}")
        lines.append(f"export {name}={sh_quote(str(value))}")
    return lines


def build_pack_run_script(
    work_dir,
    env: dict[str, str],
    target_script,
    cores: int = 0,
    priority: str = "normal",
    mem_mb: int = 0,
) -> str:
    """生成麒麟节点构建包装脚本 pack-run.sh 内容。

    包装脚本负责 cd 到构建目录、export 注入环境变量，并以 sh -e（遇错即停）
    执行目标脚本，目标脚本退出码即包装脚本最终退出码，透传给平台判定。
    资源限制（均为可选）：
    - 内存上限：ulimit -v <KB>（MB 换算 KB），为每进程虚拟地址空间上限，
      子进程各自继承同值（与 Windows JobObject 的树级聚合硬顶语义不对等）；
    - 核数亲和：taskset -c 0..N-1；
    - CPU 优先级：nice -n <0/10/19>（normal/belownormal/low）。
    """
    lines = [
        f"cd {sh_quote(str(work_dir))} || exit 1",
        *build_export_lines(env),
    ]
    if mem_mb > 0:
        lines.append(f"ulimit -v {mem_mb * 1024}")
    prefix = ""
    if cores > 0:
        prefix += f"taskset -c 0-{cores - 1} "
    nice = PRIORITY_NICE.get((priority or "normal").lower(), 0)
    if nice > 0:
        prefix += f"nice -n {nice} "
    lines.append(f"{prefix}sh -e {sh_quote(str(target_script))}")
    return "\n".join(lines) + "\n"


class RemoteKylinClient(RemoteSSHClient):
    """远程麒麟 Linux 节点操作（sh 语义）；连接/传输等通用能力见 RemoteSSHClient。"""

    def mkdirs(self, *paths: PurePosixPath) -> None:
        """批量创建远程目录（mkdir -p 自动创建中间层级）。"""
        for path in paths:
            self.run_checked(f"mkdir -p {sh_quote(str(path))}")

    def remove_dir(self, path: PurePosixPath) -> None:
        """删除远程目录（忽略失败，仅用于清理）。"""
        try:
            self.run(f"rm -rf {sh_quote(str(path))}")
        except Exception:
            logger.warning("清理远程目录失败 %s:%s", self.host, path)

    def upload_text(self, remote_path: PurePosixPath, content: str) -> None:
        """上传文本内容到远程文件（保持 LF，供 sh 执行）。"""
        if self._client is None:
            raise RemoteNodeError("远程节点未连接")
        data = content.replace("\r\n", "\n")
        sftp = self._client.open_sftp()
        try:
            with sftp.open(str(remote_path), "w") as f:
                f.write(data)
        finally:
            sftp.close()


def test_kylin_node_connection(host: str, port: int, credential_id: str, work_root: str = "") -> dict[str, Any]:
    """测试麒麟节点连通性：SSH 登录 + uname 系统信息 + git 检测 + 工作目录创建。

    Returns:
        {"ok": True, "os": 系统版本, "git": git 路径或空串, "work_root_ready": bool}

    Raises:
        RemoteNodeError: 连接 / 认证 / 凭证问题
    """
    username, password = load_node_credential(credential_id)

    result: dict[str, Any] = {"ok": True, "os": "", "git": "", "work_root_ready": False}
    with RemoteKylinClient(host=host, port=int(port or 22), username=username, password=password) as client:
        lines: list[str] = []
        client.run("uname -a", on_line=lines.append)
        result["os"] = " ".join(line.strip() for line in lines if line.strip())

        lines.clear()
        code = client.run("command -v git", on_line=lines.append)
        if code == 0 and lines:
            result["git"] = lines[0].strip()

        if work_root:
            client.mkdirs(PurePosixPath(work_root))
            result["work_root_ready"] = True
    return result


def probe_node_tools(
    host: str,
    port: int,
    credential_id: str,
    timeout: int = 30,
) -> tuple[dict[str, Any] | None, str | None]:
    """对麒麟节点执行只读工具探测（command -v 常用构建工具 + --version + PATH）。

    失败返回 (None, 原因) 供调用方降级，不抛异常。
    """
    return probe_node_tools_impl(RemoteKylinClient, NODE_PROBE_CMD, host, port, credential_id, timeout)
