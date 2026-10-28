"""模型响应资源限制与错误脱敏。"""
from types import SimpleNamespace

import pytest
import requests

from apps.workflow import ai_review_model


class FakeResponse:
    status_code = 200
    headers = {}

    def __init__(self, chunks):
        self.raw = self
        self.content = b"".join(chunks)
        self.closed = False

    def read1(self, size, decode_content=False):
        assert size <= 8192 and not decode_content
        chunk, self.content = self.content[:size], self.content[size:]
        return chunk

    def close(self):
        self.closed = True


def test_model_response_slow_stream_stops_at_total_budget(monkeypatch):
    clock = iter([0, 1, 2, 3, 301])
    monkeypatch.setattr(ai_review_model.time, "monotonic", lambda: next(clock))
    response = FakeResponse([b"a", b"b"])
    monkeypatch.setattr(ai_review_model._ModelSession, "post", lambda *args, **kwargs: response)
    config = SimpleNamespace(endpoint="https://model.example", model="review", protocol="openai", encrypted_api_key="")
    with pytest.raises(ValueError, match="模型响应超时"):
        ai_review_model._ask(config, [{"role": "user", "content": "私有源码"}])
    assert response.closed


def test_model_response_limit_rejects_oversized_content_without_echoing(monkeypatch):
    monkeypatch.setattr(ai_review_model, "MAX_MODEL_RESPONSE", 4)
    response = FakeResponse(["密钥".encode()])
    monkeypatch.setattr(ai_review_model._ModelSession, "post", lambda *args, **kwargs: response)
    config = SimpleNamespace(endpoint="https://model.example", model="review", protocol="openai", encrypted_api_key="")
    with pytest.raises(ValueError, match="模型响应过大") as error:
        ai_review_model._ask(config, [{"role": "user", "content": "私有源码"}])
    assert "密钥" not in str(error.value) and "私有源码" not in str(error.value)
    assert response.closed


def test_model_response_valid_json_and_request_limits(monkeypatch):
    content = b'{"choices":[{"finish_reason":"stop","message":{"content":"{\\"action\\":\\"finish\\"}"}}]}'
    response = FakeResponse([content, b""])
    requests_sent = []
    def send(*args, **kwargs):
        requests_sent.append(kwargs)
        return response
    monkeypatch.setattr(ai_review_model._ModelSession, "post", send)
    config = SimpleNamespace(endpoint="https://model.example", model="review", protocol="openai", encrypted_api_key="")
    result, _ = ai_review_model._ask(config, [{"role": "user", "content": "x"}])
    assert result == {"action": "finish"} and response.closed
    assert requests_sent[0]["stream"] is True
    assert requests_sent[0]["timeout"] == (60, 60)
    assert requests_sent[0]["headers"]["Accept-Encoding"] == "identity"


def test_model_response_supports_urllib3_without_read1(monkeypatch):
    class LegacyResponse(FakeResponse):
        read1 = None

        def read(self, size, decode_content=False):
            assert size == 1 and not decode_content
            chunk, self.content = self.content[:size], self.content[size:]
            return chunk

    content = b'{"choices":[{"finish_reason":"stop","message":{"content":"{\\"action\\":\\"finish\\"}"}}]}'
    response = LegacyResponse([content])
    monkeypatch.setattr(ai_review_model._ModelSession, "post", lambda *args, **kwargs: response)
    config = SimpleNamespace(endpoint="https://model.example", model="review", protocol="openai", encrypted_api_key="")
    result, _ = ai_review_model._ask(config, [{"role": "user", "content": "x"}])
    assert result == {"action": "finish"} and response.closed


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_redirect_does_not_read_large_body_or_send_to_target(monkeypatch, status):
    """真实 Requests 会话遇到重定向时，不读取超限正文，也不转发请求。"""
    class RawBody:
        def __init__(self):
            self.reads = 0
            self.closed = False
            self.released = False

        def stream(self, *args, **kwargs):
            self.reads += 1
            yield b"x" * 3_000_000

        def close(self):
            self.closed = True

        def release_conn(self):
            self.released = True

    class MemoryAdapter(requests.adapters.BaseAdapter):
        def __init__(self):
            self.raw = RawBody()
            self.sent = []
            self.closed = False

        def send(self, request, **kwargs):
            self.sent.append(request)
            response = requests.Response()
            response.status_code = status
            response.url = request.url
            response.request = request
            response.headers["Location"] = "https://attacker.example/collect"
            response.raw = self.raw
            return response

        def close(self):
            self.closed = True

    adapter = MemoryAdapter()
    original_init = ai_review_model._ModelSession.__init__

    def init(session):
        original_init(session)
        session.trust_env = False
        session.mount("https://", adapter)

    monkeypatch.setattr(ai_review_model._ModelSession, "__init__", init)
    config = SimpleNamespace(endpoint="https://model.example", model="review", protocol="openai", encrypted_api_key="")
    with pytest.raises(ValueError, match="模型请求失败"):
        ai_review_model._ask(config, [{"role": "user", "content": "私有源码"}])
    assert len(adapter.sent) == 1 and adapter.sent[0].url.startswith("https://model.example/")
    assert adapter.raw.reads == 0
    assert adapter.raw.closed and adapter.raw.released and adapter.closed
