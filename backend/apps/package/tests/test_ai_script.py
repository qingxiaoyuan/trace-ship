"""打包脚本 AI 生成功能测试（服务、GitLab 扫描、容器探测、视图接口）。"""
import subprocess

import pytest
from rest_framework.test import APIClient

from apps.account.models import User
from apps.credential.models import Credential
from apps.package.ai import MAX_KNOWLEDGE_ENTRIES, PackageScriptAIError, PackageScriptAIService
from apps.package.docker_local import IMAGE_PROBE_SH, LocalDockerService
from apps.package.models import PackageKnowledge, PackageNode, PackageTask
from apps.package.remote_windows import NODE_PROBE_CMD, RemoteNodeError, probe_node_tools
from apps.project.models import Project, ProjectMember
from apps.release.models import ReleaseRecord
from apps.repository.models import Repository
from apps.system.models import OperationLog, SystemConfig
from utils.probe_output import parse_probe_output
from utils.provider.ai import AIClientError, call_ai_chat, call_ai_chat_stream
from utils.provider.exceptions import AuthenticationError, NotFoundError, ProviderError
from utils.provider.gitlab import GitLabProvider

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_user():
    return User.objects.create_user(
        username="package_ai_admin",
        password="pass",
        nickname="打包 AI 管理员",
    )


@pytest.fixture
def developer_user():
    return User.objects.create_user(
        username="package_ai_dev",
        password="pass",
        nickname="打包 AI 开发",
    )


@pytest.fixture
def project(admin_user):
    project = Project.objects.create(
        name="AI 打包项目",
        code="AIPKG",
        leader=admin_user,
        status=1,
    )
    ProjectMember.objects.create(project=project, user=admin_user, role="software_admin")
    return project


@pytest.fixture
def repository(project):
    return Repository.objects.create(
        project=project,
        repo_type="git",
        vendor="gitlab",
        name="web",
        url="https://gitlab.example.com",
        external_identity="group/web",
        default_branch="main",
    )


@pytest.fixture
def ai_config():
    """写入可用的 AI 服务系统配置。"""
    rows = [
        ("ai_endpoint", "http://ai.local/v1", "AI 服务地址"),
        ("ai_api_key", "test-key-123", "AI 密钥"),
        ("ai_model", "deepseek-chat", "AI 模型"),
        ("ai_protocol", "openai", "AI 协议"),
    ]
    for key, value, description in rows:
        SystemConfig.objects.create(key=key, value=value, description=description, is_public=False)
    return rows


@pytest.fixture
def node_credential(admin_user):
    cred = Credential.objects.create(
        name="节点凭证",
        cred_type="windows_password",
        auth_mode="password",
        username="node-admin",
        owner=admin_user,
        is_active=True,
    )
    cred.set_data({"username": "node-admin", "password": "secret"})
    cred.save()
    return cred


@pytest.fixture
def package_node(project, node_credential):
    return PackageNode.objects.create(
        name="打包节点-1",
        host="10.0.0.10",
        port=22,
        credential=node_credential,
        work_root=r"C:\trace-ship\workspaces",
        is_active=True,
    )


@pytest.fixture
def release(project, repository, admin_user):
    return ReleaseRecord.objects.create(
        project=project,
        repository=repository,
        version="V1.0.0",
        tag_name="V1.0.0",
        branch="main",
        release_type="formal",
        status="released",
        publisher=admin_user,
    )


def make_package_task(
    project,
    repository,
    release,
    script: str,
    status: str = "success",
    executor_type: str = "local_docker",
    image: str = "web:latest",
    version: str = "V1.0.0",
    config_id: str = "cfg-1",
):
    """创建带配置快照的打包任务（脚本写入快照）。"""
    return PackageTask.objects.create(
        project=project,
        repository=repository,
        release=release,
        name=f"{project.name} 打包 / {version}",
        tag_name=version,
        version=version,
        status=status,
        config_snapshot={
            "config_id": config_id,
            "executor_type": executor_type,
            "image": image,
            "build_path": ".",
            "output_path": "dist",
            "custom_script": script,
        },
    )


class FakeResponse:
    def __init__(self, json_data=None, headers=None, content=b"", text="", status_code=200):
        self._json = json_data
        self.headers = headers or {}
        self.content = content
        self.text = text
        self.status_code = status_code

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError(f"unexpected status {self.status_code}")


def make_provider() -> GitLabProvider:
    return GitLabProvider("https://gitlab.example.com", {"token": "glpat-test"})


