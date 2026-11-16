"""有总时间上限的单次 OA 请求，保留未收完的响应。"""
import json
import subprocess
from base64 import b64encode
from dataclasses import dataclass
from email.message import Message
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from requests import Request
from requests.exceptions import RequestException

MAX_BODY_BYTES = 2 * 1024 * 1024


@dataclass
class OaHttpResult:
    status_code: int | None = None
    body: bytes = b""
    content_type: str = ""
    error: str = ""

    def snapshot(self) -> dict | None:
        if self.status_code is None:
            return None
        headers = Message()
        headers["content-type"] = self.content_type
        try:
            text = self.body.decode(headers.get_content_charset() or "utf-8")
            text.encode("utf-8")  # 某些编解码器能生成 PostgreSQL 不接受的孤立代理字符。
            needs_original_bytes = "\x00" in text
        except (LookupError, ValueError, TypeError):
            text = self.body.decode("utf-8", errors="replace")
            needs_original_bytes = True
        snapshot = {
            "status_code": self.status_code,
            "body": text.replace("\x00", r"\u0000"),
            "complete": not self.error,
        }
        if needs_original_bytes:
            snapshot["body_base64"] = b64encode(self.body).decode("ascii")
        return snapshot


def _header_metadata(path: Path) -> tuple[int | None, str]:
    """只读取最终响应的状态和正文类型，不将响应头写入记录。"""
    status, content_type = None, ""
    if path.is_file():
        with path.open("rb") as headers:
            for line in headers:
                if line.startswith(b"HTTP/"):
                    parts = line.split(maxsplit=2)
                    status = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
                    content_type = ""
                elif line.lower().startswith(b"content-type:"):
                    content_type = line.partition(b":")[2].strip().decode("ascii", errors="replace")
    return (status if status is not None and status >= 200 else None), content_type


def post_archive(endpoint: str, form: dict, *, connect_timeout: float, total_timeout: float) -> OaHttpResult:
    """使用部署镜像已有的 curl 限制整个请求，包含 DNS、响应头和正文。"""
    with TemporaryDirectory(prefix="oa-archive-") as directory:
        config, headers, body = (Path(directory) / name for name in ("request.conf", "headers", "body"))
        try:
            url = Request("POST", endpoint).prepare().url
            if urlsplit(url).username is not None:
                return OaHttpResult(error="OA 接口地址不能包含认证信息")
            # 地址可带查询参数，放进私有配置文件，表单走 stdin，均不进入进程参数。
            config.write_text(f"url = {json.dumps(url, ensure_ascii=False)}\n", encoding="utf-8")
            result = subprocess.run(
                ["curl", "--disable", "--config", str(config), "--silent", "--noproxy", "*",
                 "--proto", "=http,https", "--globoff", "--max-time", f"{total_timeout:.3f}",
                 "--connect-timeout", f"{min(connect_timeout, total_timeout):.3f}",
                 "--max-filesize", str(MAX_BODY_BYTES), "--limit-rate", "512K",
                 "--header", "Content-Type: application/json", "--header", "Accept-Encoding: identity",
                 "--dump-header", str(headers),
                 "--output", str(body), "--data-binary", "@-"],
                input=json.dumps(form, ensure_ascii=False).encode("utf-8"),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=total_timeout + 2,
            )
            return_code = result.returncode
        except subprocess.TimeoutExpired:
            return_code = 28
        except FileNotFoundError:
            return OaHttpResult(error="后端缺少 curl，无法请求 OA")
        except (OSError, ValueError, RequestException):
            return OaHttpResult(error="无法初始化 OA 请求")

        status, content_type = _header_metadata(headers)
        content = b""
        if body.is_file():
            with body.open("rb") as output:
                content = output.read(MAX_BODY_BYTES + 1)
        if return_code == 63 or len(content) > MAX_BODY_BYTES:
            error = "OA 返回正文超过 2 MiB，已停止读取"
        elif return_code == 28:
            error = "等待 OA 返回超时"
        elif return_code or status is None:
            error = "与 OA 的连接失败或中断"
        else:
            error = ""
        return OaHttpResult(status, content[:MAX_BODY_BYTES], content_type, error)
