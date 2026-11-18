"""
发布单导出器

支持导出 PDF、Word 和 Markdown 格式的发布单。

release_doc 为 Markdown 字符串（2 列表格），导出器解析表格行后渲染为 PDF/Word。
"""
import io
import re
from typing import Any
from xml.sax.saxutils import escape

from markdown_it import MarkdownIt
from markdown_it.rules_block.table import escapedSplit
from markdown_it.rules_inline import html_inline

from apps.release.delivery_identity import release_repository_name, release_software_name
from apps.release.models import ReleaseRecord
from utils.markdown_table import has_closing_pipe, markdown_code_lines, table_newlines_to_br


def _release_body(md: str) -> list[str | list[list[str]]]:
    """按原顺序保留普通正文和表格；多行表格沿用发布说明的存储规则。"""
    source = table_newlines_to_br(md)
    lines = source.split("\n")
    blocks: list[str | list[list[str]]] = []
    cursor = 0
    for token in MarkdownIt().enable("table").parse(source):
        if token.type != "table_open" or token.map is None or token.level != 0:
            continue
        start, end = token.map
        # 先保留表格之前的正文；不把用户正文当成可执行的 HTML。
        surrounding = "\n".join(lines[cursor:start]).strip("\n")
        if surrounding:
            blocks.append(surrounding)
        header = lines[start].strip()
        outer_pipes = header.startswith("|") and has_closing_pipe(header)
        rows = [_table_cells(header)]
        cursor = start + 2
        for line in lines[cursor:end]:
            row = line.strip()
            cells = _table_cells(row)
            # 解析器会把紧跟表格的普通文字补成单列。保留这类原文以及未闭合的续行。
            if (outer_pipes and row.startswith("|") and not has_closing_pipe(row)) or (
                len(cells) == 1 and not row.startswith("|") and not has_closing_pipe(row)
            ):
                break
            rows.append(cells)
            cursor += 1
        # 使用原文的实际列宽，避免按表头列数截断历史字段。
        width = max(map(len, rows))
        if width == 2 and rows[0] == ["项目", "内容"] and len(rows) > 1:
            rows.pop(0)
        blocks.append([row + [""] * (width - len(row)) for row in rows])
    tail = "\n".join(lines[cursor:]).strip("\n")
    if tail:
        blocks.append(tail)
    return blocks


def _table_cells(line: str) -> list[str]:
    cells = escapedSplit(line)
    if line.startswith("|"):
        cells = cells[1:]
    if has_closing_pipe(line):
        cells = cells[:-1]
    return [cell.strip() for cell in cells]


_BREAK = re.compile(r"<br\s*/?>", re.IGNORECASE)


def _inline_breaks(text: str) -> str:
    """用 Markdown 解析位置替换真实的断行标记，保留代码及原始标点。"""
    parser = MarkdownIt()
    breaks = []

    def record_html(state, silent):
        start = state.pos
        if not html_inline(state, silent):
            return False
        if not silent and _BREAK.fullmatch(state.src[start:state.pos]):
            breaks.append((start, state.pos))
        return True

    parser.inline.ruler.at("html_inline", record_html)
    parser.parseInline(text)
    for start, end in reversed(breaks):
        text = text[:start] + "\n" + text[end:]
    return text


def _word_text(text: str, *, cell: bool = False) -> str:
    if cell:
        return _inline_breaks(text)
    parts = []
    prose = []
    code_lines = markdown_code_lines(text)
    for index, line in enumerate(text.splitlines(keepends=True)):
        if index in code_lines:
            if prose:
                parts.append(_inline_breaks("".join(prose)))
                prose.clear()
            parts.append(line)
        else:
            prose.append(line)
    parts.append(_inline_breaks("".join(prose)))
    return "".join(parts)


def _pdf_text(text: str) -> str:
    """用实际断行渲染排版；转义包括代码中的字面标签。"""
    lines = []
    for line in text.expandtabs(4).split("\n"):
        indentation = len(line) - len(line.lstrip(" "))
        lines.append("&#160;" * indentation + escape(line[indentation:]))
    return "<br/>".join(lines)