class TestGitLabProviderTree:
    """GitLab provider 文件树与文件内容接口测试。"""

    def test_list_tree_pagination_and_params(self, monkeypatch):
        provider = make_provider()
        captured: dict = {}

        def fake_request(method, path, **kwargs):
            captured["path"] = path
            captured["params"] = kwargs.get("params")
            if kwargs["params"]["page"] == 1:
                return FakeResponse(
                    [
                        {"name": "a.txt", "type": "blob", "path": "a.txt"},
                        {"name": "src", "type": "tree", "path": "src"},
                    ],
                    {"X-Next-Page": "2"},
                )
            return FakeResponse([], {})

        monkeypatch.setattr(provider, "_request", fake_request)
        result = provider.list_tree("group/web", ref="main")
        assert [item["path"] for item in result] == ["a.txt", "src"]
        assert captured["path"] == "/projects/group%2Fweb/repository/tree"
        assert captured["params"]["recursive"] == "true"
        assert captured["params"]["ref"] == "main"

    def test_list_tree_cap_max_entries(self, monkeypatch):
        provider = make_provider()
        entries = [
            {"name": f"{i}.txt", "type": "blob", "path": f"{i}.txt"}
            for i in range(5)
        ]

        def fake_request(method, path, **kwargs):
            return FakeResponse(entries, {"X-Next-Page": "2"})

        monkeypatch.setattr(provider, "_request", fake_request)
        result = provider.list_tree("group/web", max_entries=2)
        assert len(result) == 2

    def test_get_file_raw_url_encoding_and_content(self, monkeypatch):
        provider = make_provider()
        captured: dict = {}

        def fake_request(method, path, **kwargs):
            captured["path"] = path
            captured["params"] = kwargs.get("params")
            return FakeResponse(content=b"hello\n")

        monkeypatch.setattr(provider, "_request", fake_request)
        assert provider.get_file_raw("group/web", "src/package.json", ref="main") == "hello\n"
        assert captured["path"] == (
            "/projects/group%2Fweb/repository/files/src%2Fpackage.json/raw"
        )
        assert captured["params"] == {"ref": "main"}

    def test_get_file_raw_binary_or_oversize_returns_none(self, monkeypatch):
        provider = make_provider()

        def fake_request(method, path, **kwargs):
            return FakeResponse(content=b"abc\x00def")

        monkeypatch.setattr(provider, "_request", fake_request)
        assert provider.get_file_raw("group/web", "a.bin") is None

        def fake_request_big(method, path, **kwargs):
            return FakeResponse(content=b"x" * 70000)

        monkeypatch.setattr(provider, "_request", fake_request_big)
        assert provider.get_file_raw("group/web", "big.txt") is None

    def test_get_file_raw_missing_returns_none(self, monkeypatch):
        provider = make_provider()

        def fake_request(method, path, **kwargs):
            raise NotFoundError("GitLab 资源不存在")

        monkeypatch.setattr(provider, "_request", fake_request)
        assert provider.get_file_raw("group/web", "missing.txt") is None

    def test_get_file_raw_auth_error_propagates(self, monkeypatch):
        provider = make_provider()

        def fake_request(method, path, **kwargs):
            raise AuthenticationError("GitLab Token 无效或已过期")

        monkeypatch.setattr(provider, "_request", fake_request)
        with pytest.raises(AuthenticationError):
            provider.get_file_raw("group/web", "a.txt")


class TestContainerProbe:
    """本地 Docker 镜像只读探测测试。"""

    def test_probe_command_is_readonly(self, monkeypatch):
        captured: dict = {}

        def fake_run(args, **kwargs):
            captured["args"] = args
            return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

        monkeypatch.setattr("apps.package.docker_local.shutil.which", lambda name: "/usr/bin/docker")
        monkeypatch.setattr("apps.package.docker_local.subprocess.run", fake_run)
        LocalDockerService.probe_image("web:latest")
        args = captured["args"]
        assert "run" in args and "--rm" in args
        assert "--pull=never" in args
        assert "--entrypoint" in args and "/bin/sh" in args
        assert "web:latest" in args
        assert "-v" not in args and "--volume" not in args and "-it" not in args
        assert IMAGE_PROBE_SH in args

    def test_probe_parse_output_and_caps(self):
        out = (
            "--- versions ---\nnode: v20.1.0\nnpm: 10.0.0\n"
            "--- workspace scripts ---\ntotal 4\n-rwxr-xr-x 1 root root 12 Jan  1 00:00 pack.sh\n"
            "--- pack.sh ---\necho build\n"
            "--- workspace deploy ---\ntotal 0\n"
            "--- pwd ---\n/workspace/source\n"
            "--- path ---\n/usr/local/bin:/usr/bin\n"
        )
        result = parse_probe_output(out)
        assert result["versions"] == "node: v20.1.0\nnpm: 10.0.0"
        assert result["pack_sh"] == "echo build"
        assert result["workdir"] == "/workspace/source"
        assert result["path"] == "/usr/local/bin:/usr/bin"

    def test_probe_missing_docker(self, monkeypatch):
        monkeypatch.setattr("apps.package.docker_local.shutil.which", lambda name: None)
        result, reason = LocalDockerService.probe_image("web:latest")
        assert result is None
        assert "未安装 docker CLI" in reason

    def test_probe_timeout_returns_none(self, monkeypatch):
        def fake_run(args, **kwargs):
            raise subprocess.TimeoutExpired(cmd=args, timeout=45)

        monkeypatch.setattr("apps.package.docker_local.shutil.which", lambda name: "/usr/bin/docker")
        monkeypatch.setattr("apps.package.docker_local.subprocess.run", fake_run)
        result, reason = LocalDockerService.probe_image("web:latest")
        assert result is None
        assert "超时" in reason

    def test_probe_failure_returns_reason(self, monkeypatch):
        def fake_run(args, **kwargs):
            return subprocess.CompletedProcess(
                args, 1, stdout="", stderr="docker: image not found"
            )

        monkeypatch.setattr("apps.package.docker_local.shutil.which", lambda name: "/usr/bin/docker")
        monkeypatch.setattr("apps.package.docker_local.subprocess.run", fake_run)
        result, reason = LocalDockerService.probe_image("missing:latest")
        assert result is None
        assert "镜像未在本机加载" in reason
        assert "missing:latest" in reason

    def test_probe_error_hides_help_hint(self, monkeypatch):
        """docker 帮助提示行不进入错误信息，取真实原因行。"""
        stderr = (
            "Unable to find image 'web:latest' locally\n"
            "docker: Error response from daemon: unexpected status from HEAD request "
            "to https://registry/v2/web/manifests/latest: 403 Forbidden\n"
            "Run 'docker run --help' for more information"
        )

        def fake_run(args, **kwargs):
            return subprocess.CompletedProcess(args, 1, stdout="", stderr=stderr)

        monkeypatch.setattr("apps.package.docker_local.shutil.which", lambda name: "/usr/bin/docker")
        monkeypatch.setattr("apps.package.docker_local.subprocess.run", fake_run)
        result, reason = LocalDockerService.probe_image("web:latest")
        assert result is None
        assert "run --help" not in reason
        assert "403 Forbidden" in reason
        assert "docker: Error response from daemon" in reason


