"""Markdown 表格工具

发布说明（release_doc）以 2 列表格存储，多行单元格使用字面换行；
标准 Markdown 表格不支持单元格内换行，导出场景（下载 MD / 推 SVN）
需要把单元格内的字面换行转换为 <br>。
"""


def table_newlines_to_br(md: str) -> str:
    """把 2 列表格多行单元格内的字面换行转换为 <br>。

    存储格式中，多行单元格跨越多个物理行：
        | 变更内容 | 第一行
        第二行
        第三行 |
    转换后合并为单行、以 <br> 连接：
        | 变更内容 | 第一行<br>第二行<br>第三行 |

    完整单行（| 开头且 | 结尾）与非表格内容原样保留。

    Args:
        md: 原始 Markdown 字符串

    Returns:
        转换后的 Markdown 字符串
    """
    if not md or "\n" not in md:
        return md

    lines = md.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        # 多行单元格起始行：以 | 开头但不以 | 结尾
        if stripped.startswith("|") and not stripped.endswith("|"):
            parts = [line.rstrip()]
            i += 1
            closed = False
            while i < len(lines):
                cont = lines[i].strip()
                if cont.startswith("|"):
                    break
                i += 1
                if cont.endswith("|"):
                    cont = cont[:-1].rstrip()
                    closed = True
                if cont:
                    parts.append(cont)
                if closed:
                    break
            if closed or len(parts) > 1:
                merged = "<br>".join(parts)
                out.append(merged + (" |" if closed else ""))
            else:
                out.append(line)
        else:
            out.append(line)
            i += 1
    return "\n".join(out)
