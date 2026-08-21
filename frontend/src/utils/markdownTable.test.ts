import { describe, expect, it } from 'vitest';
import { buildMdTable, parseMdTable } from './markdownTable';

describe('parseMdTable', () => {
  it('解析标准 2 列表格，跳过表头与分隔行', () => {
    const md = ['| 项目 | 内容 |', '|------|------|', '| 版本号 | V1.0.0 |', '| 发布人 | 张三 |'].join('\n');
    expect(parseMdTable(md)).toEqual([
      { key: '版本号', value: 'V1.0.0' },
      { key: '发布人', value: '张三' },
    ]);
  });

  it('空输入与非表格行返回空数组', () => {
    expect(parseMdTable('')).toEqual([]);
    expect(parseMdTable('普通文本\n另一行')).toEqual([]);
  });

  it('支持多行单元格：不以 | 开头的行拼接到上一行值', () => {
    const md = ['| 项目 | 内容 |', '|------|------|', '| 更新内容 | 第一行', '第二行', '第三行 |'].join('\n');
    expect(parseMdTable(md)).toEqual([{ key: '更新内容', value: '第一行\n第二行\n第三行' }]);
  });

  it('严格 2 列解析：超出第 2 列的内容被忽略', () => {
    const md = '| 说明 | a | b |';
    expect(parseMdTable(md)).toEqual([{ key: '说明', value: 'a' }]);
  });
});

describe('buildMdTable', () => {
  it('生成含表头的 Markdown 表格', () => {
    const md = buildMdTable([{ key: '版本号', value: 'V1.0.0' }]);
    expect(md).toBe('| 项目 | 内容 |\n|------|------|\n| 版本号 | V1.0.0 |');
  });

  it('转义键与值中的竖线', () => {
    const md = buildMdTable([{ key: 'a|b', value: 'c|d' }]);
    expect(md).toContain('| a\\|b | c\\|d |');
  });

  it('parse -> build 往返幂等', () => {
    const rows = [
      { key: '版本号', value: 'V1.0.0' },
      { key: '更新内容', value: '第一行\n第二行' },
    ];
    expect(parseMdTable(buildMdTable(rows))).toEqual(rows);
  });
});