class TestNodeProbe:
    """远程 Windows 节点只读工具探测测试。"""

    class FakeWindowsClient:
        captured: dict = {}

        def __init__(self, host, port, username, password, **kwargs):
            self.host = host

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def run(self, command, on_line=None):
            TestNodeProbe.FakeWindowsClient.captured["command"] = command
            lines = [
                "--- versions ---",
                "[dotnet]",
                "8.0.100",
                "[node]",
                "v20.1.0",
                "--- path ---",
                r"C:\tools;C:\Windows\System32",
            ]
            for line in lines:
                if on_line:
                    on_line(line)

    def test_probe_success(self, node_credential, monkeypatch):
        monkeypatch.setattr(
            "apps.package.remote_windows.RemoteWindowsClient",
            self.FakeWindowsClient,
        )
        result, reason = probe_node_tools("10.0.0.10", 22, str(node_credential.id))
        assert reason is None
        assert "8.0.100" in result["versions"]
        assert r"C:\tools" in result["path"]
        command = self.FakeWindowsClient.captured["command"]
        assert command == NODE_PROBE_CMD
        assert "where" in command

    def test_probe_missing_credential(self):
        result, reason = probe_node_tools(
            "10.0.0.10", 22, "00000000-0000-0000-0000-000000000000"
        )
        assert result is None
        assert "凭证不存在" in reason

    def test_probe_connection_error_degrades(self, node_credential, monkeypatch):
        def fail_connect(*args, **kwargs):
            raise RemoteNodeError("无法连接远程节点 10.0.0.10")

        monkeypatch.setattr(
            "apps.package.remote_windows.RemoteWindowsClient.connect", fail_connect
        )
        result, reason = probe_node_tools("10.0.0.10", 22, str(node_credential.id))
        assert result is None
        assert "节点工具探测失败" in reason

    def test_probe_timeout_returns_promptly(self, node_credential, monkeypatch):
        """超时后立即返回（不再等待后台线程），否则生成请求会长时间挂起。"""
        import time

        class FakePool:
            def __init__(self, *args, **kwargs):
                self.shutdown_called = False

            def submit(self, fn):
                return self

            def result(self, timeout=None):
                time.sleep(0.05)
                raise TimeoutError()

            def shutdown(self, wait=True, cancel_futures=False):
                self.shutdown_called = True

        monkeypatch.setattr("apps.package.remote_base.ThreadPoolExecutor", FakePool)
        start = time.monotonic()
        result, reason = probe_node_tools("10.0.0.10", 22, str(node_credential.id), timeout=1)
        assert result is None
        assert "超时" in reason
        assert time.monotonic() - start < 1.5


class TestAIStreamClient:
    """AI 流式客户端：非 200 关闭响应、整包缓冲回退非流式。"""

    class FakeResp:
        def __init__(self, status_code=200, lines=None):
            self.status_code = status_code
            self._lines = lines or []
            self.closed = False

        def iter_lines(self, decode_unicode=True):
            yield from self._lines

        def iter_content(self, chunk_size=256):
            yield b"boom"

        def close(self):
            self.closed = True

    def test_non_200_closes_response_and_raises(self, monkeypatch):
        resp = self.FakeResp(status_code=500)
        monkeypatch.setattr("utils.provider.ai.requests.post", lambda *a, **k: resp)
        with pytest.raises(AIClientError) as exc:
            call_ai_chat_stream("http://ai.local/v1", "key", "model")
        assert "500" in str(exc.value)
        assert resp.closed is True

    def test_stream_fallback_when_gateway_buffers(self, monkeypatch):
        """网关忽略 stream=true 整包返回普通 JSON 时，回退非流式调用。"""
        resp = self.FakeResp(
            lines=['{"choices": [{"delta": {"content": "x"}}]}']
        )
        monkeypatch.setattr("utils.provider.ai.requests.post", lambda *a, **k: resp)
        monkeypatch.setattr(
            "utils.provider.ai.call_ai_chat",
            lambda *a, **k: '{"script": "echo hi"}',
        )
        result = call_ai_chat_stream(
            "http://ai.local/v1", "key", "model", system="s", user="u"
        )
        assert result == '{"script": "echo hi"}'
        assert resp.closed is True

    def test_stream_sends_max_tokens(self, monkeypatch):
        captured: dict = {}

        class FakeResp:
            status_code = 200

            def iter_lines(self, decode_unicode=True):
                yield "data: [DONE]"

            def close(self):
                pass

        def fake_post(*args, **kwargs):
            captured["body"] = kwargs.get("json") or {}
            return FakeResp()

        monkeypatch.setattr("utils.provider.ai.requests.post", fake_post)
        monkeypatch.setattr(
            "utils.provider.ai.call_ai_chat",
            lambda *a, **k: "回退结果",
        )
        call_ai_chat_stream("http://ai.local/v1", "key", "model", max_tokens=8192)
        assert captured["body"]["max_tokens"] == 8192

    def test_truncated_reasoning_raises_actionable_error(self, monkeypatch):
        """finish_reason=length 且 content 为空时，给出调大 ai_max_tokens 的提示。"""

        class FakeResp:
            status_code = 200

            def json(self):
                return {
                    "choices": [
                        {
                            "message": {"role": "assistant", "content": ""},
                            "finish_reason": "length",
                        }
                    ]
                }

        monkeypatch.setattr("utils.provider.ai.requests.post", lambda *a, **k: FakeResp())
        with pytest.raises(AIClientError) as exc:
            call_ai_chat("http://ai.local/v1", "key", "model")
        assert "调大 ai_max_tokens" in str(exc.value)