class ReleaseDocExporter:
    """
    发布单导出器

    根据 ReleaseRecord 的 release_doc（Markdown）生成 PDF/Word 发布单。
    """

    @staticmethod
    def filename(release: ReleaseRecord, extension: str) -> str:
        version = re.sub(r"[^\w.-]+", "-", release.version).strip(".-") or "latest"
        software = f"{release.software.slug}-" if release.software_id else ""
        return f"release-{software}{version}.{extension}"

    @staticmethod
    def _identity_rows(release: ReleaseRecord) -> list[tuple[str, str]]:
        return [
            ("软件", release_software_name(release)),
            ("软件标识", release.software.slug if release.software_id else "—"),
            ("主仓库", release_repository_name(release)),
            ("软件版本", release.version),
            ("发布 Tag", release.tag_name),
            ("来源分支", release.branch),
            ("源码 SHA", release.git_hash),
        ]

    @classmethod
    def export_markdown(cls, release: ReleaseRecord) -> str:
        # 导出头使用已保存的发布身份，已有说明仍按原正文规则下载。
        header = ["## 发布来源", "", "| 项目 | 内容 |", "| --- | --- |"]
        for label, value in cls._identity_rows(release):
            escaped = escape(value or "—").replace("\\", "\\\\").replace("|", "\\|")
            header.append(f"| {label} | {escaped.replace(chr(10), '<br>')} |")
        return "\n".join(header) + "\n\n" + table_newlines_to_br(release.release_doc or "")

    @staticmethod
    def _get_context(release: ReleaseRecord) -> dict[str, Any]:
        """
        构建导出上下文

        Args:
            release: ReleaseRecord 实例

        Returns:
            上下文字典
        """
        md = release.release_doc or ""
        commits = release.release_commits.filter(is_included=True).select_related("commit")
        return {
            "project_name": release.project.name,
            "software_name": release_software_name(release),
            "software_slug": release.software.slug if release.software_id else "—",
            "repository_name": release_repository_name(release),
            "version": release.version,
            "tag_name": release.tag_name,
            "release_type": release.get_release_type_display(),
            "status": release.get_status_display(),
            "branch": release.branch,
            "git_hash": release.git_hash,
            "publisher": release.publisher.nickname or release.publisher.username if release.publisher else "",
            "created_at": release.created_at.strftime("%Y-%m-%d %H:%M") if release.created_at else "",
            "released_at": release.released_at.strftime("%Y-%m-%d %H:%M") if release.released_at else "",
            "body": _release_body(md),
            "commits": [
                {
                    "hash": c.commit.commit_hash[:12],
                    "author": c.commit.author,
                    "message": c.commit.message,
                }
                for c in commits
            ],
        }

    @staticmethod
    def _base_rows(ctx: dict[str, Any]) -> list[tuple[str, str, str, str]]:
        return [
            ("软件", ctx["software_name"], "软件标识", ctx["software_slug"]),
            ("主仓库", ctx["repository_name"], "版本号", ctx["version"]),
            ("Tag", ctx["tag_name"], "发布类型", ctx["release_type"]),
            ("分支", ctx["branch"], "源码 SHA", ctx["git_hash"]),
            ("项目", ctx["project_name"], "状态", ctx["status"]),
            ("发布人", ctx["publisher"], "创建时间", ctx["created_at"]),
            ("发布时间", ctx["released_at"], "", ""),
        ]

    @classmethod
    def export_pdf(cls, release: ReleaseRecord) -> bytes:
        """
        导出 PDF 发布单

        Args:
            release: ReleaseRecord 实例

        Returns:
            PDF 字节流
        """
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

        # 尝试注册中文字体
        try:
            pdfmetrics.registerFont(TTFont("SimSun", "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"))
            font_name = "SimSun"
        except Exception:
            font_name = "STSong-Light"
            pdfmetrics.registerFont(UnicodeCIDFont(font_name))

        ctx = cls._get_context(release)
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=72, leftMargin=72, topMargin=72, bottomMargin=18)

        styles = getSampleStyleSheet()
        # 单元格段落样式
        cell_style = ParagraphStyle(
            "CellStyle", parent=styles["Normal"], fontName=font_name,
            fontSize=10, leading=14,
        )
        label_style = ParagraphStyle(
            "LabelStyle", parent=styles["Normal"], fontName=font_name,
            fontSize=10, leading=14, textColor=colors.HexColor("#475569"),
        )
        title_style = ParagraphStyle(
            "TitleStyle", parent=styles["Title"], fontName=font_name,
            fontSize=18, leading=22, alignment=1,
        )
        heading_style = ParagraphStyle(
            "HeadingStyle", parent=styles["Heading3"], fontName=font_name,
            fontSize=13, leading=18,
        )

        story = []
        story.append(Paragraph("软件发布单", title_style))
        story.append(Spacer(1, 20))

        # 基本信息表格
        base_data = [
            [Paragraph(escape(value), label_style if index % 2 == 0 else cell_style)
             for index, value in enumerate(row)]
            for row in cls._base_rows(ctx)
        ]
        value_width = (doc.width - 120) / 2
        base_table = Table(base_data, colWidths=[60, value_width, 60, value_width])
        base_table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story.append(base_table)
        story.append(Spacer(1, 20))

        if ctx["body"]:
            story.append(Paragraph("发布说明", heading_style))
            story.append(Spacer(1, 8))
            for block in ctx["body"]:
                if isinstance(block, str):
                    story.append(Paragraph(_pdf_text(_word_text(block)), cell_style))
                else:
                    table_data = [
                        [Paragraph(_pdf_text(_word_text(value, cell=True)), label_style if index == 0 else cell_style)
                         for index, value in enumerate(row)]
                        for row in block
                    ]
                    widths = [120, doc.width - 120] if len(block[0]) == 2 else [doc.width / len(block[0])] * len(block[0])
                    release_table = Table(table_data, colWidths=widths, splitInRow=1)
                    release_table.setStyle(TableStyle([
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F8FAFC")),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 6),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                        ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ]))
                    story.append(release_table)
                story.append(Spacer(1, 8))

        # 关联提交
        story.append(Paragraph("关联提交", heading_style))
        if ctx["commits"]:
            for c in ctx["commits"]:
                story.append(Paragraph(
                    f"<b>{c['hash']} - {escape(c['author'])}</b>",
                    cell_style,
                ))
                story.append(Paragraph(_pdf_text(c["message"]), cell_style))
                story.append(Spacer(1, 4))
        else:
            story.append(Paragraph("无", cell_style))

        doc.build(story)
        return buffer.getvalue()

    @classmethod
    def export_word(cls, release: ReleaseRecord) -> bytes:
        """
        导出 Word 发布单

        Args:
            release: ReleaseRecord 实例

        Returns:
            Word 字节流
        """
        from docx import Document
        from docx.enum.text import WD_ALIGN_PARAGRAPH

        ctx = cls._get_context(release)
        document = Document()

        title = document.add_heading("软件发布单", level=0)
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER

        # 基本信息表格
        base_rows = cls._base_rows(ctx)
        table = document.add_table(rows=len(base_rows), cols=4)
        table.style = "Table Grid"
        for i, row_data in enumerate(base_rows):
            row = table.rows[i]
            row.cells[0].text = row_data[0]
            row.cells[1].text = row_data[1]
            row.cells[2].text = row_data[2]
            row.cells[3].text = row_data[3]

        document.add_paragraph()

        if ctx["body"]:
            document.add_heading("发布说明", level=2)
            for block in ctx["body"]:
                if isinstance(block, str):
                    document.add_paragraph(_word_text(block))
                    continue
                doc_table = document.add_table(rows=len(block), cols=len(block[0]))
                doc_table.style = "Table Grid"
                for index, row in enumerate(block):
                    for column, value in enumerate(row):
                        doc_table.rows[index].cells[column].text = _word_text(value, cell=True)
            document.add_paragraph()

        # 关联提交
        document.add_heading("关联提交", level=2)
        if ctx["commits"]:
            for c in ctx["commits"]:
                p = document.add_paragraph()
                p.add_run(f"{c['hash']} - {c['author']}\n").bold = True
                p.add_run(c["message"])
        else:
            document.add_paragraph("无")

        buffer = io.BytesIO()
        document.save(buffer)
        return buffer.getvalue()
