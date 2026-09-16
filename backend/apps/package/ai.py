"""
打包脚本 AI 生成服务

汇总打包配置上下文、平台执行约定、GitLab 仓库清单与本地 Docker 镜像探测结果，
调用可配置的 LLM（OpenAI / Anthropic 兼容协议）生成打包脚本草稿 + 逐行解释。
生成结果只是草稿，由前端用户确认后才写回配置，本服务不执行、不保存脚本。
"""
import json
import logging
import re

from rest_framework.exceptions import ValidationError

from apps.package.docker_local import LocalDockerService
from apps.package.models import PackageImage, PackageKnowledge, PackageNode, PackageTask
from apps.package.remote_windows import probe_node_tools
from apps.package.serializers import validate_safe_rel_path
from apps.project.models import ProductComponent, Project
from apps.repository.models import Repository
from apps.repository.services import RepositoryService
from apps.system.services import OperationLogService, SystemConfigService
from utils.provider.ai import AIClientError, call_ai_chat, call_ai_chat_stream
from utils.provider.credential_resolver import resolve_credential
from utils.provider.exceptions import ProviderError
from utils.provider.factory import get_provider

logger = logging.getLogger(__name__)

AI_CONFIG_KEYS = ["ai_endpoint", "ai_api_key", "ai_model", "ai_protocol"]
AI_OUTPUT_TOKEN_KEY = "ai_max_tokens"
# AI prompt 体积上限配置键（系统配置页 AI 服务卡片维护，默认值见 _prompt_limits）
AI_PROMPT_CONFIG_KEYS = [
    "ai_manifest_chars",
    "ai_tree_chars",
    "ai_knowledge_chars",
    "ai_exemplar_chars",
]
DEFAULT_AI_MODEL = "deepseek-v4-flash"
DEFAULT_AI_PROTOCOL = "auto"
# 输出上限默认值：deepseek-v4-flash 为推理模型，推理会消耗大量输出 token，
# 8192 在复杂打包任务下容易被推理耗尽导致 content 为空；默认提高到 16384
DEFAULT_AI_MAX_TOKENS = 16384
# 解析失败重试仅对短 prompt 生效，避免超大 prompt 重复发送拖慢/翻倍成本
AI_RETRY_MAX_PROMPT_CHARS = 40000

# 与打包执行日志脱敏规则一致：键名含敏感关键字时值不进 prompt
SECRET_ENV_RE = re.compile(r"(TOKEN|PASSWORD|PASSWD|SECRET|KEY|CREDENTIAL|AUTH)", re.IGNORECASE)

# 需要进入 AI 上下文的仓库清单文件（精确文件名 / 后缀规则）
MANIFEST_EXACT_NAMES = {
    "package.json", "pom.xml", "build.gradle", "build.gradle.kts",
    "settings.gradle", "settings.gradle.kts", "requirements.txt",
    "pyproject.toml", "Dockerfile", "README.md", "Makefile", "go.mod",
    "Cargo.toml", "composer.json", "Gemfile", "global.json",
    "Directory.Build.props", ".nvmrc", ".node-version", "pack.bat", "pack.sh",
}
# 精确名单内的优先级（越小越优先进入上下文），未列出的默认 100
MANIFEST_EXACT_PRIORITY = {
    "package.json": 0,
    "pom.xml": 1,
    "build.gradle": 2,
    "build.gradle.kts": 2,
    "requirements.txt": 3,
    "pyproject.toml": 3,
    "Dockerfile": 4,
    "pack.bat": 5,
    "pack.sh": 5,
    "README.md": 10,
}
MANIFEST_SUFFIX_RULES = [
    (".csproj", 2),
    (".sln", 1),
    (".vite.config.ts", 1),
    (".vite.config.js", 1),
    (".vite.config.mjs", 1),
    (".vite.config.cjs", 1),
    (".webpack.config.js", 1),
    (".webpack.config.ts", 1),
]