class TestPromptAndParse:
    """prompt 组装、JSON 解析与结果归一化测试。"""

    def test_prompt_limits_defaults(self):
        limits = PackageScriptAIService._prompt_limits()
        assert limits["manifest_chars"] == 32 * 1024
        assert limits["tree_chars"] == 15000
        assert limits["knowledge_chars"] == 12000
        assert limits["exemplar_chars"] == 12000

    def test_prompt_limits_configurable(self):
        SystemConfig.objects.create(key="ai_manifest_chars", value="10000", is_public=False)
        SystemConfig.objects.create(key="ai_tree_chars", value="8000", is_public=False)
        limits = PackageScriptAIService._prompt_limits()
        assert limits["manifest_chars"] == 10000
        assert limits["tree_chars"] == 8000
        assert limits["knowledge_chars"] == 12000

    def test_ai_config_max_tokens_default_and_override(self):
        ai = PackageScriptAIService._ai_config()
        assert ai["max_tokens"] == 16384
        SystemConfig.objects.update_or_create(
            key="ai_max_tokens", defaults={"value": "4096", "is_public": False}
        )
        assert PackageScriptAIService._ai_config()["max_tokens"] == 4096
        SystemConfig.objects.update_or_create(
            key="ai_max_tokens", defaults={"value": "1", "is_public": False}
        )
        assert PackageScriptAIService._ai_config()["max_tokens"] == 512

    def test_env_masking(self):
        masked = PackageScriptAIService._mask_env(
            {"DEPLOY_TOKEN": "secret-123", "NODE_ENV": "production", "FLAG": "x" * 500}
        )
        text = " ".join(masked)
        assert "secret-123" not in text
        assert "******" in text
        assert "production" in text
        # 普通值截断到 200 字符
        assert "x" * 300 not in text

    def test_prompt_contains_no_secrets(self):
        normalized = PackageScriptAIService._normalize_payload(
            {
                "project": "p1",
                "repository": "r1",
                "executor_type": "local_docker",
                "image_ref": "web:latest",
                "env_vars": {"NPM_TOKEN": "supersecret", "NODE_ENV": "production"},
            }
        )
        system, user = PackageScriptAIService._build_prompt(
            normalized, {"script_entry": "/workspace/scripts/pack.sh"}, {"tree": "a.txt", "files": {}}, None
        )
        assert "supersecret" not in user and "supersecret" not in system
        assert "******" in user
        assert "web:latest" in user
        assert "/workspace/scripts/pack.sh" in user
        assert "$ARTIFACTS_DIR" in user

    def test_prompt_includes_knowledge(self):
        normalized = PackageScriptAIService._normalize_payload(
            {"project": "p1", "repository": "r1"}
        )
        system, user = PackageScriptAIService._build_prompt(
            normalized,
            {},
            {},
            None,
            None,
            [{"title": "公司规范", "content": "npm 源必须使用内网镜像"}],
        )
        assert "通用打包知识库" in user
        assert "公司规范" in user
        assert "npm 源必须使用内网镜像" in user

    def test_remote_windows_prompt_uses_bat(self):
        normalized = PackageScriptAIService._normalize_payload(
            {"project": "p1", "repository": "r1", "executor_type": "remote_node"}
        )
        system, user = PackageScriptAIService._build_prompt(
            normalized,
            {},
            {},
            None,
            {"versions": "[dotnet]\n8.0.100", "path": r"C:\tools"},
        )
        assert "pack-custom.bat" in user
        assert "%ARTIFACTS_DIR%" in user
        assert "$ARTIFACTS_DIR" not in user
        assert "节点工具探测结果" in user
        assert "8.0.100" in user
        assert "未探测到的工具不得假定存在" in user

    def test_extract_json_variants(self):
        plain = PackageScriptAIService._extract_json('{"script": "echo hi"}')
        assert plain["script"] == "echo hi"
        fenced = PackageScriptAIService._extract_json(
            '```json\n{"script": "echo hi"}\n```'
        )
        assert fenced["script"] == "echo hi"
        embedded = PackageScriptAIService._extract_json(
            '好的，以下是脚本：{"script": "echo hi"} 请查收'
        )
        assert embedded["script"] == "echo hi"
        with pytest.raises(ValueError):
            PackageScriptAIService._extract_json("不是 JSON")

    def test_normalize_result_drops_invalid_explanations(self):
        result = PackageScriptAIService._normalize_result(
            {
                "script": "echo a\necho b",
                "summary": "简单脚本",
                "explanations": [
                    {"line": 1, "reason": "输出 a"},
                    {"line": 99, "reason": "越界"},
                    {"line": "bad", "reason": "非法"},
                    {"line": 2, "reason": ""},
                ],
            }
        )
        assert len(result["explanations"]) == 1
        assert result["explanations"][0] == {"line": 1, "reason": "输出 a"}
        with pytest.raises(ValueError):
            PackageScriptAIService._normalize_result({"explanations": []})

    def test_select_manifest_files_prefers_exact_then_suffix(self):
        tree = [
            {"path": "src/a.csproj", "type": "blob", "name": "a.csproj"},
            {"path": "src/b.csproj", "type": "blob", "name": "b.csproj"},
            {"path": "src/c.csproj", "type": "blob", "name": "c.csproj"},
            {"path": "package.json", "type": "blob", "name": "package.json"},
            {"path": "README.md", "type": "blob", "name": "README.md"},
        ]
        selected = PackageScriptAIService._select_manifest_files(tree)
        assert selected[0] == "package.json"
        assert selected[1] == "README.md"
        # .csproj 最多取前 2 个
        assert selected.count("src/a.csproj") + selected.count("src/b.csproj") == 2
        assert "src/c.csproj" not in selected


class TestScanRepo:
    """仓库上下文扫描测试（使用假 provider）。"""

    def test_scan_repo_success(self, repository, admin_user, monkeypatch):
        class FakeProvider:
            def list_tree(self, repo_identity, ref="", recursive=True):
                return [
                    {"path": "package.json", "type": "blob", "name": "package.json"},
                    {"path": "README.md", "type": "blob", "name": "README.md"},
                    {"path": "src", "type": "tree", "name": "src"},
                ]

            def get_file_raw(self, repo_identity, file_path, ref=""):
                return '{"name": "web"}' if file_path == "package.json" else "# readme"

        monkeypatch.setattr(
            "apps.package.ai.resolve_credential", lambda repo, user=None: {"token": "t"}
        )
        monkeypatch.setattr("apps.package.ai.get_provider", lambda *a, **k: FakeProvider())
        context, warning = PackageScriptAIService._scan_repo(repository, admin_user)
        assert warning is None
        assert "package.json" in context["tree"]
        assert context["files"]["package.json"] == '{"name": "web"}'

    def test_scan_repo_failure_degrades(self, repository, admin_user, monkeypatch):
        def boom(*args, **kwargs):
            raise ProviderError("仓库不可访问")

        monkeypatch.setattr("apps.package.ai.resolve_credential", boom)
        context, warning = PackageScriptAIService._scan_repo(repository, admin_user)
        assert context == {}
        assert "仓库扫描失败" in warning


