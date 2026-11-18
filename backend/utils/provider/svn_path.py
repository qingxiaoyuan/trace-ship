"""SVN 交付目录的稳定 URL 标识。"""

from urllib.parse import quote, unquote, urlsplit

_DEFAULT_PORTS = {"svn": 3690, "http": 80, "https": 443}


def svn_target(value: str) -> tuple[str, str]:
    """返回规范服务器地址与解码路径，保持路径大小写及字面文件名。"""
    parts = urlsplit(value)
    if (
        parts.scheme not in _DEFAULT_PORTS or not parts.hostname
        or parts.username is not None or parts.password is not None or parts.query or parts.fragment
    ):
        raise ValueError("SVN 目录地址无效")
    host = parts.hostname.rstrip(".").lower()
    host = f"[{host}]" if ":" in host else host.encode("idna").decode("ascii")
    port = parts.port
    suffix = f":{port}" if port is not None and port != _DEFAULT_PORTS[parts.scheme] else ""
    path = unquote(parts.path, errors="strict")
    if "\\" in path or any(ord(char) < 32 for char in path):
        raise ValueError("SVN 目录路径无效")
    # SVN 客户端或代理可能再次解码。拒绝能变成路径跳转的编码。
    checked = path
    for _ in range(4):
        if "\\" in checked or any(segment in (".", "..") for segment in checked.split("/")):
            raise ValueError("SVN 目录路径无效")
        decoded = unquote(checked)
        if checked == decoded:
            break
        checked = decoded
    else:
        raise ValueError("SVN 目录编码无效")
    path = "/".join(segment for segment in path.split("/") if segment)
    return f"{parts.scheme}://{host}{suffix}", path


def canonical_svn_url(value: str) -> str:
    server, path = svn_target(value)
    return server + ("/" + quote(path, safe="/") if path else "")
