import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class ParsedCommit:
    change_type: Optional[str] = None  # 无配置项改动 / 有配置项改动
    updates: List[Dict[str, str]] = field(default_factory=list)
    config_changes: Dict[str, Dict[str, str]] = field(default_factory=dict)
    related_changes: Dict[str, str] = field(default_factory=dict)
    is_valid: bool = True
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "change_type": self.change_type,
            "updates": self.updates,
            "config_changes": self.config_changes,
            "related_changes": self.related_changes,
            "is_valid": self.is_valid,
            "errors": self.errors,
        }


class CommitParser:
    """Commit 规范解析器"""

    CHECKED_MARKS = r"[☑√✓✔]"

    @classmethod
    def parse(cls, message: str) -> ParsedCommit:
        result = ParsedCommit()
        if not message or not message.strip():
            result.is_valid = False
            result.errors.append("提交信息为空")
            return result

        # 1. 变更类型
        result.change_type = cls._extract_change_type(message)
        if result.change_type is None:
            result.is_valid = False
            result.errors.append("缺少或无法识别变更类型标记")

        # 2. 更新内容
        result.updates = cls._extract_updates(message)
        if not result.updates:
            result.is_valid = False
            result.errors.append("缺少更新内容")

        # 3. 配置项改动（如果声明有）
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
        updates = []
        # 匹配 "1. A xxx" / "1、A xxx" 等；类型暂按单个大写字母提取，由审查规则校验是否为 A/F
        pattern = re.compile(r"^\s*\d+[\.\s、]\s*([A-Z])\s+(.+)$", re.MULTILINE)
        for match in pattern.finditer(message):
            updates.append({
                "type": match.group(1).upper(),
                "content": match.group(2).strip(),
            })
        return updates

    @classmethod
    def _extract_config_changes(cls, message: str) -> Dict[str, Dict[str, str]]:
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