class TestGenerateService:
    """PackageScriptAIService.generate 主流程测试。"""

    def _payload(self, repository, executor_type="local_docker", image_ref="web:latest", **extra):
        data = {
            "project": str(repository.project_id),
            "repository": str(repository.id),
            "executor_type": executor_type,
            "image_ref": image_ref,
            "build_path": ".",
            "output_path": "dist",
        }
        data.update(extra)
        return data

    def test_generate_success(self, admin_user, repository, ai_config, monkeypatch):
        monkeypatch.setattr(
            "apps.package.ai.call_ai_chat",
            lambda *a, **k: (
                '{"summary": "npm 构建", "script": "npm ci\\nnpm run build", '
                '"explanations": [{"line": 1, "reason": "安装依赖"}]}'
            ),
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_scan_repo",
            lambda *a, **k: ({"tree": "package.json", "files": {}}, None),
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_container",
            lambda ref: ({"versions": "node: v20"}, None),
        )

        def fail_node_probe(node_id):
            raise AssertionError("本地 Docker 不应执行节点探测")

        monkeypatch.setattr(PackageScriptAIService, "_probe_node", fail_node_probe)
        result = PackageScriptAIService.generate(self._payload(repository), admin_user)
        assert result["script"] == "npm ci\nnpm run build"
        assert result["explanations"][0]["reason"] == "安装依赖"
        assert result["model"] == "deepseek-chat"
        assert result["repo_scanned"] is True
        assert result["container_probed"] is True
        assert result["node_probed"] is False
        assert "repo_scan_warning" not in result
        assert OperationLog.objects.filter(action="AI生成打包脚本", result="success").count() == 1

    def test_generate_remote_windows_skips_probe(self, admin_user, repository, ai_config, monkeypatch):
        monkeypatch.setattr(
            "apps.package.ai.call_ai_chat",
            lambda *a, **k: '{"script": "echo hi", "explanations": []}',
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_scan_repo",
            lambda *a, **k: ({}, "仓库扫描失败：无凭证"),
        )

        def fail_probe(ref):
            raise AssertionError("远程 Windows 不应执行容器探测")

        monkeypatch.setattr(PackageScriptAIService, "_probe_container", fail_probe)
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_node",
            lambda node_id: ({"versions": "[dotnet]\n8.0.100"}, None),
        )
        result = PackageScriptAIService.generate(
            self._payload(
                repository, executor_type="remote_node", image_ref="", node="node-1"
            ),
            admin_user,
        )
        assert result["container_probed"] is False
        assert result["node_probed"] is True
        assert "node_probe_warning" not in result
        assert result["repo_scanned"] is False
        assert "仓库扫描失败" in result["repo_scan_warning"]

    def test_generate_remote_node_probe_failure_degrades(
        self, admin_user, repository, ai_config, monkeypatch
    ):
        monkeypatch.setattr(
            "apps.package.ai.call_ai_chat",
            lambda *a, **k: '{"script": "echo hi", "explanations": []}',
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_scan_repo",
            lambda *a, **k: ({"tree": "a.txt", "files": {}}, None),
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_node",
            lambda node_id: (None, "节点工具探测超时（超过 30 秒）"),
        )
        result = PackageScriptAIService.generate(
            self._payload(
                repository, executor_type="remote_node", image_ref="", node="node-1"
            ),
            admin_user,
        )
        assert result["node_probed"] is False
        assert "节点工具探测超时" in result["node_probe_warning"]
        assert result["script"] == "echo hi"

    def test_generate_missing_ai_config(self, admin_user, repository):
        with pytest.raises(PackageScriptAIError) as exc:
            PackageScriptAIService.generate(self._payload(repository), admin_user)
        assert exc.value.code == 40000
        assert "AI 服务未配置" in str(exc.value)

    def test_generate_repository_not_in_project(self, admin_user, repository):
        other = Project.objects.create(name="其他项目", code="OTH", leader=admin_user, status=1)
        other_repo = Repository.objects.create(
            project=other,
            repo_type="git",
            vendor="gitlab",
            name="other",
            url="https://gitlab.example.com",
            external_identity="group/other",
        )
        for key, value, _ in [
            ("ai_endpoint", "http://ai.local/v1", "AI 服务地址"),
            ("ai_api_key", "k", "AI 密钥"),
        ]:
            SystemConfig.objects.create(key=key, value=value, is_public=False)
        with pytest.raises(PackageScriptAIError) as exc:
            data = self._payload(repository)
            data["repository"] = str(other_repo.id)
            PackageScriptAIService.generate(data, admin_user)
        assert exc.value.code == 40000
        assert "不属于该项目" in str(exc.value)

    def test_generate_retries_then_fails_on_bad_json(self, admin_user, repository, ai_config, monkeypatch):
        calls = {"n": 0}

        def bad_json(*a, **k):
            calls["n"] += 1
            return "这不是 JSON"

        monkeypatch.setattr("apps.package.ai.call_ai_chat", bad_json)
        monkeypatch.setattr(
            PackageScriptAIService, "_scan_repo",
            lambda *a, **k: ({}, None),
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_container",
            lambda ref: (None, "镜像探测失败"),
        )
        with pytest.raises(PackageScriptAIError) as exc:
            PackageScriptAIService.generate(self._payload(repository), admin_user)
        assert exc.value.code == 50200
        assert calls["n"] == 2

    def test_generate_exemplars_off(self, admin_user, repository, ai_config, monkeypatch):
        captured: dict = {}

        def fake_ai(*args, **kwargs):
            captured["user"] = kwargs.get("user", "")
            return '{"script": "echo hi", "explanations": []}'

        monkeypatch.setattr("apps.package.ai.call_ai_chat", fake_ai)
        monkeypatch.setattr(
            PackageScriptAIService, "_scan_repo",
            lambda *a, **k: ({}, None),
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_container", lambda ref: (None, None)
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_node", lambda node_id: (None, None)
        )
        result = PackageScriptAIService.generate(
            {**self._payload(repository), "reference_exemplars": False}, admin_user
        )
        assert "历史成功脚本参考" not in captured["user"]
        assert result["referenced_scripts"] == []

    def test_generate_exemplars_on_with_sources(
        self, admin_user, repository, ai_config, monkeypatch
    ):
        captured: dict = {}

        def fake_ai(*args, **kwargs):
            captured["user"] = kwargs.get("user", "")
            return '{"script": "echo hi", "explanations": []}'

        monkeypatch.setattr("apps.package.ai.call_ai_chat", fake_ai)
        monkeypatch.setattr(
            PackageScriptAIService, "_scan_repo",
            lambda *a, **k: ({}, None),
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_container", lambda ref: (None, None)
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_node", lambda node_id: (None, None)
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_load_exemplar_scripts",
            lambda *args, **kwargs: [
                {
                    "project_name": "AI 打包项目",
                    "repository_name": "web",
                    "executor_type": "local_docker",
                    "version": "V1.0.0",
                    "success_count": 2,
                    "script": "npm ci && npm run build",
                }
            ],
        )
        result = PackageScriptAIService.generate(self._payload(repository), admin_user)
        assert "历史成功脚本参考" in captured["user"]
        assert "AI 打包项目" in captured["user"]
        assert "成功 2 次" in captured["user"]
        assert result["referenced_scripts"] == [
            {
                "project_name": "AI 打包项目",
                "repository_name": "web",
                "executor_type": "local_docker",
                "version": "V1.0.0",
                "success_count": 2,
            }
        ]
        log = OperationLog.objects.get(action="AI生成打包脚本", result="success")
        assert log.detail.get("exemplar_count") == 1

    def test_generate_exemplars_default_on(
        self, admin_user, repository, ai_config, monkeypatch
    ):
        called = {"n": 0}

        def fake_load(*args, **kwargs):
            called["n"] += 1
            return []

        monkeypatch.setattr(
            "apps.package.ai.call_ai_chat",
            lambda *a, **k: '{"script": "echo hi", "explanations": []}',
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_scan_repo",
            lambda *a, **k: ({}, None),
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_container", lambda ref: (None, None)
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_node", lambda node_id: (None, None)
        )
        monkeypatch.setattr(PackageScriptAIService, "_load_exemplar_scripts", fake_load)
        PackageScriptAIService.generate(self._payload(repository), admin_user)
        assert called["n"] == 1

    def test_generate_stream_invokes_on_chunk(
        self, admin_user, repository, ai_config, monkeypatch
    ):
        chunks: list[str] = []

        def fake_stream(*args, **kwargs):
            on_chunk = kwargs.get("on_chunk")
            if on_chunk:
                on_chunk('{"script": "ech')
                on_chunk('o hi", "explanations": []}')
            return '{"script": "echo hi", "explanations": []}'

        monkeypatch.setattr("apps.package.ai.call_ai_chat_stream", fake_stream)
        monkeypatch.setattr(
            PackageScriptAIService, "_scan_repo", lambda *a, **k: ({}, None)
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_container", lambda ref: (None, None)
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_node", lambda node_id: (None, None)
        )
        result = PackageScriptAIService.generate(
            self._payload(repository), admin_user, on_chunk=chunks.append
        )
        assert chunks == ['{"script": "ech', 'o hi", "explanations": []}']
        assert result["script"] == "echo hi"

    def test_generate_logs_prompt_chars(
        self, admin_user, repository, ai_config, monkeypatch
    ):
        monkeypatch.setattr(
            "apps.package.ai.call_ai_chat",
            lambda *a, **k: '{"script": "echo hi", "explanations": []}',
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_scan_repo", lambda *a, **k: ({}, None)
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_container", lambda ref: (None, None)
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_node", lambda node_id: (None, None)
        )
        PackageScriptAIService.generate(self._payload(repository), admin_user)
        log = OperationLog.objects.get(action="AI生成打包脚本", result="success")
        assert log.detail["prompt_chars"] > 0
        assert log.detail["prompt_tokens_est"] == log.detail["prompt_chars"] // 3
        assert log.detail["stream_used"] is False
        assert log.detail["raw_chars"] > 0
        assert log.detail["parse_retries"] == 0

    def test_generate_no_retry_on_long_prompt(
        self, admin_user, repository, ai_config, monkeypatch
    ):
        calls = {"n": 0}

        def bad_json(*args, **kwargs):
            calls["n"] += 1
            return "不是 JSON"

        monkeypatch.setattr("apps.package.ai.call_ai_chat", bad_json)
        monkeypatch.setattr(
            PackageScriptAIService, "_scan_repo", lambda *a, **k: ({}, None)
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_container", lambda ref: (None, None)
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_node", lambda node_id: (None, None)
        )
        # 人为调低重试阈值，模拟“超大 prompt”场景：只请求一次，不重发
        monkeypatch.setattr("apps.package.ai.AI_RETRY_MAX_PROMPT_CHARS", 10)
        with pytest.raises(PackageScriptAIError) as exc:
            PackageScriptAIService.generate(self._payload(repository), admin_user)
        assert exc.value.code == 50200
        assert calls["n"] == 1


