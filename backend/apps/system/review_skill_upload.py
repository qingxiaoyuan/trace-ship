"""仅接收文档资源，不解压到磁盘或执行技能中的命令。"""
import io
import posixpath
import re
import stat
import zipfile
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit

from rest_framework import serializers

from apps.system.models import ReviewSkillVersion

MAX_ARCHIVE = 2 * 1024 * 1024
MAX_FILES = 50
MAX_TOTAL = 4 * 1024 * 1024
LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
REFERENCE = re.compile(r"^\s*\[([^\]]+)\]:\s*(\S+)", re.M)
REF_USE = re.compile(r"(?<!!)\[([^\]]+)\]\[([^\]]*)\]")
IMAGE = re.compile(r"!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])")
FENCED = re.compile(r"^(`{3,}|~{3,})([^\n]*)\n(.*?)^\1\s*$", re.M | re.S)
INLINE = re.compile(r"`([^`\n]+)`")
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


def _validate(documents: dict[str, str]) -> None:
    if "SKILL.md" not in documents or not documents["SKILL.md"].strip():
        _bad("文档包必须包含非空的 SKILL.md")
    for name, content in documents.items():
        if IMAGE.search(content):
            _bad("不支持图片等非文档资源")
        definitions = {m.group(1).strip().casefold(): m.group(2) for m in REFERENCE.finditer(content)}
        for match in REF_USE.finditer(content):
            reference = (match.group(2) or match.group(1)).strip().casefold()
            if reference not in definitions:
                _bad(f"引用文档未定义：{reference}")
        targets = [match.group(1) for match in LINK.finditer(content)]
        targets.extend(definitions.values())
        for raw in targets:
            parts = raw.strip().split()
            if not parts:
                _bad("引用路径为空")
            target = parts[0].strip('<>')
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
        for _, language, block in FENCED.findall(content):
            shell = language.strip().lower() in ("sh", "bash", "shell", "zsh", "cmd", "powershell")
            for line in block.splitlines():
                command = line.strip().lstrip('$').strip()
                if not command or command.startswith('#'):
                    continue
                if shell and (re.search(r"[;&|`<>]|\$\(", command) or not re.match(r"^(?:cat|rg|grep|git\s+(?:diff|show))\s+", command)):
                    _bad("技能包含不支持的命令；仅支持只读文档指引")
                if not language.strip() and COMMAND.match(line.strip()):
                    _bad("技能包含不支持的命令；仅支持只读文档指引")
        for inline in INLINE.findall(content):
            if COMMAND.match(inline.strip()) or (re.match(r"^(?:cat|rg|grep|git\s+(?:diff|show))\s+", inline.strip()) and re.search(r"[;&|<>`]|\$\(", inline)) :
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
        except (zipfile.BadZipFile, RuntimeError, OSError, NotImplementedError):
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
