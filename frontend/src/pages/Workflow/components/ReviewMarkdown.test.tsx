import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ReviewMarkdown } from './ReviewMarkdown';

afterEach(cleanup);

it('审查意见的表格独立可滚动，保留正文、Markdown 语义和代码字面值', () => {
  const { container } = render(<ReviewMarkdown>{'首段 **强调** [文档](https://example.com) [危险](javascript:alert(1))\n\n| 第一列 | 最末列 |\n| --- | --- |\n| 配置值 | 完整末尾 |\n\n```html\n<script>alert(1)</script>\n```\n\n最后一段\n<script>alert(2)</script>'}</ReviewMarkdown>);
  const region = screen.getByRole('region', { name: '审查意见表格' });
  expect(region.classList.contains('overflow-x-auto')).toBe(true);
  expect(region.tabIndex).toBe(0);
  expect(within(region).getByRole('table')).toBeTruthy();
  expect(within(region).getByRole('cell', { name: '完整末尾' })).toBeTruthy();
  expect(screen.getByText('强调').tagName.toLowerCase()).toBe('strong');
  expect(screen.getByRole('link', { name: '文档' }).getAttribute('href')).toBe('https://example.com');
  expect(screen.getByText('危险').getAttribute('href')).not.toMatch(/^javascript:/);
  expect(screen.getByText('<script>alert(1)</script>').tagName.toLowerCase()).toBe('code');
  expect(screen.getByText('最后一段')).toBeTruthy();
  expect(container.querySelector('script')).toBeNull();
});
