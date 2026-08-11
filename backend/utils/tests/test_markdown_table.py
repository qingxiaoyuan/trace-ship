"""Markdown 表格换行转换工具测试。"""
from utils.markdown_table import table_newlines_to_br


class TestTableNewlinesToBr:
    def test_multiline_cell_converted(self):
        md = "| 项目 | 内容 |\n|---|---|\n| 变更内容 | 第一行\n第二行\n第三行 |\n| 发布人 | 张三 |"
        result = table_newlines_to_br(md)
        assert "| 变更内容 | 第一行<br>第二行<br>第三行 |" in result
        assert "| 发布人 | 张三 |" in result
        # 转换后每行都是完整表格行
        for line in result.split("\n"):
            if line.strip().startswith("|"):
                assert line.strip().endswith("|")

    def test_single_line_rows_unchanged(self):
        md = "| 项目 | 内容 |\n|---|---|\n| 版本号 | V1.0.0 |"
        assert table_newlines_to_br(md) == md

    def test_non_table_content_unchanged(self):
        md = "# 发布说明\n\n- 修复问题\n- 新增功能"
        assert table_newlines_to_br(md) == md

    def test_empty_and_none(self):
        assert table_newlines_to_br("") == ""
        assert table_newlines_to_br("单行无换行") == "单行无换行"

    def test_crlf_normalized(self):
        md = "| 变更内容 | 第一行\r\n第二行 |"
        result = table_newlines_to_br(md)
        assert result == "| 变更内容 | 第一行<br>第二行 |"

    def test_mixed_table_and_text(self):
        md = "说明前缀\n| 项目 | 内容 |\n|---|---|\n| 变更内容 | A 行1\n行2 |\n结尾文本"
        result = table_newlines_to_br(md)
        lines = result.split("\n")
        assert lines[0] == "说明前缀"
        assert "| 变更内容 | A 行1<br>行2 |" in lines
        assert lines[-1] == "结尾文本"
