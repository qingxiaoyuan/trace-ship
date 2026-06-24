"""
发布单导出器

支持导出 PDF 和 Word 格式的发布单。
"""
import io
from typing import Any, Dict, List

from apps.release.models import ReleaseRecord


class ReleaseDocExporter:
    """
    发布单导出器

    根据 ReleaseRecord 生成 PDF/Word 发布单。
    """

    @staticmethod
    def _get_context(release: ReleaseRecord) -> Dict[str, Any]:
        """
        构建导出上下文

        Args:
            release: ReleaseRecord 实例

        Returns:
            上下文字典
        """
        doc = release.release_doc or {}
        commits = release.release_commits.filter(is_included=True).select_related("commit")
        return {
            "project_name": release.project.name,
            "version": release.version,
            "tag_name": release.tag_name,
            "release_type": release.get_release_type_display(),
            "status": release.get_status_display(),
            "source_branch": release.source_branch,
            "target_branch": release.target_branch,
            "git_hash": release.git_hash,
            "publisher": release.publisher.nickname or release.publisher.username if release.publisher else "",
            "created_at": release.created_at.strftime("%Y-%m-%d %H:%M") if release.created_at else "",
            "released_at": release.released_at.strftime("%Y-%m-%d %H:%M") if release.released_at else "",
            "change_type": doc.get("change_type", "-"),
            "updates": doc.get("updates", []),
            "config_changes": doc.get("config_changes", {}),
            "related_changes": doc.get("related_changes", {}),
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
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
        )
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont

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
        for style in styles.byName.values():
            style.fontName = font_name

        story = []
        story.append(Paragraph("<b>软件发布单</b>", styles["Title"]))
        story.append(Spacer(1, 20))

        # 基本信息表格
        base_data = [
            ["项目", ctx["project_name"], "版本号", ctx["version"]],
            ["Tag", ctx["tag_name"], "发布类型", ctx["release_type"]],
            ["来源分支", ctx["source_branch"], "目标分支", ctx["target_branch"]],
            ["Git Hash", ctx["git_hash"], "发布人", ctx["publisher"]],
            ["创建时间", ctx["created_at"], "发布时间", ctx["released_at"]],
        ]
        base_table = Table(base_data, colWidths=[80, 160, 80, 160])
        base_table.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
            ("FONTNAME", (0, 0), (-1, -1), font_name),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        story.append(base_table)
        story.append(Spacer(1, 20))

        # 变更类型
        story.append(Paragraph(f"<b>变更类型：</b>{ctx['change_type']}", styles["Heading3"]))
        story.append(Spacer(1, 10))

        # 更新内容
        story.append(Paragraph("<b>更新内容</b>", styles["Heading3"]))
        if ctx["updates"]:
            update_data = [["类型", "内容"]]
            for u in ctx["updates"]:
                update_data.append([u.get("type", ""), u.get("content", "")])
            update_table = Table(update_data, colWidths=[60, 420])
            update_table.setStyle(TableStyle([
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("FONTNAME", (0, 0), (-1, -1), font_name),
            ]))
            story.append(update_table)
        else:
            story.append(Paragraph("无", styles["Normal"]))
        story.append(Spacer(1, 20))

        # 配置项改动
        story.append(Paragraph("<b>配置项改动</b>", styles["Heading3"]))
        if ctx["config_changes"]:
            for section, kv in ctx["config_changes"].items():
                story.append(Paragraph(f"<b>[{section}]</b>", styles["Normal"]))
                for k, v in kv.items():
                    story.append(Paragraph(f"{k} = {v}", styles["Normal"]))
        else:
            story.append(Paragraph("无", styles["Normal"]))
        story.append(Spacer(1, 20))

        # 关联提交
        story.append(Paragraph("<b>关联提交</b>", styles["Heading3"]))
        if ctx["commits"]:
            for c in ctx["commits"]:
                story.append(Paragraph(f"{c['hash']} - {c['author']}<br/>{c['message']}", styles["Normal"]))
        else:
            story.append(Paragraph("无", styles["Normal"]))

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
        from docx.shared import Inches, Pt
        from docx.enum.text import WD_ALIGN_PARAGRAPH

        ctx = cls._get_context(release)
        document = Document()

        title = document.add_heading("软件发布单", level=0)
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER

        # 基本信息表格
        table = document.add_table(rows=5, cols=4)
        table.style = "Table Grid"
        cells = [
            ("项目", ctx["project_name"], "版本号", ctx["version"]),
            ("Tag", ctx["tag_name"], "发布类型", ctx["release_type"]),
            ("来源分支", ctx["source_branch"], "目标分支", ctx["target_branch"]),
            ("Git Hash", ctx["git_hash"], "发布人", ctx["publisher"]),
            ("创建时间", ctx["created_at"], "发布时间", ctx["released_at"]),
        ]
        for i, row_data in enumerate(cells):
            row = table.rows[i]
            row.cells[0].text = row_data[0]
            row.cells[1].text = row_data[1]
            row.cells[2].text = row_data[2]
            row.cells[3].text = row_data[3]

        document.add_paragraph()

        # 变更类型
        document.add_heading(f"变更类型：{ctx['change_type']}", level=2)

        # 更新内容
        document.add_heading("更新内容", level=2)
        if ctx["updates"]:
            for u in ctx["updates"]:
                document.add_paragraph(f"[{u.get('type', '')}] {u.get('content', '')}", style="List Bullet")
        else:
            document.add_paragraph("无")

        # 配置项改动
        document.add_heading("配置项改动", level=2)
        if ctx["config_changes"]:
            for section, kv in ctx["config_changes"].items():
                document.add_paragraph(f"[{section}]", style="Heading 3")
                for k, v in kv.items():
                    document.add_paragraph(f"{k} = {v}")
        else:
            document.add_paragraph("无")

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
