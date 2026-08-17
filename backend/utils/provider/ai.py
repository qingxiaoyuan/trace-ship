"""
通用 AI 大模型调用客户端（OpenAI / Anthropic 兼容协议）

协议识别与 URL 拼接逻辑与 vscode-commit 插件保持一致：
- OpenAI 兼容：POST {endpoint}/v1/chat/completions
- Anthropic 兼容：POST {endpoint}/v1/messages

``api_protocol`` 支持 auto / openai / anthropic；auto 按 endpoint 是否包含
``/anthropic`` 判断。调用失败统一抛出 :class:`AIClientError`，由业务层
映射为可读错误。
"""
import json
import logging

import requests

logger = logging.getLogger(__name__)
# 输出 token 上限：脚本 + 逐行解释 JSON 需要较大空间，4096 容易截断导致解析失败
DEFAULT_MAX_TOKENS = 8192


class AIClientError(RuntimeError):
    """AI 服务调用失败（网络 / 非 2xx / 响应不可解析 / 内容为空）。"""


def _is_anthropic(endpoint: str, protocol: str) -> bool:
    """按 protocol 与 endpoint 判断是否使用 Anthropic Messages 协议。"""
    if protocol == "openai":
        return False
    if protocol == "anthropic":
        return True
    return "/anthropic" in endpoint


def _build_url(endpoint: str, anthropic: bool) -> str:
    """
    拼接完整请求地址，兼容常见填法：
    - https://api.deepseek.com / https://api.deepseek.com/v1
    - https://api.deepseek.com/v1/chat/completions
    - https://api.minimaxi.com/anthropic
    """
    base = endpoint.rstrip("/")
    if anthropic:
        if base.endswith("/v1/messages"):
            return base
        return f"{base}/v1/messages"
    if base.endswith("/v1/chat/completions"):
        return base
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base}/chat/completions"
    return f"{base}/v1/chat/completions"


def _extract_text(data: dict) -> str:
    """兼容 OpenAI / Anthropic / 常见网关的文本字段。"""
    return (
        (data.get("choices") or [{}])[0].get("message", {}).get("content")
        or (data.get("choices") or [{}])[0].get("text")
        or (data.get("choices") or [{}])[0].get("delta", {}).get("content")
        or "".join(
            block.get("text", "")
            for block in (data.get("content") or [])
            if isinstance(block, dict) and block.get("type") == "text"
        )
        or data.get("content")
        or data.get("message", {}).get("content")
        or data.get("text")
        or data.get("output")
        or ""
    )


def call_ai_chat(
    endpoint: str,
    api_key: str,
    model: str,
    protocol: str = "auto",
    system: str = "",
    user: str = "",
    timeout: int = 300,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """
    调用 AI 聊天补全接口并返回纯文本内容。

    Args:
        endpoint: AI 服务根地址（自动拼接协议路径）
        api_key: API 密钥
        model: 模型名称
        protocol: auto / openai / anthropic
        system: 系统提示词
        user: 用户提示词
        timeout: 请求超时秒数

    Returns:
        模型返回的文本（已去除首尾空白）

    Raises:
        AIClientError: 网络、非 2xx 或响应内容为空
    """
    anthropic = _is_anthropic(endpoint, protocol)
    url = _build_url(endpoint, anthropic)
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    if anthropic:
        headers["anthropic-version"] = "2023-06-01"
        # Anthropic 原生鉴权头是 x-api-key；同时携带 Bearer 兼容部分网关
        headers["x-api-key"] = api_key
        body: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": 0,
            "messages": [{"role": "user", "content": user}],
        }
        if system:
            body["system"] = system
    else:
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0,
            "stream": False,
            "max_tokens": max_tokens,
        }

    try:
        resp = requests.post(url, json=body, headers=headers, timeout=timeout)
    except requests.RequestException as exc:
        raise AIClientError(f"AI 服务请求失败: {exc}") from exc

    if resp.status_code != 200:
        raise AIClientError(
            f"AI 服务返回异常状态 {resp.status_code}: {resp.text[:200]}"
        )
    try:
        data = resp.json()
    except ValueError as exc:
        raise AIClientError("AI 服务返回不是合法 JSON") from exc

    text = _extract_text(data)
    if not text or not text.strip():
        # 推理模型可能把输出 token 全耗在 reasoning 上：content 为空且
        # finish_reason=length，属于截断而非“返回空”，给出可操作的提示
        try:
            finish_reason = (data.get("choices") or [{}])[0].get("finish_reason") or ""
        except Exception:
            finish_reason = ""
        if finish_reason == "length":
            raise AIClientError(
                "AI 输出被截断（推理消耗了过多输出 token），"
                "请在系统配置「AI 服务」中调大 ai_max_tokens 后重试"
            )
        raise AIClientError("AI 服务返回内容为空")
    return text.strip()