MAX_TREE_ENTRIES = 300
MAX_MANIFEST_FILES = 12
MAX_MANIFEST_FILE_CHARS = 32 * 1024
MAX_HINT_LENGTH = 2000
MAX_SCRIPT_PREVIEW_CHARS = 8000
MAX_KNOWLEDGE_ENTRIES = 10
MAX_KNOWLEDGE_ENTRY_CHARS = 3000
# 历史成功脚本参考上限
MAX_EXEMPLAR_SCRIPTS = 3
MAX_EXEMPLAR_SCRIPT_CHARS = 8000
MAX_EXEMPLAR_TOTAL_CHARS = 12000
MAX_EXEMPLAR_CANDIDATE_TASKS = 200
# 历史脚本中常见明文凭据脱敏
EXEMPLAR_SECRET_RE = re.compile(
    r"((?:PASSWORD|PASSWD|TOKEN|SECRET|API[_-]?KEY|ACCESS[_-]?KEY)\s*=\s*)[^\s\"']+",
    re.IGNORECASE,
)
EXEMPLAR_URL_CRED_RE = re.compile(r"(https?://)[^/@\s]+:[^/@\s]+@")

# 平台注入的打包环境变量（名称 + 中文含义），与 ScriptEditorField 插入变量保持一致
ENV_VARIABLE_TABLE = [
    ("VERSION", "版本号"),
    ("TAG_NAME", "Tag 名称"),
    ("PROJECT_CODE", "项目编码"),
    ("BUILD_PATH", "构建目录（相对源码根）"),
    ("OUTPUT_PATH", "产物目录名"),
    ("WORKSPACE", "任务工作区根目录"),
    ("SOURCE_DIR", "源码目录"),
    ("ARTIFACTS_DIR", "产物输出目录"),
    ("RELEASE_DOC_PATH", "发布说明 Markdown 路径"),
    ("DEPLOY_DIR", "预制依赖目录（镜像提供）"),
    ("SCRIPTS_DIR", "脚本目录（镜像提供）"),
    ("TMPDIR", "临时目录"),
]


class PackageScriptAIError(RuntimeError):
    """打包脚本 AI 生成业务错误，code 为统一业务错误码。"""

    def __init__(self, message: str, code: int = 40000):
        super().__init__(message)
        self.code = code


