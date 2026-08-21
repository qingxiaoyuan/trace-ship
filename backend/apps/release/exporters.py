"""
发布单导出器

支持导出 PDF、Word 和 Markdown 格式的发布单。

release_doc 为 Markdown 字符串（2 列表格），导出器解析表格行后渲染为 PDF/Word。
"""
import io
import re
from typing import Any

from apps.release.models import ReleaseRecord


def _parse_md_table(md: str) -> list[tuple[str, str]]:
    """
    解析 Markdown 2 列表格为行列表

    Args:
        md: Markdown 字符串

    Returns:
        (项目, 内容) 元组列表
    """
    if not md:
        return []
    rows: list[tuple[str, str]] = []
    for line in md.strip().splitlines():
        line = line.strip()
        if not line or not line.startswith("|"):
            continue
        # 按管道符分割
        parts = line.split("|")
        # 去掉首尾空串（首尾管道符产生的）
        cells = [c.strip() for c in parts[1:-1]] if len(parts) >= 3 else [c.strip() for c in parts]
        if len(cells) < 2:
            continue
        # 跳过分隔行 |------|------|
        if re.match(r"^[-:\s]+$", cells[0]):
            continue
        # 跳过表头
        if cells[0] == "项目" and cells[1] == "内容":
            continue
        rows.append((cells[0], cells[1]))
    return rows


def _xml_escape(text: str) -> str:
    """转义 XML 特殊字符，保留 <br/> 标签"""
    # 先把 <br> 统一为占位符
    placeholder = "\x00BR\x00"
    text = re.sub(r"<br\s*/?>", placeholder, text, flags=re.IGNORECASE)
    # 转义特殊字符
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # 恢复占位符为 <br/>
    text = text.replace(placeholder, "<br/>")
    return text


class ReleaseDocExporter:
    """
    发布单导出器

    根据 ReleaseRecord 的 release_doc（Markdown）生成 PDF/Word 发布单。
    """

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
        table_rows = _parse_md_table(md)
        commits = release.release_commits.filter(is_included=True).select_related("commit")
        return {
            "project_name": release.project.name,
            "version": release.version,
            "tag_name": release.tag_name,
            "release_type": release.get_release_type_display(),
            "status": release.get_status_display(),
            "branch": release.branch,
            "git_hash": release.git_hash,
            "publisher": release.publisher.nickname or release.publisher.username if release.publisher else "",
            "created_at": release.created_at.strftime("%Y-%m-%d %H:%M") if release.created_at else "",
            "released_at": release.released_at.strftime("%Y-%m-%d %H:%M") if release.released_at else "",
            "table_rows": table_rows,
            "commits": [
                {
                    "hash": c.commit.commit_hash[:12],
                    "author": c.commit.author,
                    "message": c.commit.message,
                }
                for c in commits
            ],
        }

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
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

        # 尝试注册中文字体
        try:
            pdfmetrics.registerFont(TTFont("SimSun", "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc"))
            font_name = "SimSun"
        except Exception:
            font_name = "Helvetica"

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
            [Paragraph("项目", label_style), Paragraph(ctx["project_name"], cell_style),
             Paragraph("版本号", label_style), Paragraph(ctx["version"], cell_style)],
            [Paragraph("Tag", label_style), Paragraph(ctx["tag_name"], cell_style),
             Paragraph("发布类型", label_style), Paragraph(ctx["release_type"], cell_style)],
            [Paragraph("分支", label_style), Paragraph(ctx["branch"], cell_style),
             Paragraph("Git Hash", label_style), Paragraph(ctx["git_hash"], cell_style)],
            [Paragraph("发布人", label_style), Paragraph(ctx["publisher"], cell_style),
             Paragraph("状态", label_style), Paragraph(ctx["status"], cell_style)],
            [Paragraph("创建时间", label_style), Paragraph(ctx["created_at"], cell_style),
             Paragraph("发布时间", label_style), Paragraph(ctx["released_at"], cell_style)],
        ]
        base_table = Table(base_data, colWidths=[60, 180, 60, 180])
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

        # 发布说明表格（2 列，无表头）
        if ctx["table_rows"]:
            story.append(Paragraph("发布说明", heading_style))
            story.append(Spacer(1, 8))
            table_data = []
            for label, content in ctx["table_rows"]:
                # 将 <br> 标签转义为合法的 <br/> 并转义其他 XML 特殊字符
                safe_content = _xml_escape(content)
                table_data.append([
                    Paragraph(_xml_escape(label), label_style),
                    Paragraph(safe_content, cell_style),
                ])
            release_table = Table(table_data, colWidths=[120, 360])
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
            story.append(Spacer(1, 20))

        # 关联提交
        story.append(Paragraph("关联提交", heading_style))
        if ctx["commits"]:
            for c in ctx["commits"]:
                story.append(Paragraph(
                    f"<b>{c['hash']} - {c['author']}</b>",
                    cell_style,
                ))
                story.append(Paragraph(_xml_escape(c["message"]), cell_style))
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
        base_rows = [
            ("项目", ctx["project_name"], "版本号", ctx["version"]),
            ("Tag", ctx["tag_name"], "发布类型", ctx["release_type"]),
            ("分支", ctx["branch"], "Git Hash", ctx["git_hash"]),
            ("发布人", ctx["publisher"], "状态", ctx["status"]),
            ("创建时间", ctx["created_at"], "发布时间", ctx["released_at"]),
        ]
        table = document.add_table(rows=len(base_rows), cols=4)
        table.style = "Table Grid"
        for i, row_data in enumerate(base_rows):
            row = table.rows[i]
            row.cells[0].text = row_data[0]
            row.cells[1].text = row_data[1]
            row.cells[2].text = row_data[2]
            row.cells[3].text = row_data[3]

        document.add_paragraph()

        # 发布说明表格（2 列，无表头）
        if ctx["table_rows"]:
            document.add_heading("发布说明", level=2)
            doc_table = document.add_table(rows=len(ctx["table_rows"]), cols=2)
            doc_table.style = "Table Grid"
            for idx, (label, content) in enumerate(ctx["table_rows"]):
                row = doc_table.rows[idx]
                row.cells[0].text = label
                # 将 <br> 转换为换行
                row.cells[1].text = content.replace("<br>", "\n")
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
