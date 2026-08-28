"""
探测输出解析工具

供本地 Docker 镜像探测与远程节点探测共用：按段标记解析输出，
并逐段截断控制进入 AI prompt 的总量。
"""

# 各探测段进入 prompt 的长度上限（字符数），合计约 8KB
_PROBE_SECTION_CAPS = {
    "versions": 1500,
    "scripts_dir": 800,
    "pack_sh": 4000,
    "deploy_dir": 800,
    "workdir": 200,
    "path": 1000,
}


def parse_probe_output(stdout: str) -> dict[str, str]:
    """按探测脚本的段标记解析输出，逐段截断控制总量。"""
    markers = {
        "--- versions ---": "versions",
        "--- workspace scripts ---": "scripts_dir",
        "--- pack.sh ---": "pack_sh",
        "--- workspace deploy ---": "deploy_dir",
        "--- pwd ---": "workdir",
        "--- path ---": "path",
    }
    out: dict[str, str] = {}
    current: str | None = None
    buffer: list[str] = []

    def flush() -> None:
        if current and current in markers:
            out[markers[current]] = "\n".join(buffer).strip()

    for line in stdout.splitlines():
        key = markers.get(line.strip())
        if key is not None:
            flush()
            current = line.strip()
            buffer = []
        else:
            buffer.append(line)
    flush()
    for key, cap in _PROBE_SECTION_CAPS.items():
        if key in out:
            out[key] = out[key][:cap]
    return out
