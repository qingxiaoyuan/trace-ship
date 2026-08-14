"""
提交信息解析器

按照项目提交规范解析 commit message，提取变更类型、更新内容、配置项改动和关联性改动。
"""
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional


# 更新内容行正则：匹配行首 A/F 标记，允许可选前导序号如「1. 」或「1、」。
# 限制为行首可避免把「提交A功能」等普通提交中的字母误判为更新类型。
UPDATE_LINE_RE = re.compile(r"^\s*(?:\d+[.、][ \t]*)?([AF])[ \t]+(.+)$", re.MULTILINE)

# Conventional Commit 与尖括号前缀。仅识别提交首个非空行，避免正文中的普通
# fix/feat 文本被误解析为更新内容。
UPDATE_PREFIX_RE = re.compile(
    r"^\s*(?:"
    r"<(?P<angle_type>fix|feat)>\s*:?\s*"
    r"|(?P<conventional_type>fix|feat)(?:\([^\r\n)]+\))?!?\s*:\s*"
    r")(?P<content>.*)$",
    re.IGNORECASE,
)


def extract_update_lines(text: str) -> List[Dict[str, str]]:
    """
    从 commit message 或 MR description 中提取更新行

    优先识别显式「A 内容」或「F 内容」（可选前导序号如「1. 」「1、」）。
    未命中显式 A/F 时，兼容首行 ``fix:`` / ``feat:``、带 scope 的 Conventional
    Commit 以及 ``<fix>`` / ``<feat>`` 前缀；多行内容的每个非空行继承该前缀类型。
    commit message 和 MR description 共用此规则。

    Args:
        text: 原始文本（commit message 或 MR description）

    Returns:
        更新条目列表，每项 {"type": "A"/"F", "content": "..."}
    """
    if not text:
        return []
    result: List[Dict[str, str]] = []
    for match in UPDATE_LINE_RE.finditer(text):
        result.append({
            "type": match.group(1).upper(),
            "content": match.group(2).strip(),
        })
    if result:
        return result

    lines = text.splitlines()
    first_index = next((index for index, line in enumerate(lines) if line.strip()), None)
    if first_index is None:
        return []
    prefix_match = UPDATE_PREFIX_RE.match(lines[first_index])
    if not prefix_match:
        return []

    prefix_type = prefix_match.group("angle_type") or prefix_match.group("conventional_type")
    update_type = "F" if prefix_type.lower() == "fix" else "A"
    contents = [prefix_match.group("content").strip()]
    contents.extend(line.strip() for line in lines[first_index + 1:] if line.strip())
    return [
        {"type": update_type, "content": content}
        for content in contents
        if content
    ]


@dataclass
class ParsedCommit:
    """
    解析后的提交信息数据类

    Attributes:
        change_type: 变更类型（无配置项改动 / 有配置项改动）
        updates: 更新内容列表，每项包含 type 和 content
        config_changes: 配置项改动，按 [Section] 分组
        related_changes: 关联性改动键值对
        is_valid: 是否通过基本校验
        errors: 校验错误信息列表
    """

    change_type: Optional[str] = None  # 无配置项改动 / 有配置项改动
    updates: List[Dict[str, str]] = field(default_factory=list)
    config_changes: Dict[str, Dict[str, str]] = field(default_factory=dict)
    related_changes: Dict[str, str] = field(default_factory=dict)
    is_valid: bool = True
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        """转换为普通字典，便于序列化"""
        return {
            "change_type": self.change_type,
            "updates": self.updates,
            "config_changes": self.config_changes,
            "related_changes": self.related_changes,
            "is_valid": self.is_valid,
            "errors": self.errors,
        }