class TestKnowledge:
    """通用打包知识库：上下文加载与注入。"""

    def test_load_knowledge_active_only(self, admin_user):
        PackageKnowledge.objects.create(
            title="规范1", content="产物必须输出到 ARTIFACTS_DIR", is_active=True,
            created_by=admin_user,
        )
        PackageKnowledge.objects.create(
            title="规范2", content="停用内容", is_active=False, created_by=admin_user,
        )
        knowledge = PackageScriptAIService._load_knowledge()
        assert len(knowledge) == 1
        assert knowledge[0]["title"] == "规范1"

    def test_load_knowledge_caps_total(self, admin_user):
        for i in range(12):
            PackageKnowledge.objects.create(
                title=f"知识{i}", content="x" * 2000, is_active=True, created_by=admin_user,
            )
        knowledge = PackageScriptAIService._load_knowledge()
        assert len(knowledge) <= MAX_KNOWLEDGE_ENTRIES
        assert sum(len(item["content"]) for item in knowledge) <= 12000

    def test_generate_includes_knowledge_context(
        self, admin_user, repository, ai_config, monkeypatch
    ):
        PackageKnowledge.objects.create(
            title="公司规范", content="npm 源必须使用内网镜像", is_active=True,
            created_by=admin_user,
        )
        PackageKnowledge.objects.create(
            title="停用条目", content="不应出现在 prompt", is_active=False,
            created_by=admin_user,
        )
        captured: dict = {}

        def fake_ai(*args, **kwargs):
            captured["user"] = kwargs.get("user", "")
            return '{"script": "npm run build", "explanations": []}'

        monkeypatch.setattr("apps.package.ai.call_ai_chat", fake_ai)
        monkeypatch.setattr(
            PackageScriptAIService, "_scan_repo",
            lambda *a, **k: ({}, None),
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_container",
            lambda ref: (None, None),
        )
        monkeypatch.setattr(
            PackageScriptAIService, "_probe_node",
            lambda node_id: (None, None),
        )
        result = PackageScriptAIService.generate(
            {
                "project": str(repository.project_id),
                "repository": str(repository.id),
                "executor_type": "local_docker",
            },
            admin_user,
        )
        assert result["script"] == "npm run build"
        assert "公司规范" in captured["user"]
        assert "npm 源必须使用内网镜像" in captured["user"]
        assert "不应出现在 prompt" not in captured["user"]