def call_ai_chat_stream(
    endpoint: str,
    api_key: str,
    model: str,
    protocol: str = "auto",
    system: str = "",
    user: str = "",
    on_chunk=None,
    timeout: int = 300,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """
    以流式方式调用 AI 接口，逐块回调文本并返回完整内容。

    Args:
        on_chunk: 每收到一段文本即回调（可空），用于前端 SSE 实时展示

    Returns:
        完整返回文本

    Raises:
        AIClientError: 网络、非 2xx 或内容为空
    """
    anthropic = _is_anthropic(endpoint, protocol)
    url = _build_url(endpoint, anthropic)
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    if anthropic:
        headers["anthropic-version"] = "2023-06-01"
        headers["x-api-key"] = api_key
        body: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": 0,
            "stream": True,
            "messages": [{"role": "user", "content": user}],
        }
        if system:
            body["system"] = system
    else:
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0,
            "stream": True,
            "max_tokens": max_tokens,
        }

    try:
        resp = requests.post(url, json=body, headers=headers, stream=True, timeout=timeout)
    except requests.RequestException as exc:
        raise AIClientError(f"AI 服务请求失败: {exc}") from exc
    if resp.status_code != 200:
        try:
            # 流式响应非 200：只读有限字节并立即关闭，避免下载完整 body
            body_text = next(iter(resp.iter_content(chunk_size=256)), b"")[:200]
            if isinstance(body_text, bytes):
                body_text = body_text.decode("utf-8", errors="replace")
        except Exception:
            body_text = ""
        finally:
            resp.close()
        raise AIClientError(f"AI 服务返回异常状态 {resp.status_code}: {body_text}")

    parts: list[str] = []
    try:
        for raw_line in resp.iter_lines(decode_unicode=True):
            line = (raw_line or "").strip()
            if not line.startswith("data:"):
                continue
            payload = line[len("data:"):].strip()
            if payload == "[DONE]":
                break
            try:
                data = json.loads(payload)
            except ValueError:
                continue
            text = _extract_stream_text(data, anthropic)
            if text:
                parts.append(text)
                if on_chunk:
                    on_chunk(text)
    except requests.RequestException as exc:
        raise AIClientError(f"AI 服务流式读取失败: {exc}") from exc
    finally:
        resp.close()

    full = "".join(parts)
    if not full.strip():
        # 部分网关忽略 stream=true（整包返回普通 JSON，无 data: 前缀）：
        # 回退非流式再取一次，避免流式空结果被当成失败
        logger.warning("AI 流式接口未返回任何文本片段，回退非流式调用")
        return call_ai_chat(
            endpoint,
            api_key,
            model,
            protocol,
            system=system,
            user=user,
            timeout=timeout,
        )
    return full.strip()


def _extract_stream_text(data: dict, anthropic: bool) -> str:
    """从流式事件块中提取文本片段。"""
    if anthropic:
        # Anthropic SSE：{"type": "content_block_delta", "delta": {"type": "text_delta", "text": "..."}}
        if data.get("type") == "content_block_delta":
            delta = data.get("delta") or {}
            if delta.get("type") == "text_delta":
                return delta.get("text", "") or ""
        return ""
    # OpenAI 兼容 SSE：{"choices": [{"delta": {"content": "..."}}]}
    choices = data.get("choices") or []
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    return delta.get("content") or ""
