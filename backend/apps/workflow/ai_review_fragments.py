"""固定 unified diff 的无损切片；行号始终使用原始提交坐标。"""
from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from itertools import groupby
from typing import Any


@dataclass
class DiffLine:
    hunk: int
    old: int
    new: int
    text: str
    old_count: int
    new_count: int


def diff_lines(diff: str) -> list[DiffLine]:
    """仅供已校验的差异使用；无末尾换行标记与它所属的行一起切片。"""
    result = []
    old = new = hunk = 0
    for line in diff.splitlines(keepends=True):
        match = re.match(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", line)
        if match:
            hunk += 1
            old = int(match[1]) + (int(match[2] or 1) == 0)
            new = int(match[3]) + (int(match[4] or 1) == 0)
        elif line.startswith("\\ No newline"):
            result[-1].text += line
        elif line.startswith(("-", "+", " ")):
            old_count, new_count = int(line[0] != "+"), int(line[0] != "-")
            result.append(DiffLine(hunk, old, new, line, old_count, new_count))
            old += old_count
            new += new_count
    return result


def fragment(item: dict[str, Any], lines: list[DiffLine], start: int, end: int) -> dict[str, Any]:
    """重新计算切片的块头，不改变代码文本、顺序或任一侧实际行号。"""
    parts = []
    for _, group in groupby(lines[start:end], key=lambda row: row.hunk):
        rows = list(group)
        old_count = sum(row.old_count for row in rows)
        new_count = sum(row.new_count for row in rows)
        old = rows[0].old - (old_count == 0)
        new = rows[0].new - (new_count == 0)
        parts.append(f"@@ -{old},{old_count} +{new},{new_count} @@\n" + "".join(row.text for row in rows))
    return {**item, "diff": "".join(parts), "fragment": {"start": start, "end": end, "total": len(lines)}}


def fitting_end(start: int, stop: int, fits: Callable[[int], bool]) -> int:
    """二分寻找可容纳的最大结束位置；非空范围均放不下时返回起点。"""
    low, high = start, stop
    while low < high:
        middle = (low + high + 1) // 2
        if fits(middle):
            low = middle
        else:
            high = middle - 1
    return low


def split_diff(
    item: dict[str, Any], fits: Callable[[dict[str, Any]], bool],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """先倍增局部窗口再二分，避免每个片段都重建剩余全文。"""
    lines = diff_lines(item["diff"])
    accepted, blocked = [], []
    start = 0
    while start < len(lines):
        low, high = start, start + 1
        while fits(fragment(item, lines, start, high)):
            low = high
            if high == len(lines):
                break
            high = min(len(lines), start + (high - start) * 2)
        if low < high:
            low = fitting_end(low, high - 1, lambda end: fits(fragment(item, lines, start, end)))
        end = low if low > start else start + 1
        part = fragment(item, lines, start, end)
        (accepted if low > start else blocked).append(part)
        start = end
    return accepted, blocked


def fragment_location(item: dict[str, Any]) -> dict[str, Any]:
    """报告只传坐标与片段序号，不额外复制源码。"""
    result = {"path": item.get("new_path") or item.get("old_path")}
    if "fragment" not in item:
        return result
    lines = diff_lines(item["diff"])
    result.update(fragment=item["fragment"])
    for side in ("old", "new"):
        positions = [getattr(row, side) for row in lines if getattr(row, side + "_count")]
        if positions:
            result.update({side + "_start": min(positions), side + "_end": max(positions)})
    return result