class TestExemplars:
    """历史成功脚本参考：选择、排序、封顶与脱敏。"""

    def test_success_only_and_skip_empty(self, project, repository, release):
        make_package_task(project, repository, release, "echo ok", status="success")
        make_package_task(project, repository, release, "echo fail", status="failure")
        make_package_task(project, repository, release, "", status="success")
        exemplars = PackageScriptAIService._load_exemplar_scripts(
            str(project.id), str(repository.id), "local_docker"
        )
        assert len(exemplars) == 1
        assert exemplars[0]["script"] == "echo ok"

    def test_dedupe_and_success_count(self, project, repository, release):
        make_package_task(project, repository, release, "echo ok", version="V1.0.0")
        make_package_task(project, repository, release, "echo ok", version="V2.0.0")
        make_package_task(project, repository, release, "echo other", version="V1.0.0")
        exemplars = PackageScriptAIService._load_exemplar_scripts(
            str(project.id), str(repository.id), "local_docker"
        )
        by_script = {item["script"]: item for item in exemplars}
        assert by_script["echo ok"]["success_count"] == 2
        assert by_script["echo other"]["success_count"] == 1

    def test_dedupe_fallback_without_config_id(self, project, repository, release):
        """快照与任务都没有 config 标识时按任务区分，不误合并。"""
        make_package_task(project, repository, release, "echo ok", config_id="")
        make_package_task(project, repository, release, "echo ok", config_id="")
        exemplars = PackageScriptAIService._load_exemplar_scripts(
            str(project.id), str(repository.id), "local_docker"
        )
        assert len(exemplars) == 2
        assert all(item["script"] == "echo ok" for item in exemplars)

    def test_relevance_ordering(self, project, repository, release, admin_user):
        other_project = Project.objects.create(
            name="其他项目", code="OTHX", leader=admin_user, status=1
        )
        other_repo = Repository.objects.create(
            project=other_project,
            repo_type="git",
            vendor="gitlab",
            name="other-web",
            url="https://gitlab.example.com",
            external_identity="group/other-web",
        )
        other_release = ReleaseRecord.objects.create(
            project=other_project,
            repository=other_repo,
            version="V1.0.0",
            tag_name="V1.0.0",
            branch="main",
            release_type="formal",
            status="released",
            publisher=admin_user,
        )
        # 同项目同仓库：评分最高
        make_package_task(project, repository, release, "echo same-project")
        # 同仓库不同项目：次之
        make_package_task(
            other_project, repository, other_release, "echo same-repo",
            config_id="cfg-same-repo",
        )
        # 不同项目不同仓库：最后
        make_package_task(
            other_project, other_repo, other_release, "echo other",
            config_id="cfg-other",
        )
        exemplars = PackageScriptAIService._load_exemplar_scripts(
            str(project.id), str(repository.id), "local_docker"
        )
        assert [item["script"] for item in exemplars] == [
            "echo same-project",
            "echo same-repo",
            "echo other",
        ]

    def test_cap_limit_and_total_chars(self, project, repository, release):
        for i in range(5):
            make_package_task(
                project, repository, release, f"echo script-{i}",
                version=f"V{i}.0.0", config_id=f"cfg-{i}",
            )
        exemplars = PackageScriptAIService._load_exemplar_scripts(
            str(project.id), str(repository.id), "local_docker", limit=2
        )
        assert len(exemplars) == 2
        long = "x" * 5000
        make_package_task(project, repository, release, long, config_id="cfg-long")
        exemplars = PackageScriptAIService._load_exemplar_scripts(
            str(project.id), str(repository.id), "local_docker", limit=3, max_chars=6000
        )
        assert sum(len(item["script"]) for item in exemplars) <= 6000

    def test_no_success_tasks_returns_empty(self, project, repository, release):
        make_package_task(project, repository, release, "echo fail", status="failure")
        assert PackageScriptAIService._load_exemplar_scripts(
            str(project.id), str(repository.id), "local_docker"
        ) == []

    def test_scrub_credentials(self):
        script = (
            "export NPM_TOKEN=abc123\n"
            "echo TOKEN=xyz\n"
            "git clone https://user:pass@host/repo.git"
        )
        scrubbed = PackageScriptAIService._scrub_exemplar_script(script)
        assert "abc123" not in scrubbed
        assert "xyz" not in scrubbed
        assert "user:pass@" not in scrubbed
        assert "https://******@host/repo.git" in scrubbed
        assert "******" in scrubbed


