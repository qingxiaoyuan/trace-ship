"""模型响应资源限制与错误脱敏。"""
from types import SimpleNamespace

import pytest

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
    monkeypatch.setattr(ai_review_model.requests, "post", lambda *args, **kwargs: response)
    config = SimpleNamespace(endpoint="https://model.example", model="review", protocol="openai", encrypted_api_key="")
    with pytest.raises(ValueError, match="模型响应超时"):
        ai_review_model._ask(config, [{"role": "user", "content": "私有源码"}])
    assert response.closed


def test_model_response_limit_rejects_oversized_content_without_echoing(monkeypatch):
    monkeypatch.setattr(ai_review_model, "MAX_MODEL_RESPONSE", 4)
    response = FakeResponse(["密钥".encode()])
    monkeypatch.setattr(ai_review_model.requests, "post", lambda *args, **kwargs: response)
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
    monkeypatch.setattr(ai_review_model.requests, "post", send)
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
    monkeypatch.setattr(ai_review_model.requests, "post", lambda *args, **kwargs: response)
    config = SimpleNamespace(endpoint="https://model.example", model="review", protocol="openai", encrypted_api_key="")
    result, _ = ai_review_model._ask(config, [{"role": "user", "content": "x"}])
    assert result == {"action": "finish"} and response.closed