class CommitParser:
    """
    Commit 规范解析器

    支持识别勾选符号（☑/√/✓/✔）和方框（□），提取规范要求的各个段落。
    """

    # 认可的勾选符号正则集合
    CHECKED_MARKS = r"[☑√✓✔]"

    @classmethod
    def parse(cls, message: str) -> ParsedCommit:
        """
        解析提交信息

        Args:
            message: 原始 commit message

        Returns:
            ParsedCommit 实例
        """
        result = ParsedCommit()
        if not message or not message.strip():
            result.is_valid = False
            result.errors.append("提交信息为空")
            return result

        # 1. 更新内容（A/F 行为合法提交的核心依据）
        result.updates = cls._extract_updates(message)
        if not result.updates:
            result.is_valid = False
            result.errors.append("缺少更新内容")

        # 2. 变更类型；未显式声明但有更新内容时，默认视为无配置项改动
        result.change_type = cls._extract_change_type(message)
        if result.change_type is None:
            if result.updates:
                result.change_type = "无配置项改动"
            else:
                result.is_valid = False
                result.errors.append("缺少或无法识别变更类型标记")

        # 3. 配置项改动（显式声明有配置项改动时才校验）
        if result.change_type == "有配置项改动":
            result.config_changes = cls._extract_config_changes(message)
            if not result.config_changes:
                result.is_valid = False
                result.errors.append("声明有配置项改动但未找到配置项内容")

        # 4. 关联性改动（选填）
        result.related_changes = cls._extract_related_changes(message)

        return result

    @classmethod
    def _extract_change_type(cls, message: str) -> Optional[str]:
        """
        提取变更类型

        匹配 "变更类型：☑ 无配置项改动 □有配置项改动" 这类行。
        """
        # 匹配变更类型行，允许 □ 或 ☑ 等勾选符号
        pattern = re.compile(
            r"变更类型[：:]\s*(" + cls.CHECKED_MARKS + r"\s*无配置项改动|□\s*无配置项改动)\s+(" + cls.CHECKED_MARKS + r"\s*有配置项改动|□\s*有配置项改动)",
            re.MULTILINE,
        )
        match = pattern.search(message)
        if not match:
            return None

        left = match.group(1) or ""
        right = match.group(2) or ""
        if re.search(cls.CHECKED_MARKS, right):
            return "有配置项改动"
        if re.search(cls.CHECKED_MARKS, left):
            return "无配置项改动"
        # 都没有勾选时默认无配置项改动，但可视为 warning
        return "无配置项改动"

    @classmethod
    def _extract_updates(cls, message: str) -> List[Dict[str, str]]:
        """
        提取更新内容列表

        匹配 "A xxx" / "F xxx" / "1. A xxx" / "1、A xxx" 等格式；
        类型按单个大写字母提取，由审查规则校验是否为 A/F。
        """
        return extract_update_lines(message)

    @classmethod
    def _extract_config_changes(cls, message: str) -> Dict[str, Dict[str, str]]:
        """
        提取配置项改动

        按 [Section] 分组解析 key=value 配置项。
        """
        config: Dict[str, Dict[str, str]] = {}
        in_section = False
        current_section = None
        started = False

        for raw_line in message.splitlines():
            line = raw_line.strip()
            if not started:
                if line.startswith("配置项改动"):
                    started = True
                continue

            # 配置项改动段落结束判断：遇到下一个大标题（如 关联性改动、更新内容）
            if line and (line.startswith("关联性改动") or line.startswith("更新内容") or line.startswith("变更类型")):
                break

            section_match = re.match(r"^\[(.+)\]$", line)
            if section_match:
                current_section = section_match.group(1).strip()
                config[current_section] = {}
                in_section = True
                continue

            if in_section and current_section and "=" in line:
                key, value = line.split("=", 1)
                config[current_section][key.strip()] = value.strip()

        return config

    @classmethod
    def _extract_related_changes(cls, message: str) -> Dict[str, str]:
        """
        提取关联性改动

        解析 "关联性改动" 段落下的 key:value 键值对。
        """
        related: Dict[str, str] = {}
        started = False
        for raw_line in message.splitlines():
            line = raw_line.strip()
            if not started:
                if line.startswith("关联性改动"):
                    started = True
                continue

            # 简单 key:value 或 key：value
            if line and (":" in line or "：" in line):
                key, value = re.split(r"[:：]", line, 1)
                related[key.strip()] = value.strip()
            elif line == "":
                continue
            else:
                # 遇到非 key:value 行视为结束
                break
        return related