class TestView:
    """ai-generate-script 视图接口测试。"""

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def test_permission_denied_for_developer(self, project, repository, developer_user):
        ProjectMember.objects.create(project=project, user=developer_user, role="developer")
        client = self._client(developer_user)
        resp = client.post(
            "/api/packages/configs/ai-generate-script/",
            {"project": str(project.id), "repository": str(repository.id)},
            format="json",
        )
        assert resp.status_code == 403

    def test_missing_ai_config_returns_400(self, project, repository, admin_user):
        client = self._client(admin_user)
        resp = client.post(
            "/api/packages/configs/ai-generate-script/",
            {"project": str(project.id), "repository": str(repository.id)},
            format="json",
        )
        assert resp.status_code == 400
        assert "AI 服务未配置" in resp.json()["message"]

    def test_success(self, project, repository, admin_user, monkeypatch):
        expected = {
            "script": "npm run build",
            "explanations": [{"line": 1, "reason": "构建"}],
            "summary": "构建脚本",
            "model": "deepseek-chat",
            "repo_scanned": True,
            "container_probed": True,
            "node_probed": False,
        }
        monkeypatch.setattr(
            "apps.package.views.PackageScriptAIService.generate",
            lambda payload, user=None: expected,
        )
        client = self._client(admin_user)
        resp = client.post(
            "/api/packages/configs/ai-generate-script/",
            {"project": str(project.id), "repository": str(repository.id)},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["script"] == "npm run build"
        assert resp.json()["data"]["explanations"][0]["line"] == 1

    def test_upstream_error_maps_to_502(self, project, repository, admin_user, monkeypatch):
        def fail(payload, user=None):
            raise PackageScriptAIError("AI 服务返回异常状态 500", 50200)

        monkeypatch.setattr("apps.package.views.PackageScriptAIService.generate", fail)
        client = self._client(admin_user)
        resp = client.post(
            "/api/packages/configs/ai-generate-script/",
            {"project": str(project.id), "repository": str(repository.id)},
            format="json",
        )
        assert resp.status_code == 502
        assert resp.json()["code"] == 50200
        assert OperationLog.objects.filter(
            action="AI生成打包脚本", result="failure"
        ).count() == 1

    def test_knowledge_write_requires_system_config_permission(
        self, project, developer_user
    ):
        client = self._client(developer_user)
        resp = client.post(
            "/api/packages/knowledge/",
            {"title": "规范", "content": "内容"},
            format="json",
        )
        assert resp.status_code == 403

    def test_knowledge_crud(self):
        super_admin = User.objects.create_superuser(
            username="kb_super", password="pass", nickname="知识库超管"
        )
        client = self._client(super_admin)
        resp = client.post(
            "/api/packages/knowledge/",
            {"title": "规范", "content": "npm 源使用内网镜像", "is_active": True},
            format="json",
        )
        assert resp.status_code in (200, 201)
        data = resp.json()["data"]
        assert data["created_by_name"] == "知识库超管"
        kid = data["id"]

        resp = client.get("/api/packages/knowledge/")
        assert resp.status_code == 200
        assert resp.json()["data"]["total"] == 1

        resp = client.patch(
            f"/api/packages/knowledge/{kid}/", {"is_active": False}, format="json"
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["is_active"] is False

        resp = client.delete(f"/api/packages/knowledge/{kid}/")
        assert resp.status_code in (200, 204)

    def test_throttled_on_recent_generation(
        self, project, repository, admin_user, monkeypatch
    ):
        from django.core.cache import cache

        cache.clear()
        monkeypatch.setattr(
            "apps.package.views.PackageScriptAIService.generate",
            lambda payload, user=None: {
                "script": "echo hi",
                "explanations": [],
                "referenced_scripts": [],
            },
        )
        client = self._client(admin_user)
        payload = {"project": str(project.id), "repository": str(repository.id)}
        first = client.post(
            "/api/packages/configs/ai-generate-script/", payload, format="json"
        )
        second = client.post(
            "/api/packages/configs/ai-generate-script/", payload, format="json"
        )
        assert first.status_code == 200
        assert second.status_code == 429
        assert second.json()["code"] == 42900

    def test_stream_endpoint_deltas_and_done(
        self, project, repository, admin_user, monkeypatch
    ):
        from django.core.cache import cache

        cache.clear()

        def fake_generate(payload, user=None, on_chunk=None, on_progress=None):
            if on_progress:
                on_progress("上下文准备完成，AI 开始生成…")
            if on_chunk:
                on_chunk('{"script": "echo')
                on_chunk(' hi", "explanations": []}')
            return {"script": "echo hi", "explanations": [], "referenced_scripts": []}

        monkeypatch.setattr(
            "apps.package.views.PackageScriptAIService.generate", fake_generate
        )
        client = self._client(admin_user)
        resp = client.post(
            "/api/packages/configs/ai-generate-script-stream/",
            {"project": str(project.id), "repository": str(repository.id)},
            format="json",
        )
        assert resp.status_code == 200
        content = b"".join(resp.streaming_content).decode("utf-8")
        assert '"type": "progress"' in content
        assert '"type": "delta"' in content
        assert '"type": "done"' in content
        assert '"script": "echo hi"' in content
