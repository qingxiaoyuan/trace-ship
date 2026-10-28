"""仅接收文档资源，不解压到磁盘或执行技能中的命令。"""
import io
import posixpath
import re
import shlex
import stat
import zipfile
import zlib
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit

from markdown_it import MarkdownIt
from rest_framework import serializers

from apps.system.models import ReviewSkillVersion

MAX_ARCHIVE = 2 * 1024 * 1024
MAX_FILES = 50
MAX_TOTAL = 4 * 1024 * 1024
REF_USE = re.compile(r"(?<!!)\[([^\]]+)\]\[([^\]]*)\]")
COMMAND = re.compile(r"^(?:\$\s*)?(?:curl|wget|rm|sudo|chmod|chown|pip|pip3|npm|npx|yarn|pnpm|python|python3|bash|sh|apt|apt-get|git\s+(?!diff\b|show\b)\w+)\b", re.I)


def _bad(message: str):
    raise serializers.ValidationError({"file": message})


def _path(name: str) -> str:
    if not name or "\\" in name or "\x00" in name or name.startswith("/"):
        _bad("文档路径不合法")
    parts = PurePosixPath(name).parts
    if any(part in ("..", ".") for part in name.split("/")) or not parts or ":" in parts[0]:
        _bad("文档路径不合法")
    return str(PurePosixPath(name))


def _supported_command(command: str) -> bool:
    """仅识别有限的只读意图；平台不执行文档中的 shell。"""
    if re.search(r"[;&|`<>$*?~]", command):
        return False
    try:
        args = shlex.split(command)
    except ValueError:
        return False
    if not args:
        return False
    if args == ["git", "diff"]:
        return True
    if args[0] == "cat" and len(args) == 2:
        paths = args[1:]
    elif args[0] in ("rg", "grep") and len(args) == 3 and not args[1].startswith("-"):
        paths = args[2:]
    else:
        return False
    for path in paths:
        if path.startswith(("/", "-")) or "\\" in path or "\x00" in path:
            return False
        if any(part == ".." for part in path.split("/")) or ":" in path:
            return False
    return True


def _validate(documents: dict[str, str]) -> None:
    if "SKILL.md" not in documents or not documents["SKILL.md"].strip():
        _bad("文档包必须包含非空的 SKILL.md")
    parser = MarkdownIt("commonmark")
    # 危险协议也解析为链接，随后统一拒绝，而不是当作普通文本漏检。
    parser.validateLink = lambda _: True
    for name, content in documents.items():
        environment = {}
        tokens = parser.parse(content, environment)
        targets = [definition["href"] for definition in environment.get("references", {}).values()]
        for token in tokens:
            if token.type != "inline":
                continue
            for child in token.children or []:
                if child.type == "image":
                    _bad("不支持图片等非文档资源")
                if child.type == "link_open":
                    targets.append(child.attrGet("href") or "")
                if child.type == "code_inline":
                    value = child.content.strip()
                    if COMMAND.match(value) or (re.match(r"^(?:cat|rg|grep|git\s+(?:diff|show))\b", value) and not _supported_command(value)):
                        _bad("技能包含不支持的命令；仅支持只读文档指引")
                if child.type == "text":
                    missing = REF_USE.search(child.content)
                    if missing:
                        _bad(f"引用文档未定义：{missing.group(2) or missing.group(1)}")
        for target in targets:
            if not target:
                _bad("引用路径为空")
            try:
                parsed = urlsplit(target)
            except ValueError:
                _bad(f"引用路径不合法：{target}")
            if parsed.scheme or parsed.netloc:
                _bad(f"不支持外部引用，请将文档包含在上传包中：{target}")
            if not parsed.path:
                continue
            path = unquote(parsed.path)
            if path.startswith('/') or '\\' in path or '\x00' in path:
                _bad(f"引用路径越界：{target}")
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), path))
            if resolved == '..' or resolved.startswith('../'):
                _bad(f"引用路径越界：{target}")
            if resolved not in documents:
                _bad(f"引用文档不存在：{target}")
        for token in tokens:
            if token.type not in ("fence", "code_block"):
                continue
            language = token.info.strip().split(maxsplit=1)[0].lower() if token.info.strip() else ""
            shell = language in ("sh", "bash", "shell", "zsh", "cmd", "powershell")
            for line in token.content.splitlines():
                command = line.strip().lstrip('$').strip()
                if not command or command.startswith('#'):
                    continue
                if shell and not _supported_command(command):
                    _bad("技能包含不支持的命令；仅支持只读文档指引")
                if not language and (COMMAND.match(command) or (re.match(r"^(?:cat|rg|grep|git\s+(?:diff|show))\b", command) and not _supported_command(command))):
                    _bad("技能包含不支持的命令；仅支持只读文档指引")



def read_upload(upload) -> dict[str, str]:
    if upload.size > MAX_ARCHIVE:
        _bad("上传文件超过大小限制")
    raw = upload.read(MAX_ARCHIVE + 1)
    if len(raw) > MAX_ARCHIVE:
        _bad("上传文件超过大小限制")
    documents = {}
    if upload.name == "SKILL.md":
        entries = [("SKILL.md", raw)]
    elif upload.name.lower().endswith('.zip'):
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as package:
                files = [entry for entry in package.infolist() if not entry.is_dir()]
                if not files or len(files) > MAX_FILES or sum(x.file_size for x in files) > MAX_TOTAL:
                    _bad("文档包文件数量或解压大小超过限制")
                entries = []
                seen = set()
                for entry in files:
                    name = _path(entry.filename)
                    if name in seen or stat.S_ISLNK(entry.external_attr >> 16):
                        _bad("文档包包含重复路径或链接")
                    if not name.lower().endswith('.md'):
                        _bad("文档包只能包含 Markdown 文档，不支持脚本或其他资源")
                    seen.add(name)
                    entries.append((name, package.read(entry)))
        except (zipfile.BadZipFile, RuntimeError, OSError, NotImplementedError, zlib.error):
            _bad("ZIP 文档包无效")
    else:
        _bad("请选择 SKILL.md 或 ZIP 文档包")
    # 允许 ZIP 包装一层目录，但不允许主文档之外残留同包资源。
    if not any(name == "SKILL.md" for name, _ in entries):
        candidates = [name for name, _ in entries if name.endswith("/SKILL.md")]
        if len(candidates) == 1:
            prefix = candidates[0][:-len("SKILL.md")]
            if all(name.startswith(prefix) for name, _ in entries):
                entries = [(name[len(prefix):], content) for name, content in entries]
    for name, content in entries:
        try:
            documents[name] = content.decode('utf-8')
        except UnicodeDecodeError:
            _bad(f"文档不是 UTF-8 编码：{name}")
        if '\x00' in documents[name]:
            _bad(f"文档包含无效内容：{name}")
    _validate(documents)
    return documents


def create_skill(upload) -> ReviewSkillVersion:
    documents = read_upload(upload)
    heading = next((line.lstrip('#').strip() for line in documents['SKILL.md'].splitlines() if line.startswith('# ')), '')
    return ReviewSkillVersion.objects.create(name=(heading or '上传技能')[:200], documents=documents)


def skill_response(skill: ReviewSkillVersion) -> dict:
    return {"id": str(skill.id), "name": skill.name, "files": list(skill.documents), "created_at": skill.created_at.isoformat()}
