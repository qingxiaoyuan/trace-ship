import { describe, expect, it } from 'vitest';
import { buildMdTable, parseMdTable, parseCompleteMdTable } from './markdownTable';

describe('parseMdTable', () => {
  it.each([
    ['| 项目 | 内容 |', '| :--- | ---: |'],
    ['|字段|内容|', '|:---:|---|'],
  ])('兼容生成器两种表头及对齐分隔符：%s', (header, separator) => {
    const rows = [{ key: '变更内容', value: '首行\n续行' }];
    expect(parseCompleteMdTable([header, separator, '| 变更内容 | 首行\n续行 |'].join('\n'))).toEqual(rows);
    expect(parseCompleteMdTable('| 变更内容 | 首行\n续行 |')).toEqual(rows);
  });

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

  it('阅读模式保留命令缩进和空行，默认解析保持原契约', () => {
    const md = '| 部署步骤 | 备份\n    backup --all\n\n重启 |';
    expect(parseMdTable(md, { preserveWhitespace: true })).toEqual([
      { key: '部署步骤', value: '备份\n    backup --all\n\n重启' },
    ]);
    expect(parseMdTable(md)).toEqual([{ key: '部署步骤', value: '备份\nbackup --all\n\n重启' }]);
  });

  it.each(['    首行代码\n    续行代码', '    单行代码', '首行尾部  \n    续行尾部  ', '\n首段\n'])('阅读模式保留生成器分隔空格之外的有效空白：%s', (value) => {
    const rows = [{ key: '配置项改动', value }];
    expect(parseMdTable(buildMdTable(rows), { preserveWhitespace: true })).toEqual(rows);
    expect(parseCompleteMdTable(buildMdTable(rows))).toEqual(rows);
  });

  it.each([
    '| 字段 | 内容 |\n|---|---|\n| 字段一 | 值 |\n\n表格外正文',
    '| 字段 | 内容 |\n|---|---|\n| 字段一 | 值 | 第三列 |',
  ])('完整往返检查拒绝吞掉额外正文或列', (content) => {
    expect(parseCompleteMdTable(content)).toEqual([]);
  });

  it('严格 2 列解析：超出第 2 列的内容被忽略', () => {
    const md = '| 说明 | a | b |';
    expect(parseMdTable(md)).toEqual([{ key: '说明', value: 'a' }]);
  });
});

describe('buildMdTable', () => {
  it('生成含表头的 Markdown 表格', () => {
    const md = buildMdTable([{ key: '版本号', value: 'V1.0.0' }]);
    expect(md).toBe('| 字段 | 内容 |\n|------|------|\n| 版本号 | V1.0.0 |');
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

  it.each(['c|d', 'A 支持 A | B\n    backup_db --all\n\nF 修复终端故障', String.raw`C:\deploy\app | ready`])('转义管道与续行往返保留内容：%s', (value) => {
    const rows = [{ key: '变更|备注', value }];
    const md = buildMdTable(rows);
    expect(parseMdTable(md, { preserveWhitespace: true })).toEqual(rows);
    expect(buildMdTable(parseMdTable(md, { preserveWhitespace: true }))).toBe(md);
  });
});
