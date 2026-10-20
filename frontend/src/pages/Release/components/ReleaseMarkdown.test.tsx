import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { buildMdTable } from '@/utils/markdownTable';
import { ReleaseMarkdown } from './ReleaseMarkdown';

afterEach(cleanup);

describe('发布说明 Markdown', () => {
  it.each(['正文', '生成表格'])('脚注定义不吞掉后续片段的缩进代码：%s', (mode) => {
    const code = '    配置内容不得丢失\n    第二行';
    const content = mode === '生成表格'
      ? buildMdTable([{ key: '配置项改动', value: code }]) + '\n\n正文[^a]\n\n[^a]: 脚注'
      : '[^a]: 脚注\n\n<br>\n' + code;
    const { container } = render(<ReleaseMarkdown content={content} />);

    expect(container.querySelector('pre code')?.textContent).toBe('配置内容不得丢失\n第二行\n');
    if (mode === '生成表格') expect(container.querySelector('td pre code')).not.toBeNull();
    expect(container.querySelector('pre code')?.textContent).not.toContain('脚注');
  });

  it('行首换行后未闭合的代码块不混入前文引用定义', () => {
    const { container } = render(<ReleaseMarkdown content={[
      '[mr]: https://example.invalid/mr/44 "关联说明"', '', '<br>', '```text', '代码示例',
    ].join('\n')} />);

    expect(container.querySelector('pre code')?.textContent).toBe('代码示例\n');
    expect(container.querySelectorAll('br')).toHaveLength(1);
    expect(container.textContent).not.toContain('[mr]:');
  });

  it('生成字段以围栏代码结束时，仍识别表外的引用定义', () => {
    const generated = buildMdTable([
      { key: '变更内容', value: '[关联 MR][mr]\n\n```text\n代码示例\n```' },
    ]);
    const { container } = render(<ReleaseMarkdown content={[
      generated, '', '[后文引用][mr]', '', '[mr]: https://example.invalid/mr/44 "关联说明"',
    ].join('\n')} />);

    const link = screen.getByRole('link', { name: '关联 MR' });
    expect(link.getAttribute('href')).toBe('https://example.invalid/mr/44');
    expect(link.closest('td')?.querySelector('pre code')?.textContent).toBe('代码示例\n');
    expect(screen.getByRole('link', { name: '后文引用' }).getAttribute('href')).toBe('https://example.invalid/mr/44');
    expect(container.querySelectorAll('table')).toHaveLength(1);
  });

  it('生成字段行首换行后保留表外定义的引用链接，前后正文仍共享引用', () => {
    const generated = buildMdTable([
      { key: '变更内容', value: '<br>\n[关联 MR][mr]' },
      { key: '测试验证', value: '已验证' },
    ]);
    const { container } = render(<ReleaseMarkdown content={[
      '[前文引用][mr]', '', generated, '', '[末尾引用][mr]', '',
      '[mr]: https://example.invalid/mr/44 "关联说明"',
    ].join('\n')} />);

    const link = screen.getByRole('link', { name: '关联 MR' });
    expect(link.getAttribute('href')).toBe('https://example.invalid/mr/44');
    expect(link.getAttribute('title')).toBe('关联说明');
    expect(link.closest('td')?.querySelector('br')).not.toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    for (const name of ['前文引用', '末尾引用']) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe('https://example.invalid/mr/44');
    }
    expect(container.textContent).not.toContain('[mr]:');
  });

  it('生成字段以空行开始和结束时仍归同一单元格，后文不被吞入', () => {
    const { container } = render(<ReleaseMarkdown content={buildMdTable([
      { key: '配置项改动', value: '\n**独立配置说明**\n' },
      { key: '测试验证', value: '已验证' },
    ]) + '\n\n额外正文'} />);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].children[1].querySelector('strong')?.textContent).toBe('独立配置说明');
    expect(screen.getByText('额外正文').closest('table')).toBeNull();
  });

  it('保留生产配置字段首行缩进代码，混合正文中的代码仍有代码块语义', () => {
    const generated = buildMdTable([
      { key: '配置项改动', value: '    缩进代码首行\n    缩进代码续行' },
      { key: '测试验证', value: '已验证' },
    ]);
    const { container } = render(<ReleaseMarkdown content={generated + '\n\n额外正文'} />);
    expect(container.querySelector('td pre code')?.textContent).toBe('缩进代码首行\n缩进代码续行\n');
    expect(screen.getByText('额外正文')).toBeTruthy();
  });

  it('生成表格嵌入混合正文时，物理续行和管道仍属于同一值单元格', () => {
    const generated = buildMdTable([
      { key: '版本号', value: 'V44.0.0' },
      { key: '变更内容', value: 'A 支持 A | B\nF 修复终端故障\n    保留续行缩进\n\n独立补充段落\n[关联 MR][mr]' },
      { key: '测试验证', value: '已验证' },
    ]);
    const { container } = render(<ReleaseMarkdown content={[
      '# 额外前言', '', '[前文引用][mr]', '', generated, '',
      '## 额外补充', '', '- 列表项目', '', '[末尾引用][mr]', '',
      '[mr]: https://example.invalid/mr/44 "关联说明"',
    ].join('\n')} />);

    const table = container.querySelector('table')!;
    expect(table.querySelectorAll('tbody tr')).toHaveLength(3);
    const changeRow = Array.from(table.querySelectorAll('tbody tr')).find((row) => row.firstElementChild?.textContent === '变更内容')!;
    expect(changeRow.children).toHaveLength(2);
    expect(changeRow.children[1].textContent).toContain('A 支持 A | B\nF 修复终端故障');
    expect(changeRow.children[1].textContent).toContain('    保留续行缩进');
    expect(changeRow.children[1].querySelectorAll('p')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: '额外前言' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '额外补充' })).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toBe('列表项目');
    for (const name of ['关联 MR', '前文引用', '末尾引用']) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe('https://example.invalid/mr/44');
    }
  });

  it('只修复确证生成表块，保留代码中的表格及字段代码里的 br 和管道原文', () => {
    const sample = '| 字段 | 内容 |\n|------|------|\n| 示例 | 第一行\n第二行 |';
    const generated = buildMdTable([
      { key: '变更内容', value: '开始\n```html\n<br>\nA | B\n```\n**完成**<br>[安全链接][safe]' },
    ]);
    const { container } = render(<ReleaseMarkdown content={[
      '```markdown', sample, '```', '', generated, '',
      '[危险链接](javascript:alert%281%29) <img src="x" onerror="alert(1)">', '',
      '[safe]: https://example.invalid/safe',
    ].join('\n')} />);

    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    const codes = container.querySelectorAll('pre code');
    expect(codes).toHaveLength(2);
    expect(codes[0].textContent?.trim()).toBe(sample);
    expect(codes[1].textContent?.trim()).toBe('<br>\nA | B');
    expect(container.querySelectorAll('br')).toHaveLength(1);
    expect(screen.getByText('完成').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: '安全链接' }).getAttribute('href')).toBe('https://example.invalid/safe');
    expect(screen.getByText('危险链接').getAttribute('href') || '').not.toMatch(/^javascript:/i);
    expect(container.querySelector('img')).toBeNull();
  });

  it.each([false, true])('行首换行后继续渲染强调和链接（字段模式：%s）', (field) => {
    const { container } = render(<ReleaseMarkdown field={field} content={'<br>\n**重要说明**\n[MR](https://example.invalid/mr/1)'} />);

    expect(container.querySelector('br')).not.toBeNull();
    expect(screen.getByText('重要说明').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'MR' }).getAttribute('href')).toBe('https://example.invalid/mr/1');
    expect(container.textContent).not.toContain('**重要说明**');
    expect(container.textContent).not.toContain('[MR]');
  });

  it.each([false, true])('普通正文行首换行后沿用整篇引用定义并过滤危险地址（字段模式：%s）', (field) => {
    const { container } = render(<ReleaseMarkdown field={field} content={[
      '<br>', '[关联 MR][mr] [危险引用][unsafe] `<br>`', '',
      '[后文引用][mr]', '',
      '[mr]: https://example.invalid/mr/44',
      '[unsafe]: javascript:alert%281%29',
    ].join('\n')} />);

    for (const name of ['关联 MR', '后文引用']) {
      expect(screen.getByRole('link', { name }).getAttribute('href')).toBe('https://example.invalid/mr/44');
    }
    expect(screen.getByText('危险引用').getAttribute('href') || '').not.toMatch(/^javascript:/i);
    expect(container.querySelectorAll('br')).toHaveLength(1);
    expect(container.querySelector('code')?.textContent).toBe('<br>');
    expect(container.textContent).not.toContain('[mr]:');
  });

  it('行内换行前后保留强调和链接', () => {
    const { container } = render(<ReleaseMarkdown content={'**前文**<br />[后文](https://example.invalid/notes)'} />);

    expect(container.querySelectorAll('br')).toHaveLength(1);
    expect(screen.getByText('前文').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: '后文' }).getAttribute('href')).toBe('https://example.invalid/notes');
  });

  it('行首换行后保留字段续行缩进', () => {
    const { container } = render(<ReleaseMarkdown field content={'<br>\n**部署步骤**\n    backup_db --all\n完成后重启'} />);

    expect(screen.getByText('部署步骤').tagName).toBe('STRONG');
    expect(container.textContent).toContain('\n    backup_db --all\n完成后重启');
  });

  it('行首换行后的代码保留标签原文，HTML 和危险链接保持过滤', () => {
    const { container } = render(<ReleaseMarkdown content={[
      '<br>',
      '`<br>` [普通链接](https://example.invalid) [危险链接](javascript:alert%281%29) <img src="x" onerror="alert(1)">',
      '<script>alert(1)</script>',
      '',
      '```html',
      '<br>',
      '```',
    ].join('\n')} />);

    expect(container.querySelectorAll('br')).toHaveLength(1);
    expect(container.querySelectorAll('code')).toHaveLength(2);
    for (const code of container.querySelectorAll('code')) expect(code.textContent?.trim()).toBe('<br>');
    expect(screen.getByRole('link', { name: '普通链接' }).getAttribute('href')).toBe('https://example.invalid');
    expect(screen.getByText('危险链接').getAttribute('href') || '').not.toMatch(/^javascript:/i);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