class PackageScriptAIService:
    """打包脚本 AI 生成服务。"""

    @staticmethod
    def _ai_config() -> dict:
        """读取系统配置中的 AI 服务参数（ai_* 键）。"""
        values = SystemConfigService.get_many(AI_CONFIG_KEYS)
        endpoint = (values.get("ai_endpoint") or "").strip()
        api_key = (values.get("ai_api_key") or "").strip()
        model = (values.get("ai_model") or "").strip() or DEFAULT_AI_MODEL
        protocol = (values.get("ai_protocol") or "").strip() or DEFAULT_AI_PROTOCOL
        if protocol not in ("auto", "openai", "anthropic"):
            protocol = DEFAULT_AI_PROTOCOL
        try:
            max_tokens = int(
                SystemConfigService.get(AI_OUTPUT_TOKEN_KEY, DEFAULT_AI_MAX_TOKENS)
            )
        except (TypeError, ValueError):
            max_tokens = DEFAULT_AI_MAX_TOKENS
        max_tokens = max(512, min(32768, max_tokens))
        return {
            "endpoint": endpoint,
            "api_key": api_key,
            "model": model,
            "protocol": protocol,
            "max_tokens": max_tokens,
        }

    @staticmethod
    def _normalize_payload(payload: dict) -> dict:
        """校验并归一化 AI 生成请求参数。"""
        project_id = str(payload.get("project") or "").strip()
        repository_id = str(payload.get("repository") or "").strip()
        if not project_id or not repository_id:
            raise PackageScriptAIError("必须指定项目与关联仓库")
        executor_type = payload.get("executor_type") or "local_docker"
        if executor_type not in ("local_docker", "remote_node"):
            raise PackageScriptAIError("执行方式仅支持本地 Docker / 远程节点")
        node_os_type = (payload.get("node_os_type") or "").strip().lower()
        if node_os_type not in ("", "windows", "kylin"):
            raise PackageScriptAIError("节点操作系统仅支持 windows / kylin")
        try:
            build_path = validate_safe_rel_path(payload.get("build_path") or ".", "build_path")
            output_path = validate_safe_rel_path(
                payload.get("output_path") or "dist", "output_path"
            )
        except ValidationError:
            raise PackageScriptAIError("构建目录/产物目录不能包含 .. 且不能为绝对路径") from None
        hint = str(payload.get("hint") or "").strip()
        if len(hint) > MAX_HINT_LENGTH:
            raise PackageScriptAIError(f"补充说明不能超过 {MAX_HINT_LENGTH} 字符")
        env_vars = payload.get("env_vars")
        if env_vars is None:
            env_vars = {}
        if not isinstance(env_vars, dict):
            raise PackageScriptAIError("环境变量格式不正确")
        return {
            "project_id": project_id,
            "repository_id": repository_id,
            "executor_type": executor_type,
            "node": payload.get("node"),
            "node_os_type": node_os_type,
            "image_ref": str(payload.get("image_ref") or "").strip(),
            "image_info": payload.get("image_info")
            if isinstance(payload.get("image_info"), dict)
            else None,
            "build_path": build_path,
            "output_path": output_path,
            "auto_collect_output": bool(payload.get("auto_collect_output")),
            "auto_compress": bool(payload.get("auto_compress")),
            "env_vars": env_vars,
            "custom_script": str(payload.get("custom_script") or ""),
            "hint": hint,
            "reference_exemplars": bool(payload.get("reference_exemplars", True)),
        }

    @staticmethod
    def _resolve_image_context(normalized: dict) -> dict:
        """尝试按 image_ref 命中已保存的镜像记录，补充脚本入口/默认路径。"""
        if not normalized.get("image_ref"):
            return {}
        image = PackageImage.objects.filter(image=normalized["image_ref"]).first()
        if not image:
            return {}
        return {
            "script_entry": image.script_entry or "",
            "default_build_path": image.default_build_path or "",
            "default_output_path": image.default_output_path or "",
        }

    @classmethod
    def _scan_repo(
        cls,
        repository: Repository,
        request_user=None,
        tree_chars: int = 15000,
        manifest_chars: int = 32 * 1024,
        product=None,
    ) -> tuple[dict, str | None]:
        """
        通过 GitLab API 读取仓库文件树与关键清单文件。

        任何失败都降级返回 (空上下文, 警告)，不阻断 AI 生成。
        """
        try:
            server_url = RepositoryService._resolve_server_url(repository)
            cred_data = resolve_credential(repository, request_user, product=product)
            provider = get_provider(repository.vendor, server_url, cred_data)
            ref = repository.default_branch or ""
            tree = provider.list_tree(repository.external_identity, ref=ref, recursive=True)
        except ProviderError as exc:
            return {}, f"仓库扫描失败：{exc}"
        except Exception as exc:
            return {}, f"仓库扫描失败：{exc}"

        tree_text = "\n".join(
            item["path"]
            for item in tree
            if item.get("type") == "blob"
        )[: min(tree_chars, MAX_TREE_ENTRIES * 100)]
        files: dict[str, str] = {}
        total = 0
        for path in cls._select_manifest_files(tree):
            try:
                content = provider.get_file_raw(
                    repository.external_identity, path, ref=ref
                )
            except Exception:
                continue
            if not content:
                continue
            content = content[:MAX_MANIFEST_FILE_CHARS]
            files[path] = content
            total += len(content)
            if len(files) >= MAX_MANIFEST_FILES or total >= manifest_chars:
                break
        return {"tree": tree_text, "files": files}, None

    @staticmethod
    def _select_manifest_files(tree: list[dict]) -> list[str]:
        """从文件树中挑选构建清单文件：精确名单优先，其次按后缀规则。"""
        blobs = [
            item
            for item in tree
            if item.get("type") == "blob" and item.get("path")
        ]
        # 深度优先，根目录清单文件优先；精确名单内按重要性排序，保证 package.json 等先进入
        blobs.sort(
            key=lambda item: (
                item["path"].count("/"),
                MANIFEST_EXACT_PRIORITY.get(item["name"], 100),
                item["path"],
            )
        )
        chosen: list[str] = []
        chosen_set: set[str] = set()
        for item in blobs:
            if item["name"] in MANIFEST_EXACT_NAMES and item["path"] not in chosen_set:
                chosen.append(item["path"])
                chosen_set.add(item["path"])
        for suffix, limit in MANIFEST_SUFFIX_RULES:
            count = 0
            for item in blobs:
                if count >= limit:
                    break
                if item["name"].endswith(suffix) and item["path"] not in chosen_set:
                    chosen.append(item["path"])
                    chosen_set.add(item["path"])
                    count += 1
        return chosen[:MAX_MANIFEST_FILES]

    @staticmethod
    def _probe_container(image_ref: str) -> tuple[dict | None, str | None]:
        """对本地镜像执行只读探测；未选择镜像时直接跳过。"""
        if not image_ref:
            return None, None
        return LocalDockerService.probe_image(image_ref)

    @staticmethod
    def _probe_node(node_id) -> tuple[dict | None, str | None]:
        """对远程节点执行只读工具探测（按节点 OS 分发）；未选择节点时直接跳过。"""
        if not node_id:
            return None, None
        try:
            node = PackageNode.objects.get(id=node_id)
        except PackageNode.DoesNotExist:
            return None, "远程打包节点不存在"
        if not node.is_active:
            return None, "远程打包节点已停用"
        if not node.credential_id:
            return None, "远程打包节点未配置登录凭证"
        if (node.os_type or "windows").lower() == "kylin":
            from apps.package.remote_kylin import probe_node_tools as probe_kylin_node_tools

            return probe_kylin_node_tools(node.host, node.port, str(node.credential_id))
        return probe_node_tools(node.host, node.port, str(node.credential_id))

    @staticmethod
    def _load_knowledge(max_chars: int = 12000) -> list[dict]:
        """读取启用中的通用打包知识库条目（按更新时间倒序，限量限长）。"""
        entries = PackageKnowledge.objects.filter(is_active=True).order_by("-updated_at")[
            :MAX_KNOWLEDGE_ENTRIES
        ]
        knowledge: list[dict] = []
        total = 0
        for entry in entries:
            content = entry.content[:MAX_KNOWLEDGE_ENTRY_CHARS]
            knowledge.append({"title": entry.title, "content": content})
            total += len(content)
            if total >= max_chars:
                break
        return knowledge

    @classmethod
    def _prompt_limits(cls) -> dict:
        """读取可配置的 prompt 体积上限（系统配置页 AI 服务卡片维护，默认已调低）。"""
        values = SystemConfigService.get_many(AI_PROMPT_CONFIG_KEYS)

        def _num(key: str, default: int) -> int:
            try:
                value = int(values.get(key) or default)
            except (TypeError, ValueError):
                value = default
            return max(1000, min(200000, value))

        return {
            "manifest_chars": _num("ai_manifest_chars", 32 * 1024),
            "tree_chars": _num("ai_tree_chars", 15000),
            "knowledge_chars": _num("ai_knowledge_chars", 12000),
            "exemplar_chars": _num("ai_exemplar_chars", 12000),
        }

    @staticmethod
    def _scrub_exemplar_script(script: str) -> str:
        """对历史脚本做轻量脱敏，避免明文凭据进入 AI prompt。"""
        scrubbed = EXEMPLAR_SECRET_RE.sub(r"\1******", script)
        scrubbed = EXEMPLAR_URL_CRED_RE.sub(r"\1******@", scrubbed)
        return scrubbed

    @classmethod
    def _load_exemplar_scripts(
        cls,
        project_id: str,
        repository_id: str,
        executor_type: str,
        image_ref: str = "",
        limit: int = MAX_EXEMPLAR_SCRIPTS,
        max_chars: int = MAX_EXEMPLAR_TOTAL_CHARS,
    ) -> list[dict]:
        """
        从历史成功任务快照中提取自定义脚本作为参考。

        相关度评分：同项目 +100、同仓库 +50、同执行方式 +20、同镜像 +10；
        按（评分、成功次数、最近时间）降序，去重键为 (config_id, custom_script)。
        无成功任务时返回空列表，不报错。
        """
        tasks = (
            PackageTask.objects.filter(status="success")
            .select_related("project", "repository")
            .order_by("-created_at")[:MAX_EXEMPLAR_CANDIDATE_TASKS]
        )
        merged: dict[tuple, dict] = {}
        for task in tasks:
            snapshot = task.config_snapshot or {}
            script = (snapshot.get("custom_script") or "").strip()
            if not script:
                continue
            # 优先用快照/任务配置标识去重；两者都没有时按任务区分，
            # 避免不同配置的相同脚本被误合并
            config_key = (
                snapshot.get("config_id")
                or (str(task.config_id) if task.config_id else f"task:{task.id}")
            )
            key = (config_key, script)
            entry = merged.get(key)
            if entry is None:
                entry = {
                    "project_id": str(task.project_id),
                    "project_name": task.project.name,
                    "repository_id": str(task.repository_id),
                    "repository_name": task.repository.name,
                    "executor_type": snapshot.get("executor_type") or "",
                    "image_ref": snapshot.get("image") or "",
                    "build_path": snapshot.get("build_path") or "",
                    "output_path": snapshot.get("output_path") or "",
                    "version": task.version,
                    "success_count": 0,
                    "latest_at": task.created_at,
                    "script": script,
                }
                merged[key] = entry
            entry["success_count"] += 1
            if task.created_at > entry["latest_at"]:
                entry["latest_at"] = task.created_at
                entry["version"] = task.version

        project_id = str(project_id)
        repository_id = str(repository_id)

        def score(entry: dict) -> int:
            value = 0
            if entry["project_id"] == project_id:
                value += 100
            if entry["repository_id"] == repository_id:
                value += 50
            if entry["executor_type"] == executor_type:
                value += 20
            if image_ref and entry["image_ref"] == image_ref:
                value += 10
            return value

        ordered = sorted(
            merged.values(),
            key=lambda entry: (score(entry), entry["success_count"], entry["latest_at"]),
            reverse=True,
        )
        result: list[dict] = []
        total = 0
        for entry in ordered:
            script = cls._scrub_exemplar_script(entry["script"])[
                :MAX_EXEMPLAR_SCRIPT_CHARS
            ]
            if result and total + len(script) > max_chars:
                break
            if len(script) > max_chars:
                script = script[:max_chars]
            result.append(
                {
                    "project_name": entry["project_name"],
                    "repository_name": entry["repository_name"],
                    "executor_type": entry["executor_type"],
                    "image_ref": entry["image_ref"],
                    "build_path": entry["build_path"],
                    "output_path": entry["output_path"],
                    "version": entry["version"],
                    "success_count": entry["success_count"],
                    "script": script,
                }
            )
            total += len(script)
            if len(result) >= limit:
                break
        return result

    @staticmethod
    def _mask_env(env_vars: dict) -> list[str]:
        """环境变量转 prompt 文本：敏感键值脱敏，普通值截断。"""
        items: list[str] = []
        for key, value in env_vars.items():
            name = str(key)
            val = str(value)
            if SECRET_ENV_RE.search(name):
                val = "******"
            else:
                val = val[:200]
            items.append(f"{name}={val}")
        return items

    @classmethod
    def _build_prompt(
        cls,
        normalized: dict,
        image_ctx: dict,
        repo_context: dict,
        probe: dict | None,
        node_probe: dict | None = None,
        knowledge: list[dict] | None = None,
        exemplars: list[dict] | None = None,
    ) -> tuple[str, str]:
        """组装系统提示与用户提示，prompt 中不含凭证/token/密码。"""
        executor = normalized["executor_type"]
        is_remote = executor == "remote_node"
        node_os = (normalized.get("node_os_type") or "windows").lower()
        lines: list[str] = ["请为以下软件打包配置生成自定义打包脚本。", ""]

        lines.append("【平台执行约定】")
        if is_remote and node_os == "kylin":
            lines.extend([
                "- 执行方式：远程麒麟 Linux 节点。脚本保存为 pack-custom.sh，由平台包装脚本先 cd 到构建目录、再 export 注入环境变量，随后以 sh -e 执行（遇错即停，脚本本身不需要写 set -e）。",
                "- 脚本语言：POSIX sh，变量引用用 $VAR。",
                "- 平台透传脚本最终退出码；多步骤失败务必返回非零。",
                "- 产物必须输出到 $ARTIFACTS_DIR；不要依赖除下列环境变量外的任何路径。",
                "- 不要修改平台已注入的变量；不要访问平台外部目录。",
                "- 构建工具以节点探测结果为准，未探测到的工具不得假定存在。",
            ])
        elif is_remote:
            lines.extend([
                "- 执行方式：远程 Windows 节点。脚本保存为 pack-custom.bat，由平台包装脚本先 cd 到构建目录、再 set 注入环境变量，随后 call 调用。",
                "- 脚本语言：Windows 批处理，变量引用用 %VAR%。",
                "- 平台透传脚本最终退出码；多步骤失败请检查 errorlevel，务必返回非零。",
                "- 产物必须输出到 %ARTIFACTS_DIR%；不要依赖除下列环境变量外的任何路径。",
                "- 不要 set 平台已注入的变量；不要访问平台外部目录。",
                "- 构建工具以节点探测结果为准，未探测到的工具不得假定存在。",
            ])
        else:
            lines.extend([
                "- 执行方式：本地 Docker 容器。脚本以 sh -ec 执行（遇错即停），脚本本身不需要写 set -e。",
                "- 工作目录：/workspace/source 下的构建目录（BUILD_PATH 对应相对路径）。",
                "- 只挂载 /workspace/source、/workspace/artifacts、/workspace/tmp；/workspace/scripts 与 /workspace/deploy 由镜像提供。",
                "- 产物必须输出到 $ARTIFACTS_DIR；不要写入其他目录。",
                "- 不要修改平台注入的环境变量；构建工具以容器内探测结果为准，未探测到的工具不得假定存在。",
            ])
        if normalized["auto_collect_output"]:
            lines.append("- 已开启「构建后自动收集产物」：平台会自动把产物目录内容归集到 artifacts，脚本只需构建到 OUTPUT_PATH 对应目录。")
        if normalized["auto_compress"]:
            lines.append("- 已开启「自动压缩产物」：平台会自动压缩产物，脚本无需自行压缩。")
        lines.extend(["", "【可用环境变量】"])
        lines.extend(f"- {name}：{desc}" for name, desc in ENV_VARIABLE_TABLE)

        lines.extend(["", "【打包配置】"])
        lines.append(f"- 执行方式：{executor}")
        if normalized["image_ref"]:
            lines.append(f"- 镜像：{normalized['image_ref']}")
        if image_ctx.get("script_entry"):
            lines.append(f"- 镜像内置脚本入口：{image_ctx['script_entry']}（填写自定义脚本后不再执行）")
        lines.append(f"- 构建目录（相对源码根）：{normalized['build_path']}")
        lines.append(f"- 产物目录：{normalized['output_path']}")
        if normalized["env_vars"]:
            lines.append("- 自定义环境变量：" + "、".join(cls._mask_env(normalized["env_vars"])))
        if normalized["custom_script"].strip():
            lines.extend([
                "- 已有脚本草稿（可参考、续写或改进）：",
                normalized["custom_script"].strip()[:MAX_SCRIPT_PREVIEW_CHARS],
            ])

        if probe:
            lines.extend(["", "【容器内探测结果（以探测到的工具链为准）】"])
            if probe.get("versions"):
                lines.extend(["工具链版本：", probe["versions"]])
            if probe.get("scripts_dir"):
                lines.extend(["/workspace/scripts 内容：", probe["scripts_dir"]])
            if probe.get("pack_sh"):
                lines.extend(["/workspace/scripts/pack.sh 内容（前 4KB）：", probe["pack_sh"]])
            if probe.get("deploy_dir"):
                lines.extend(["/workspace/deploy 内容：", probe["deploy_dir"]])
            if probe.get("workdir"):
                lines.append(f"容器内当前工作目录：{probe['workdir']}")
            if probe.get("path"):
                lines.append(f"PATH：{probe['path']}")

        if node_probe:
            lines.extend(["", "【节点工具探测结果（以探测到的工具链为准）】"])
            if node_probe.get("versions"):
                lines.extend(["工具链版本：", node_probe["versions"]])
            if node_probe.get("path"):
                lines.append(f"节点 PATH：{node_probe['path']}")

        if knowledge:
            lines.extend(["", "【通用打包知识库（生成脚本时必须遵循）】"])
            for item in knowledge:
                lines.extend([f"## {item['title']}", item["content"]])

        if exemplars:
            lines.extend(["", "【历史成功脚本参考（平台内真实运行过的配置）】"])
            lines.append(
                "以下脚本来自平台内打包成功的真实任务，可借鉴其构建步骤与工具用法；"
                "但必须遵循当前配置的平台约定与探测结果，不要照搬其路径、环境变量或镜像假设。"
            )
            for item in exemplars:
                lines.extend(
                    [
                        f"## {item['project_name']} / {item['repository_name']}"
                        f"（{item['executor_type']}，版本 {item['version']}，成功 {item['success_count']} 次）",
                        item["script"],
                    ]
                )

        if repo_context.get("tree") or repo_context.get("files"):
            lines.extend(["", "【仓库上下文】"])
            if repo_context.get("tree"):
                lines.extend(["仓库文件树（仅路径）：", repo_context["tree"]])
            if repo_context.get("files"):
                lines.append("关键清单文件内容：")
                for path, content in repo_context["files"].items():
                    lines.extend([f"--- {path} ---", content])

        if normalized["hint"]:
            lines.extend(["", "【补充说明】", normalized["hint"]])

        lines.extend([
            "",
            "【输出要求】只输出一个 JSON 对象，不要输出 Markdown 代码围栏或其他文字。",
            '格式：{"summary": "一句话生成说明", "script": "完整脚本（LF 换行，不含围栏）", '
            '"explanations": [{"line": 1, "reason": "该行作用"}]}，'
            "explanations 为 script 中每一行或关键行逐行解释，line 从 1 开始。",
        ])
        user = "\n".join(lines)
        system = (
            "你是资深 CI/CD 与软件打包脚本工程师，精通 POSIX sh 与 Windows 批处理。"
            "你根据给定的平台约定、仓库结构与运行环境生成可直接使用的打包脚本草稿，"
            "并逐行解释每一条命令的作用。只输出规定的 JSON 对象。"
        )
        return system, user

    @staticmethod
    def _extract_json(text: str) -> dict:
        """从 AI 返回文本中提取 JSON 对象，兼容代码围栏与前后多余文字。"""
        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned).strip()
        try:
            data = json.loads(cleaned)
        except ValueError:
            start = cleaned.find("{")
            end = cleaned.rfind("}")
            if start == -1 or end <= start:
                raise
            data = json.loads(cleaned[start : end + 1])
        if not isinstance(data, dict):
            raise ValueError("AI 返回内容不是 JSON 对象")
        return data

    @staticmethod
    def _normalize_result(data: dict) -> dict:
        """校验并归一化 AI 返回结果，丢弃越界/非法的解释行。"""
        script = data.get("script")
        if not isinstance(script, str) or not script.strip():
            raise ValueError("AI 返回内容缺少 script")
        script = script.strip()
        raw_explanations = data.get("explanations")
        if not isinstance(raw_explanations, list):
            raw_explanations = []
        lines = script.splitlines()
        explanations: list[dict] = []
        for item in raw_explanations:
            if not isinstance(item, dict):
                continue
            try:
                line = int(item.get("line"))
            except (TypeError, ValueError):
                continue
            reason = str(item.get("reason") or "").strip()
            if line < 1 or line > len(lines) or not reason:
                continue
            explanations.append({"line": line, "reason": reason})
        return {
            "script": script,
            "explanations": explanations,
            "summary": str(data.get("summary") or "").strip(),
        }

    @classmethod
    def generate(
        cls,
        payload: dict,
        request_user=None,
        on_chunk=None,
        on_progress=None,
    ) -> dict:
        """
        生成打包脚本草稿并返回结构化结果。

        Returns:
            {script, explanations, summary, model, repo_scanned, container_probed,
             repo_scan_warning?, container_probe_warning?}
        """
        ai = cls._ai_config()
        if not ai["endpoint"]:
            raise PackageScriptAIError(
                "AI 服务未配置，请先在「系统配置 · AI 服务」中填写服务地址与密钥"
            )
        normalized = cls._normalize_payload(payload)
        try:
            project = Project.objects.get(id=normalized["project_id"])
        except Project.DoesNotExist:
            raise PackageScriptAIError("项目不存在", 40400) from None
        try:
            repository = Repository.objects.get(id=normalized["repository_id"])
        except Repository.DoesNotExist:
            raise PackageScriptAIError("关联仓库不存在") from None
        if repository.project_id != project.id and not ProductComponent.objects.filter(
            project=project,
            repository=repository,
            is_active=True,
        ).exists():
            raise PackageScriptAIError("关联仓库不属于当前产品，或关联未启用")

        limits = cls._prompt_limits()
        image_ctx = cls._resolve_image_context(normalized)
        repo_context, repo_warning = cls._scan_repo(
            repository,
            request_user,
            tree_chars=limits["tree_chars"],
            manifest_chars=limits["manifest_chars"],
            product=project,
        )
        probe = None
        probe_warning = None
        if normalized["executor_type"] == "local_docker" and normalized["image_ref"]:
            probe, probe_warning = cls._probe_container(normalized["image_ref"])
        node_probe = None
        node_probe_warning = None
        if normalized["executor_type"] == "remote_node" and normalized["node"]:
            node_probe, node_probe_warning = cls._probe_node(normalized["node"])
            if not normalized.get("node_os_type"):
                # 请求未带节点 OS 时从数据库补齐，供 prompt 按 OS 生成对应脚本约定
                try:
                    node_obj = PackageNode.objects.only("os_type").get(id=normalized["node"])
                    normalized["node_os_type"] = (node_obj.os_type or "windows").lower()
                except Exception:
                    pass
        knowledge = cls._load_knowledge(max_chars=limits["knowledge_chars"])
        exemplars: list[dict] = []
        if normalized["reference_exemplars"]:
            exemplars = cls._load_exemplar_scripts(
                normalized["project_id"],
                normalized["repository_id"],
                normalized["executor_type"],
                image_ref=normalized["image_ref"],
                max_chars=limits["exemplar_chars"],
            )

        system, user = cls._build_prompt(
            normalized, image_ctx, repo_context, probe, node_probe, knowledge, exemplars
        )
        if on_progress:
            on_progress("上下文准备完成，AI 开始生成…")
        prompt_chars = len(user)
        result: dict | None = None
        retries = 0
        raw_text = ""
        while True:
            try:
                if on_chunk is None:
                    raw = call_ai_chat(
                        ai["endpoint"],
                        ai["api_key"],
                        ai["model"],
                        ai["protocol"],
                        system=system,
                        user=user,
                        max_tokens=ai["max_tokens"],
                    )
                else:
                    raw = call_ai_chat_stream(
                        ai["endpoint"],
                        ai["api_key"],
                        ai["model"],
                        ai["protocol"],
                        system=system,
                        user=user,
                        on_chunk=on_chunk,
                        max_tokens=ai["max_tokens"],
                    )
                raw_text = raw
                result = cls._normalize_result(cls._extract_json(raw))
                break
            except AIClientError as exc:
                raise PackageScriptAIError(str(exc), 50200) from exc
            except ValueError:
                # 重试仅对短 prompt 生效，避免超大 prompt 重复发送拖慢/翻倍成本
                if retries >= 1 or prompt_chars > AI_RETRY_MAX_PROMPT_CHARS:
                    raise PackageScriptAIError(
                        "AI 返回内容无法解析，请重试或更换模型", 50200
                    ) from None
                retries += 1
                user = user + "\n\n上次输出不是合法 JSON，请只输出 JSON 对象。"

        result.update(
            {
                "model": ai["model"],
                "repo_scanned": bool(repo_context),
                "container_probed": bool(probe),
                "node_probed": bool(node_probe),
                "referenced_scripts": [
                    {
                        "project_name": item["project_name"],
                        "repository_name": item["repository_name"],
                        "executor_type": item["executor_type"],
                        "version": item["version"],
                        "success_count": item["success_count"],
                    }
                    for item in exemplars
                ],
            }
        )
        if repo_warning:
            result["repo_scan_warning"] = repo_warning
        if probe_warning:
            result["container_probe_warning"] = probe_warning
        if node_probe_warning:
            result["node_probe_warning"] = node_probe_warning

        try:
            OperationLogService.log(
                user=request_user,
                module="package",
                action="AI生成打包脚本",
                resource_type="package_config",
                resource_id=str(project.id),
                description=f"AI 生成打包脚本（{repository.name}）",
                result="success",
                detail={
                    "model": ai["model"],
                    "repo_scanned": bool(repo_context),
                    "container_probed": bool(probe),
                    "node_probed": bool(node_probe),
                    "exemplar_count": len(exemplars),
                    "stream_used": bool(on_chunk),
                    "raw_chars": len(raw_text),
                    "parse_retries": retries,
                    "prompt_chars": prompt_chars,
                    "prompt_tokens_est": prompt_chars // 3,
                    "script_chars": len(result["script"]),
                },
            )
        except Exception:
            logger.exception("记录 AI 生成打包脚本操作日志失败")
        return result
