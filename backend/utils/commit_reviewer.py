from .commit_parser import CommitParser


class CommitReviewer:
    """Commit 审查规则引擎"""

    RULES = [
        {
            "name": "变更类型必填",
            "check": lambda p: p.change_type is not None,
            "severity": "illegal",
            "message": "缺少或无法识别变更类型标记",
        },
        {
            "name": "更新内容必填",
            "check": lambda p: len(p.updates) > 0,
            "severity": "illegal",
            "message": "缺少更新内容",
        },
        {
            "name": "配置项改动一致性",
            "check": lambda p: not (p.change_type == "有配置项改动" and not p.config_changes),
            "severity": "illegal",
            "message": "声明有配置项改动但未提供配置项内容",
        },
        {
            "name": "更新内容类型规范",
            "check": lambda p: all(u["type"] in ("A", "F") for u in p.updates),
            "severity": "warning",
            "message": "更新内容类型标记不规范（应为 A 或 F）",
        },
    ]

    @classmethod
    def review(cls, message: str) -> tuple:
        """
        返回 (review_status, reason, parsed_dict)
        review_status: pass / warning / illegal
        """
        parsed = CommitParser.parse(message)

        if not parsed.is_valid:
            return "illegal", "; ".join(parsed.errors), parsed.to_dict()

        warnings = []
        for rule in cls.RULES:
            if not rule["check"](parsed):
                if rule["severity"] == "illegal":
                    return "illegal", rule["message"], parsed.to_dict()
                elif rule["severity"] == "warning":
                    warnings.append(rule["message"])

        if warnings:
            return "warning", "; ".join(warnings), parsed.to_dict()

        return "pass", "", parsed.to_dict()

    @classmethod
    def suggest(cls, message: str) -> str:
        """基于规则引擎给出轻量 AI 建议（阶段二占位）"""
        status, reason, parsed = cls.review(message)
        if status == "pass":
            return "提交信息符合规范。"
        if reason:
            return reason
        return "请检查提交信息格式是否完整。"
