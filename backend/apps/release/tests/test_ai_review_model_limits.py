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


def test_review_batch_stops_after_time_budget(monkeypatch):
    """单批多轮调用达到时间预算后不得继续读取或请求模型。"""
    now = [0]
    calls = []
    monkeypatch.setattr(ai_review_model.time, 'monotonic', lambda: now[0])
    def ask(*args):
        calls.append(1)
        now[0] = ai_review_model.MAX_BATCH_TIMEOUT
        return {'action': 'diff'}, '{"action":"diff"}'
    monkeypatch.setattr(ai_review_model, '_ask', ask)
    run = SimpleNamespace(settings_version=SimpleNamespace(skill_documents=[]))
    scope = SimpleNamespace(diffs=[{'new_path': 'sample.py'}], base_git_hash='', head_git_hash='a',
                            context='', documents={}, context_is_requirement=False)
    with pytest.raises(ValueError, match='审查批次超时'):
        ai_review_model._review_batch(run, scope, release=object())
    assert len(calls) == 1


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


def test_abnormal_finish_logs_only_safe_diagnostics(monkeypatch, caplog):
    """异常结束要能区分截断，并且不能把响应内容和密钥写入日志。"""
    import json
    import logging

    response = FakeResponse([json.dumps({
        'choices': [{'finish_reason': 'length', 'message': {'content': '私有源码-不应写入日志'}}],
        'usage': {'completion_tokens': 8192, 'completion_tokens_details': {'reasoning_tokens': 4096}},
    }).encode()])
    monkeypatch.setattr(ai_review_model._ModelSession, 'post', lambda *args, **kwargs: response)
    config = SimpleNamespace(endpoint='https://model.example', model='review', protocol='openai', encrypted_api_key='')
    with caplog.at_level(logging.WARNING), pytest.raises(ValueError, match='模型输出截断或未确认结束'):
        ai_review_model._ask(config, [{'role': 'user', 'content': '私有输入-不应写入日志'}])
    assert 'finish_reason=length' in caplog.text
    assert 'completion_tokens=8192' in caplog.text
    assert 'reasoning_tokens=4096' in caplog.text
    assert 'max_tokens=8192' in caplog.text
    assert '私有源码' not in caplog.text and '私有输入' not in caplog.text


def test_abnormal_finish_redacts_untrusted_metadata(monkeypatch, caplog):
    """结束标记和用量也视为不可信输入，未知值不得回显。"""
    import json
    import logging

    response = FakeResponse([json.dumps({
        'choices': [{'finish_reason': '伪造的密钥和源码', 'message': {'content': '私有内容'}}],
        'usage': {'completion_tokens': '伪造的密钥和源码', 'completion_tokens_details': {'reasoning_tokens': True}},
    }).encode()])
    monkeypatch.setattr(ai_review_model._ModelSession, 'post', lambda *args, **kwargs: response)
    config = SimpleNamespace(endpoint='https://model.example', model='review', protocol='openai', encrypted_api_key='')
    with caplog.at_level(logging.WARNING), pytest.raises(ValueError, match='模型输出截断或未确认结束'):
        ai_review_model._ask(config, [{'role': 'user', 'content': 'x'}])
    assert 'finish_reason=other' in caplog.text
    assert 'completion_tokens=unknown' in caplog.text
    assert 'reasoning_tokens=unknown' in caplog.text
    assert '伪造的密钥和源码' not in caplog.text and '私有内容' not in caplog.text


@pytest.mark.parametrize(('protocol', 'response', 'reason', 'count'), [
    ('openai', {'choices': [{'message': {'content': '{}'}}]}, 'missing', 'unknown'),
    ('anthropic', {'stop_reason': 'max_tokens', 'content': [], 'usage': {'output_tokens': 321}}, 'max_tokens', '321'),
])
def test_abnormal_finish_logs_missing_and_anthropic_counts(monkeypatch, caplog, protocol, response, reason, count):
    """兼容接口未返回结束标记及 Anthropic 的用量字段均可安全定位。"""
    import json
    import logging

    fake = FakeResponse([json.dumps(response).encode()])
    monkeypatch.setattr(ai_review_model._ModelSession, 'post', lambda *args, **kwargs: fake)
    config = SimpleNamespace(endpoint='https://model.example', model='review', protocol=protocol, encrypted_api_key='')
    with caplog.at_level(logging.WARNING), pytest.raises(ValueError, match='模型输出截断或未确认结束'):
        ai_review_model._ask(config, [{'role': 'user', 'content': 'x'}])
    assert f'protocol={protocol}' in caplog.text
    assert f'finish_reason={reason}' in caplog.text
    assert f'completion_tokens={count}' in caplog.text


@pytest.mark.parametrize('model', ['deepseek-flash', 'deepseek-v4-flash'])
def test_deepseek_flash_official_chat_uses_bounded_reasoning_and_json(monkeypatch, model):
    """官方 Flash 审查保留推理能力，同时为 JSON 结果预留输出预算。"""
    response = FakeResponse([b'{"choices":[{"finish_reason":"stop","message":{"content":"{\\"action\\":\\"finish\\"}"}}]}'])
    calls = []
    def send(*args, **kwargs):
        calls.append(kwargs)
        return response
    monkeypatch.setattr(ai_review_model._ModelSession, 'post', send)
    config = SimpleNamespace(endpoint='https://api.deepseek.com/v1', model=model, protocol='openai', encrypted_api_key='')
    result, _ = ai_review_model._ask(config, [{'role': 'user', 'content': 'x'}])
    assert result == {'action': 'finish'}
    assert calls[0]['json']['max_tokens'] == 32768
    assert calls[0]['json']['reasoning_effort'] == 'low'
    assert calls[0]['json']['response_format'] == {'type': 'json_object'}
    assert calls[0]['timeout'] == (60, 240)


@pytest.mark.parametrize(('endpoint', 'model', 'protocol'), [
    ('https://proxy.example/v1', 'deepseek-flash', 'openai'),
    ('https://api.deepseek.com.attacker.example/v1', 'deepseek-flash', 'openai'),
    ('https://api.deepseek.com/v1', 'another-model', 'openai'),
    ('https://api.deepseek.com/anthropic', 'deepseek-flash', 'anthropic'),
])
def test_deepseek_flash_tuning_does_not_change_other_providers(monkeypatch, endpoint, model, protocol):
    """专用参数不能泄漏到代理、其他模型或其他协议。"""
    import json
    payload = {'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': '{"action":"finish"}'}]} if protocol == 'anthropic' else {'choices': [{'finish_reason': 'stop', 'message': {'content': '{"action":"finish"}'}}]}
    response = FakeResponse([json.dumps(payload).encode()])
    calls = []
    def send(*args, **kwargs):
        calls.append(kwargs)
        return response
    monkeypatch.setattr(ai_review_model._ModelSession, 'post', send)
    config = SimpleNamespace(endpoint=endpoint, model=model, protocol=protocol, encrypted_api_key='')
    ai_review_model._ask(config, [{'role': 'user', 'content': 'x'}])
    assert calls[0]['json']['max_tokens'] == 8192
    assert 'reasoning_effort' not in calls[0]['json']
    assert 'response_format' not in calls[0]['json']
    assert calls[0]['timeout'] == (60, 60)
