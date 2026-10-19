import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReleaseMarkdown } from './ReleaseMarkdown';

afterEach(cleanup);

describe('发布说明 Markdown', () => {
  it.each([false, true])('行首换行后继续渲染强调和链接（字段模式：%s）', (field) => {
    const { container } = render(<ReleaseMarkdown field={field} content={'<br>\n**重要说明**\n[MR](https://example.invalid/mr/1)'} />);

    expect(container.querySelector('br')).not.toBeNull();
    expect(screen.getByText('重要说明').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'MR' }).getAttribute('href')).toBe('https://example.invalid/mr/1');
    expect(container.textContent).not.toContain('**重要说明**');
    expect(container.textContent).not.toContain('[MR]');
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
