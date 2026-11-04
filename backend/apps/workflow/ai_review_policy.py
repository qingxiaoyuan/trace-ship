"""版本化的审查过滤规则；使用明确路径约定，不猜测普通业务目录。"""
from __future__ import annotations

import fnmatch
from pathlib import PurePosixPath
from typing import Any

POLICY_VERSION = 1
THIRD_PARTY_DIRS = frozenset({
    "node_modules", "vendor", "vendors", "third_party", "third-party", "thirdparty", "3rdparty",
    "site-packages", ".venv", "venv",
})
GENERATED_DIRS = frozenset({"dist", "coverage", "__pycache__", ".next", ".nuxt", ".cache"})
CONFIG_DIRS = frozenset({"config", "configs", "configuration", "settings", ".github", ".gitlab", ".vscode", ".idea"})
LOCK_NAMES = frozenset({
    "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb",
    "poetry.lock", "uv.lock", "pipfile.lock", "cargo.lock", "go.sum", "composer.lock", "gemfile.lock",
    "packages.lock.json", "conan.lock",
})
CONFIG_NAMES = frozenset({
    "package.json", "composer.json", "pipfile", "gemfile", "cargo.toml", "go.mod", "pom.xml",
    "dockerfile", "containerfile", "makefile", "cmakelists.txt", "web.xml", "settings.xml", ".gitignore", ".gitattributes",
    ".gitmodules", ".editorconfig", ".npmrc", ".yarnrc", ".babelrc", ".eslintrc", ".prettierrc",
})
CONFIG_PATTERNS = (
    "*.yaml", "*.yml", "*.toml", "*.ini", "*.cfg", "*.conf", "*.properties", "*.config",
    ".env", ".env.*", "*.env", "*.env.*", "*.config.*", "*.conf.*", "tsconfig*.json", "jsconfig*.json",
    "appsettings*.json", "requirements*.txt", "dockerfile.*", "containerfile.*", "*.csproj", "*.vcxproj",
    "*.props", "*.targets", "*.gradle", "*.gradle.kts", "*.cmake", "application*.xml", "log4j*.xml", ".*rc", ".*rc.*",
)
GENERATED_PATTERNS = ("*.min.js", "*.min.css", "*.map", "*.generated.*", "*.g.cs", "*.designer.cs", "*.pb.go", "*_pb2.py", "*_pb2_grpc.py")
BINARY_SUFFIXES = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".gz", ".7z", ".tar",
    ".woff", ".woff2", ".ttf", ".eot", ".mp3", ".mp4", ".wav", ".exe", ".dll", ".so", ".dylib",
    ".a", ".lib", ".o", ".obj", ".class", ".jar", ".pyc", ".pyo", ".wasm", ".bin",
})


def path_exclusion(path: str, version: int = POLICY_VERSION) -> str | None:
    """相对路径按完整目录段匹配；普通 lib/common 和 JSON 数据仍待审。"""
    if version != 1:
        return None
    parts = PurePosixPath(path.replace("\\", "/").lower()).parts
    if not parts:
        return None
    directories, name = set(parts[:-1]), parts[-1]
    if directories & THIRD_PARTY_DIRS:
        return "第三方依赖目录"
    if name in LOCK_NAMES:
        return "依赖锁文件"
    if directories & GENERATED_DIRS or any(fnmatch.fnmatchcase(name, pattern) for pattern in GENERATED_PATTERNS):
        return "生成物或压缩资源"
    if directories & CONFIG_DIRS or name in CONFIG_NAMES or any(fnmatch.fnmatchcase(name, pattern) for pattern in CONFIG_PATTERNS):
        return "配置文件"
    if PurePosixPath(name).suffix in BINARY_SUFFIXES:
        return "二进制资源"
    return None


def diff_exclusion(item: dict[str, Any]) -> str | None:
    """改名跨越过滤边界时继续审查；纯改名必须有明确且完整的远端标记。"""
    paths = [item.get("new_path") or item.get("old_path")]
    if item.get("renamed_file") and item.get("old_path"):
        paths.append(item["old_path"])
    reasons = [path_exclusion(path) for path in paths if isinstance(path, str)]
    if reasons and all(reasons):
        return reasons[0]
    crosses_boundary = any(reasons) and not all(reasons)
    diff = item.get("diff")
    if item.get("binary") or isinstance(diff, str) and diff.startswith(("Binary files ", "GIT binary patch")):
        return "二进制差异"
    if (item.get("renamed_file") and item.get("old_path") and item.get("new_path")
            and item["old_path"] != item["new_path"] and diff == ""
            and not crosses_boundary and item.get("diff_missing") is False
            and not item.get("too_large") and not item.get("collapsed")):
        return "仅路径改名，无文本差异"
    return None
